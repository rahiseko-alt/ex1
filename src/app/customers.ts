/**
 * 顧客の画面。いまは登録の入力欄と、登録したものが残っているかを見る一覧だけ。
 *
 * 画面の枠（見出しとメニュー）は T021 で全ページ共通にする予定のため、
 * ここでは最小限の HTML を組み立てるだけにとどめている。
 */
import { Hono } from 'hono';

import { insertCustomer, listCustomers, type CustomerRow, type Env } from './db.js';

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

function renderField(field: Field): string {
  const id = `f-${field.name}`;
  const required = field.required === true ? ' required' : '';
  const input = field.multiline
    ? `<textarea id="${id}" name="${field.name}" rows="4"${required}></textarea>`
    : `<input id="${id}" name="${field.name}" type="${field.type ?? 'text'}"${required} />`;
  return `      <p>
        <label for="${id}">${field.label}</label><br />
        ${input}
      </p>`;
}

export const customers = new Hono<{ Bindings: Env }>();

customers.get('/customers/new', (c) =>
  c.html(
    page(
      '顧客を登録する',
      `    <h1>顧客を登録する</h1>
    <form method="post" action="/customers">
${CUSTOMER_FIELDS.map(renderField).join('\n')}
      <p><button type="submit">登録</button></p>
    </form>
    <p><a href="/customers">登録した顧客を見る</a></p>`,
    ),
  ),
);

customers.post('/customers', async (c) => {
  const form = await c.req.formData();
  const read = (name: string): string => {
    const value = form.get(name);
    return typeof value === 'string' ? value.trim() : '';
  };

  await insertCustomer(c.env.DB, {
    name: read('name'),
    company: read('company'),
    phone: read('phone'),
    email: read('email'),
    note: read('note'),
  });

  // 保存後に一覧へ送るのは、同じ画面を再読み込みしたときに二重登録されないようにするため。
  return c.redirect('/customers', 303);
});

/** 一覧に出す列。名前と会社名だけ。残りは詳細画面（T006）で見せる。 */
const LIST_COLUMNS = [
  { key: 'name', label: '名前' },
  { key: 'company', label: '会社名' },
] as const;

function renderRow(row: CustomerRow): string {
  const cells = LIST_COLUMNS.map((column) => `<td>${escapeHtml(row[column.key])}</td>`).join('');
  return `        <tr>${cells}</tr>`;
}

customers.get('/customers', async (c) => {
  const rows = await listCustomers(c.env.DB);
  const head = LIST_COLUMNS.map((column) => `<th>${column.label}</th>`).join('');

  return c.html(
    page(
      '顧客の一覧',
      `    <h1>顧客の一覧</h1>
    <p>${rows.length}件</p>
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
