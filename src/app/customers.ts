/**
 * 顧客の画面。いまは登録の入力欄だけ。
 *
 * 画面の枠（見出しとメニュー）は T021 で全ページ共通にする予定のため、
 * ここでは最小限の HTML を組み立てるだけにとどめている。
 */
import { Hono } from 'hono';

/** 入力欄1つぶんの定義。画面と、後で足す保存処理の両方がこの並びを見る。 */
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

function renderNewCustomerPage(): string {
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>顧客を登録する</title>
  </head>
  <body>
    <h1>顧客を登録する</h1>
    <form method="post" action="/customers">
${CUSTOMER_FIELDS.map(renderField).join('\n')}
      <p><button type="submit">登録</button></p>
    </form>
  </body>
</html>
`;
}

export const customers = new Hono();

customers.get('/customers/new', (c) => c.html(renderNewCustomerPage()));
