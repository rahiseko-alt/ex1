/**
 * 顧客の画面。いまは登録の入力欄と、登録したものが残っているかを見る一覧だけ。
 *
 * 画面の枠（見出しとメニュー）は T021 で全ページ共通にする予定のため、
 * ここでは最小限の HTML を組み立てるだけにとどめている。
 */
import { Hono } from 'hono';

import {
  deleteCustomer,
  findCustomer,
  insertCustomer,
  listCustomers,
  updateCustomer,
  type CustomerRow,
  type DealRow,
  type Env,
  type HistoryRow,
} from './db.js';
import {
  deleteHistory,
  findHistory,
  insertHistory,
  listHistory,
  updateHistory,
  validateHistory,
  type HistoryInput,
} from './history.js';
import {
  DEAL_STAGES,
  findDeal,
  formatAmount,
  formatExpectedOn,
  groupDealsByStage,
  insertDeal,
  listAllDeals,
  listDealsOfCustomer,
  readDealInput,
  updateDeal,
  validateDeal,
  type DealInput,
  type DealStageGroup,
} from './deals.js';
import { validateCustomer, type FieldError } from './validate.js';

/** 入力欄1つぶんの定義。画面と、保存処理の両方がこの並びを見る。 */
interface Field {
  /** 送信されたときの名前。`customers` の列名と合わせてある。 */
  name: string;
  label: string;
  /** 複数行で書きたい欄（メモ）だけ true。 */
  multiline?: boolean;
  /** 入力の種類。ブラウザに任せられる補助（電話はテンキー等）のため。 */
  type?: 'text' | 'tel' | 'email';
  required?: boolean;
}

export const CUSTOMER_FIELDS: readonly Field[] = [
  { name: 'name', label: '名前', type: 'text', required: true },
  { name: 'company', label: '会社名', type: 'text' },
  { name: 'phone', label: '電話', type: 'tel' },
  { name: 'email', label: 'メール', type: 'email' },
  { name: 'note', label: 'メモ', multiline: true },
];

/**
 * 画面に出す前に、記号を安全な書き方へ直す。
 * 顧客名に `<` が入っていても、画面の作りが壊れないようにするため。
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
${body}
  </body>
</html>
`;
}

function renderField(field: Field, current = '', errors: readonly FieldError[] = []): string {
  const id = `f-${field.name}`;
  const required = field.required === true ? ' required' : '';
  const value = escapeHtml(current);
  const input = field.multiline
    ? `<textarea id="${id}" name="${field.name}" rows="4"${required}>${value}</textarea>`
    : `<input id="${id}" name="${field.name}" type="${field.type ?? 'text'}" value="${value}"${required} />`;
  const message = errors.find((error) => error.field === field.name);
  const note =
    message === undefined
      ? ''
      : `\n        <strong class="error" id="e-${field.name}">${escapeHtml(message.message)}</strong>`;
  return `      <p>
        <label for="${id}">${field.label}</label><br />
        ${input}${note}
      </p>`;
}

/**
 * 入力欄をまとめて組み立てる。
 *
 * form に novalidate を付けているのは、ブラウザ自身の警告に先を越されないようにするため。
 * 先を越されると、こちらが選んだ言葉が画面に出ない。
 */
function renderForm(
  action: string,
  buttonLabel: string,
  values: Partial<Record<string, string>> = {},
  errors: readonly FieldError[] = [],
): string {
  const summary =
    errors.length === 0
      ? ''
      : `    <p class="error-summary"><strong>入力を確かめてください。</strong></p>\n`;
  const fields = CUSTOMER_FIELDS.map((field) =>
    renderField(field, values[field.name] ?? '', errors),
  ).join('\n');
  return `${summary}    <form method="post" action="${action}" novalidate>
${fields}
      <p><button type="submit">${buttonLabel}</button></p>
    </form>`;
}

/** 送られてきた入力から、表に入れる5つの値を取り出す。登録も書き換えも同じ読み方をする。 */
async function readCustomerInput(
  form: FormData,
): Promise<Pick<CustomerRow, 'name' | 'company' | 'phone' | 'email' | 'note'>> {
  const read = (name: string): string => {
    const value = form.get(name);
    return typeof value === 'string' ? value.trim() : '';
  };
  return {
    name: read('name'),
    company: read('company'),
    phone: read('phone'),
    email: read('email'),
    note: read('note'),
  };
}

export const customers = new Hono<{ Bindings: Env }>();

customers.get('/customers/new', (c) =>
  c.html(
    page(
      '顧客を登録する',
      `    <h1>顧客を登録する</h1>
${renderForm('/customers', '登録')}
    <p><a href="/customers">登録した顧客を見る</a></p>`,
    ),
  ),
);

customers.post('/customers', async (c) => {
  const input = await readCustomerInput(await c.req.formData());
  const errors = validateCustomer(input);
  if (errors.length > 0) {
    // 入力し直しになるので、打った内容はそのまま返す。
    return c.html(
      page(
        '顧客を登録する',
        `    <h1>顧客を登録する</h1>
${renderForm('/customers', '登録', input, errors)}
    <p><a href="/customers">登録した顧客を見る</a></p>`,
      ),
      400,
    );
  }

  await insertCustomer(c.env.DB, input);

  // 保存後に一覧へ送るのは、同じ画面を再読み込みしたときに二重登録されないようにするため。
  return c.redirect('/customers', 303);
});

/** 一覧に出す列。名前と会社名だけ。残りは詳細画面（T006）で見せる。 */
const LIST_COLUMNS = [
  { key: 'name', label: '名前' },
  { key: 'company', label: '会社名' },
] as const;

function renderRow(row: CustomerRow): string {
  // 名前だけを詳細への入口にする。行のどこを押しても飛ぶ作りは、
  // あとで行に操作ボタンを足したときに誤操作の元になる。
  const cells = LIST_COLUMNS.map((column) => {
    const text = escapeHtml(row[column.key]);
    const cell = column.key === 'name' ? `<a href="/customers/${row.id}">${text}</a>` : text;
    return `<td>${cell}</td>`;
  }).join('');
  return `        <tr>${cells}</tr>`;
}

customers.get('/customers', async (c) => {
  const keyword = c.req.query('q') ?? '';
  const rows = await listCustomers(c.env.DB, keyword);
  const head = LIST_COLUMNS.map((column) => `<th>${column.label}</th>`).join('');

  // 探した結果が0件のときは、登録が0件なのか探して見つからないのかを言い分ける。
  const count =
    keyword.trim() === ''
      ? `${rows.length}件`
      : `「${escapeHtml(keyword.trim())}」で探して ${rows.length}件`;

  return c.html(
    page(
      '顧客の一覧',
      `    <h1>顧客の一覧</h1>
    <form method="get" action="/customers">
      <p>
        <label for="f-q">名前や会社名で探す</label><br />
        <input id="f-q" name="q" type="search" value="${escapeHtml(keyword)}" />
        <button type="submit">探す</button>
        ${keyword.trim() === '' ? '' : '<a href="/customers">全部を見る</a>'}
      </p>
    </form>
    <p>${count}</p>
    <table>
      <thead>
        <tr>${head}</tr>
      </thead>
      <tbody>
${rows.map(renderRow).join('\n')}
      </tbody>
    </table>
    <p><a href="/customers/new">顧客を登録する</a></p>`,
    ),
  );
});

/** 顧客が見つからないときの画面。削除されたあと古いアドレスを開くとここへ来る。 */
function notFoundPage(): string {
  return page(
    '見つかりません',
    `    <h1>見つかりません</h1>
    <p>この顧客は削除されたか、もともと存在しません。</p>
    <p><a href="/customers">顧客の一覧へ戻る</a></p>`,
  );
}

/** 詳細に出す項目。入力欄と同じ並びにして、見た目と入力の対応を保つ。 */
const DETAIL_ROWS = [
  { key: 'company', label: '会社名' },
  { key: 'phone', label: '電話' },
  { key: 'email', label: 'メール' },
  { key: 'note', label: 'メモ' },
] as const;

/** 入力欄1つぶんのまちがいを、欄の下に出す形にする。顧客の入力欄と同じ見せ方。 */
function errorNote(field: string, errors: readonly FieldError[]): string {
  const message = errors.find((error) => error.field === field);
  return message === undefined
    ? ''
    : `\n        <strong class="error" id="e-${field}">${escapeHtml(message.message)}</strong>`;
}

/** やり取りを1件足す入力欄。日付と内容だけ。 */
function renderHistoryForm(
  customerId: number,
  values: Partial<HistoryInput> = {},
  errors: readonly FieldError[] = [],
): string {
  const summary =
    errors.length === 0
      ? ''
      : `    <p class="error-summary"><strong>入力を確かめてください。</strong></p>\n`;
  return `${summary}    <form method="post" action="/customers/${customerId}/history" novalidate>
      <p>
        <label for="f-happened_on">日付</label><br />
        <input id="f-happened_on" name="happened_on" type="date" value="${escapeHtml(values.happened_on ?? '')}" required />${errorNote('happened_on', errors)}
      </p>
      <p>
        <label for="f-body">内容</label><br />
        <textarea id="f-body" name="body" rows="4" required>${escapeHtml(values.body ?? '')}</textarea>${errorNote('body', errors)}
      </p>
      <p><button type="submit">やり取りを追加</button></p>
    </form>`;
}

/** 書かれたやり取りを並べる。0件のときは表を出さず、そう書く。 */
function renderHistoryList(rows: readonly HistoryRow[]): string {
  if (rows.length === 0) return '    <p>まだありません。</p>';
  const items = rows
    .map(
      (row) =>
        // 改行を <br /> に置き換えるのは、複数行で書いたものが1行に潰れて読めなくなるため。
        `        <tr><th>${escapeHtml(row.happened_on)}</th><td>${escapeHtml(row.body).replaceAll('\n', '<br />')}</td><td><a href="/customers/${row.customer_id}/history/${row.id}/edit">編集</a> ／ <a href="/customers/${row.customer_id}/history/${row.id}/delete">削除</a></td></tr>`,
    )
    .join('\n');
  return `    <p>${rows.length}件</p>
    <table>
      <tbody>
${items}
      </tbody>
    </table>`;
}

/** 案件を1件足す入力欄。案件名だけ。進み具合は作った後に変える（T017）。 */
function renderDealForm(
  customerId: number,
  values: Partial<{ title: string }> = {},
  errors: readonly FieldError[] = [],
): string {
  const summary =
    errors.length === 0
      ? ''
      : `    <p class="error-summary"><strong>入力を確かめてください。</strong></p>\n`;
  return `${summary}    <form method="post" action="/customers/${customerId}/deals" novalidate>
      <p>
        <label for="f-title">案件名</label><br />
        <input id="f-title" name="title" type="text" value="${escapeHtml(values.title ?? '')}" required />${errorNote('title', errors)}
      </p>
      <p><button type="submit">案件を追加</button></p>
    </form>`;
}

/**
 * その顧客の案件を並べる。0件のときは表を出さず、そう書く。
 *
 * 案件名の右に進み具合を出している。この画面で「いまどこまで進んだ話か」が
 * 分からないと、1件ずつ開いて確かめることになるため。
 */
function renderDealList(rows: readonly DealRow[]): string {
  if (rows.length === 0) return '    <p>案件はまだありません。</p>';
  const items = rows
    .map(
      (row) =>
        `        <tr><td><a href="/customers/${row.customer_id}/deals/${row.id}">${escapeHtml(row.title)}</a></td><td>${escapeHtml(row.stage)}</td><td>${escapeHtml(formatAmount(row.amount))}</td><td>${escapeHtml(formatExpectedOn(row.expected_on))}</td></tr>`,
    )
    .join('\n');
  return `    <p>案件 ${rows.length}件</p>
    <table>
      <tbody>
${items}
      </tbody>
    </table>`;
}

/** 詳細画面。やり取りの入力欄と一覧も同じ画面に出す。 */
function detailPage(
  row: CustomerRow,
  history: readonly HistoryRow[],
  deals: readonly DealRow[],
  values: Partial<HistoryInput> = {},
  errors: readonly FieldError[] = [],
  dealValues: Partial<{ title: string }> = {},
  dealErrors: readonly FieldError[] = [],
): string {
  const details = DETAIL_ROWS.map(
    (detail) => `        <tr><th>${detail.label}</th><td>${escapeHtml(row[detail.key])}</td></tr>`,
  ).join('\n');

  return page(
    row.name,
    `    <h1>${escapeHtml(row.name)}</h1>
    <table>
      <tbody>
${details}
      </tbody>
    </table>
    <p><a href="/customers/${row.id}/edit">編集</a> ／ <a href="/customers/${row.id}/delete">削除</a></p>
    <h2>案件</h2>
${renderDealForm(row.id, dealValues, dealErrors)}
${renderDealList(deals)}
    <p><a href="/deals">案件を段階ごとに見る</a></p>
    <h2>やり取り</h2>
${renderHistoryForm(row.id, values, errors)}
${renderHistoryList(history)}
    <p><a href="/customers">顧客の一覧へ戻る</a></p>`,
  );
}

customers.get('/customers/:id', async (c) => {
  const id = Number(c.req.param('id'));
  // 数字でない id は探しに行かない。/customers/new のような別の道と取り違えないため。
  if (!Number.isInteger(id) || id <= 0) return c.notFound();

  const row = await findCustomer(c.env.DB, id);
  if (row === null) return c.html(notFoundPage(), 404);

  return c.html(
    detailPage(row, await listHistory(c.env.DB, id), await listDealsOfCustomer(c.env.DB, id)),
  );
});

customers.post('/customers/:id/history', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.notFound();

  const row = await findCustomer(c.env.DB, id);
  if (row === null) return c.html(notFoundPage(), 404);

  const form = await c.req.formData();
  const read = (name: string): string => {
    const value = form.get(name);
    return typeof value === 'string' ? value : '';
  };
  const input: HistoryInput = {
    happened_on: read('happened_on').trim(),
    body: read('body').trim(),
  };

  const errors = validateHistory(input);
  if (errors.length > 0) {
    // 打った内容はそのまま返す。書き直しのために全部打ち直させないため。
    return c.html(
      detailPage(
        row,
        await listHistory(c.env.DB, id),
        await listDealsOfCustomer(c.env.DB, id),
        input,
        errors,
      ),
      400,
    );
  }

  await insertHistory(c.env.DB, id, input);

  // 保存後に詳細へ送り直すのは、再読み込みで同じやり取りが二重に入らないようにするため。
  return c.redirect(`/customers/${id}`, 303);
});

customers.get('/customers/:id/edit', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.notFound();

  const row = await findCustomer(c.env.DB, id);
  if (row === null) return c.html(notFoundPage(), 404);

  return c.html(
    page(
      `${row.name} を編集する`,
      `    <h1>${escapeHtml(row.name)} を編集する</h1>
${renderForm(`/customers/${row.id}`, '保存', row as unknown as Record<string, string>)}
    <p><a href="/customers/${row.id}">やめる</a></p>`,
    ),
  );
});

customers.post('/customers/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.notFound();

  const row = await findCustomer(c.env.DB, id);
  if (row === null) return c.html(notFoundPage(), 404);

  const input = await readCustomerInput(await c.req.formData());
  const errors = validateCustomer(input);
  if (errors.length > 0) {
    // 書き換えでも同じ検査をする。ここを素通りさせると、編集から名前を空にできてしまう。
    return c.html(
      page(
        `${row.name} を編集する`,
        `    <h1>${escapeHtml(row.name)} を編集する</h1>
${renderForm(`/customers/${row.id}`, '保存', input, errors)}
    <p><a href="/customers/${row.id}">やめる</a></p>`,
      ),
      400,
    );
  }

  await updateCustomer(c.env.DB, id, input);

  // 書き換えたあとは詳細へ戻す。何がどう変わったかをその場で見せるため。
  return c.redirect(`/customers/${id}`, 303);
});

customers.get('/customers/:id/delete', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.notFound();

  const row = await findCustomer(c.env.DB, id);
  if (row === null) return c.html(notFoundPage(), 404);

  // ブラウザ標準の確認ダイアログではなく画面で聞き返す。
  // ダイアログは機械から見えず、この項目を人手でしか確かめられなくなるため。
  return c.html(
    page(
      `${row.name} を削除しますか`,
      `    <h1>本当に削除しますか</h1>
    <p>${escapeHtml(row.name)}${row.company === '' ? '' : `（${escapeHtml(row.company)}）`}を削除します。</p>
    <p>やり取りの記録も一緒に消えます。元に戻せません。</p>
    <form method="post" action="/customers/${row.id}/delete">
      <p><button type="submit">はい、削除する</button></p>
    </form>
    <p><a href="/customers/${row.id}">やめる</a></p>`,
    ),
  );
});

customers.post('/customers/:id/delete', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.notFound();

  const row = await findCustomer(c.env.DB, id);
  if (row === null) return c.html(notFoundPage(), 404);

  await deleteCustomer(c.env.DB, id);

  return c.redirect('/customers', 303);
});

/**
 * やり取りの id を取り出して、その顧客のものであることまで確かめる。
 *
 * 顧客の id とやり取りの id を別々に見ると、他人のやり取りを
 * アドレスの数字だけで開けてしまう。両方そろって初めて通す。
 */
async function findHistoryOr404(
  db: D1Database,
  customerIdText: string | undefined,
  historyIdText: string | undefined,
): Promise<{ customer: CustomerRow; entry: HistoryRow } | null> {
  const customerId = Number(customerIdText);
  const historyId = Number(historyIdText);
  if (!Number.isInteger(customerId) || customerId <= 0) return null;
  if (!Number.isInteger(historyId) || historyId <= 0) return null;

  const customer = await findCustomer(db, customerId);
  if (customer === null) return null;

  const entry = await findHistory(db, customerId, historyId);
  if (entry === null) return null;

  return { customer, entry };
}

/** やり取りを1件書き換える入力欄。追加のときと同じ形にして、迷わないようにする。 */
function historyEditPage(
  customer: CustomerRow,
  entry: HistoryRow,
  values: Partial<HistoryInput>,
  errors: readonly FieldError[] = [],
): string {
  const summary =
    errors.length === 0
      ? ''
      : `    <p class="error-summary"><strong>入力を確かめてください。</strong></p>\n`;

  return page(
    `${customer.name} のやり取りを編集する`,
    `    <h1>${escapeHtml(customer.name)} のやり取りを編集する</h1>
${summary}    <form method="post" action="/customers/${customer.id}/history/${entry.id}" novalidate>
      <p>
        <label for="f-happened_on">日付</label><br />
        <input id="f-happened_on" name="happened_on" type="date" value="${escapeHtml(values.happened_on ?? '')}" required />${errorNote('happened_on', errors)}
      </p>
      <p>
        <label for="f-body">内容</label><br />
        <textarea id="f-body" name="body" rows="4" required>${escapeHtml(values.body ?? '')}</textarea>${errorNote('body', errors)}
      </p>
      <p><button type="submit">保存</button></p>
    </form>
    <p><a href="/customers/${customer.id}">やめる</a></p>`,
  );
}

customers.get('/customers/:id/history/:historyId/edit', async (c) => {
  const found = await findHistoryOr404(c.env.DB, c.req.param('id'), c.req.param('historyId'));
  if (found === null) return c.html(notFoundPage(), 404);

  return c.html(
    historyEditPage(found.customer, found.entry, {
      happened_on: found.entry.happened_on,
      body: found.entry.body,
    }),
  );
});

customers.post('/customers/:id/history/:historyId', async (c) => {
  const found = await findHistoryOr404(c.env.DB, c.req.param('id'), c.req.param('historyId'));
  if (found === null) return c.html(notFoundPage(), 404);

  const form = await c.req.formData();
  const input: HistoryInput = {
    happened_on: typeof form.get('happened_on') === 'string' ? String(form.get('happened_on')) : '',
    body: typeof form.get('body') === 'string' ? String(form.get('body')) : '',
  };

  const errors = validateHistory(input);
  if (errors.length > 0) {
    return c.html(historyEditPage(found.customer, found.entry, input, errors), 400);
  }

  await updateHistory(c.env.DB, found.customer.id, found.entry.id, input);

  return c.redirect(`/customers/${found.customer.id}`, 303);
});

customers.get('/customers/:id/history/:historyId/delete', async (c) => {
  const found = await findHistoryOr404(c.env.DB, c.req.param('id'), c.req.param('historyId'));
  if (found === null) return c.html(notFoundPage(), 404);

  // 顧客を消すときと同じく、ブラウザ標準の確認ダイアログではなく画面で聞き返す。
  return c.html(
    page(
      'このやり取りを削除しますか',
      `    <h1>本当に削除しますか</h1>
    <p>${escapeHtml(found.customer.name)} の ${escapeHtml(found.entry.happened_on)} のやり取りを削除します。</p>
    <blockquote>${escapeHtml(found.entry.body).replaceAll('\n', '<br />')}</blockquote>
    <p>元に戻せません。</p>
    <form method="post" action="/customers/${found.customer.id}/history/${found.entry.id}/delete">
      <p><button type="submit">はい、削除する</button></p>
    </form>
    <p><a href="/customers/${found.customer.id}">やめる</a></p>`,
    ),
  );
});

customers.post('/customers/:id/history/:historyId/delete', async (c) => {
  const found = await findHistoryOr404(c.env.DB, c.req.param('id'), c.req.param('historyId'));
  if (found === null) return c.html(notFoundPage(), 404);

  await deleteHistory(c.env.DB, found.customer.id, found.entry.id);

  return c.redirect(`/customers/${found.customer.id}`, 303);
});

customers.post('/customers/:id/deals', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.notFound();

  const row = await findCustomer(c.env.DB, id);
  if (row === null) return c.html(notFoundPage(), 404);

  const input = readDealInput(await c.req.formData());
  const errors = validateDeal(input);
  if (errors.length > 0) {
    return c.html(
      detailPage(
        row,
        await listHistory(c.env.DB, id),
        await listDealsOfCustomer(c.env.DB, id),
        {},
        [],
        input,
        errors,
      ),
      400,
    );
  }

  await insertDeal(c.env.DB, id, input);

  // 保存後に詳細へ送り直すのは、再読み込みで同じ案件が二重に入らないようにするため。
  return c.redirect(`/customers/${id}`, 303);
});

/**
 * 段階ごとに分けた案件の一覧。
 *
 * 顧客の画面（`renderDealList`）と作りを分けているのは、こちらは
 * 「誰の案件か」を出す必要があり、区切りも顧客ではなく段階だから。
 */
function dealsPage(groups: readonly DealStageGroup[]): string {
  const total = groups.reduce((sum, group) => sum + group.deals.length, 0);
  const sections = groups
    .map((group) => {
      const heading = `    <h2>${escapeHtml(group.stage)}（${group.deals.length}件）</h2>`;
      if (group.deals.length === 0) return `${heading}\n    <p>この段階の案件はありません。</p>`;
      const items = group.deals
        .map(
          (deal) =>
            `        <tr><td><a href="/customers/${deal.customer_id}/deals/${deal.id}">${escapeHtml(deal.title)}</a></td><td>${escapeHtml(deal.customer_name)}</td><td>${escapeHtml(formatAmount(deal.amount))}</td><td>${escapeHtml(formatExpectedOn(deal.expected_on))}</td></tr>`,
        )
        .join('\n');
      return `${heading}
    <table>
      <tbody>
${items}
      </tbody>
    </table>`;
    })
    .join('\n');

  return page(
    '案件の一覧',
    `    <h1>案件の一覧</h1>
    <p>ぜんぶで ${total}件</p>
${sections}
    <p><a href="/customers">顧客の一覧へ</a></p>`,
  );
}

customers.get('/deals', async (c) => {
  const rows = await listAllDeals(c.env.DB);
  return c.html(dealsPage(groupDealsByStage(rows)));
});

/**
 * 案件1件の画面。案件名と進み具合を書き換えられる。
 *
 * 段階は自由入力ではなく選択にしている。打ち間違いが混ざると、
 * 段階ごとの一覧（T018）で数が合わなくなるため。
 */
function dealPage(
  customer: CustomerRow,
  deal: DealRow,
  values: Partial<DealInput> = {},
  errors: readonly FieldError[] = [],
): string {
  const title = values.title ?? deal.title;
  const stage = values.stage ?? deal.stage;
  // 打ち直しになったときは、打った文字をそのまま返す（数に直した値ではなく）。
  const amount = values.amount ?? (deal.amount === 0 ? '' : String(deal.amount));
  const expectedOn = values.expected_on ?? deal.expected_on;
  const options = DEAL_STAGES.map(
    (name) =>
      `          <option value="${escapeHtml(name)}"${name === stage ? ' selected' : ''}>${escapeHtml(name)}</option>`,
  ).join('\n');
  const summary =
    errors.length === 0
      ? ''
      : `    <p class="error-summary"><strong>入力を確かめてください。</strong></p>\n`;

  return page(
    `${customer.name} の案件`,
    `    <h1>${escapeHtml(deal.title)}</h1>
    <p>${escapeHtml(customer.name)} の案件</p>
    <p>いまの進み具合: <strong>${escapeHtml(deal.stage)}</strong></p>
    <p>金額: <strong>${escapeHtml(formatAmount(deal.amount))}</strong> ／ 決まりそうな時期: <strong>${escapeHtml(formatExpectedOn(deal.expected_on))}</strong></p>
${summary}    <form method="post" action="/customers/${customer.id}/deals/${deal.id}" novalidate>
      <p>
        <label for="f-title">案件名</label><br />
        <input id="f-title" name="title" type="text" value="${escapeHtml(title)}" required />${errorNote('title', errors)}
      </p>
      <p>
        <label for="f-stage">進み具合</label><br />
        <select id="f-stage" name="stage">
${options}
        </select>${errorNote('stage', errors)}
      </p>
      <p>
        <label for="f-amount">金額（円）</label><br />
        <input id="f-amount" name="amount" type="text" inputmode="numeric" value="${escapeHtml(amount)}" />${errorNote('amount', errors)}
      </p>
      <p>
        <label for="f-expected_on">いつごろ決まりそうか</label><br />
        <input id="f-expected_on" name="expected_on" type="date" value="${escapeHtml(expectedOn)}" />${errorNote('expected_on', errors)}
      </p>
      <p><button type="submit">保存</button></p>
    </form>
    <p><a href="/customers/${customer.id}">${escapeHtml(customer.name)} の画面へ戻る</a></p>`,
  );
}

/** 案件を取り出して、その顧客のものであることまで確かめる。 */
async function findDealOr404(
  db: D1Database,
  customerIdText: string | undefined,
  dealIdText: string | undefined,
): Promise<{ customer: CustomerRow; deal: DealRow } | null> {
  const customerId = Number(customerIdText);
  const dealId = Number(dealIdText);
  if (!Number.isInteger(customerId) || customerId <= 0) return null;
  if (!Number.isInteger(dealId) || dealId <= 0) return null;

  const customer = await findCustomer(db, customerId);
  if (customer === null) return null;

  const deal = await findDeal(db, customerId, dealId);
  if (deal === null) return null;

  return { customer, deal };
}

customers.get('/customers/:id/deals/:dealId', async (c) => {
  const found = await findDealOr404(c.env.DB, c.req.param('id'), c.req.param('dealId'));
  if (found === null) return c.html(notFoundPage(), 404);

  return c.html(dealPage(found.customer, found.deal));
});

customers.post('/customers/:id/deals/:dealId', async (c) => {
  const found = await findDealOr404(c.env.DB, c.req.param('id'), c.req.param('dealId'));
  if (found === null) return c.html(notFoundPage(), 404);

  const input = readDealInput(await c.req.formData());
  const errors = validateDeal(input);
  if (errors.length > 0) {
    return c.html(dealPage(found.customer, found.deal, input, errors), 400);
  }

  await updateDeal(c.env.DB, found.customer.id, found.deal.id, input);

  // 書き換えたあとは同じ案件の画面へ戻す。何がどう変わったかをその場で見せるため。
  return c.redirect(`/customers/${found.customer.id}/deals/${found.deal.id}`, 303);
});
