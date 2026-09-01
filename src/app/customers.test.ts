import { describe, expect, it } from 'vitest';

import app from './server.js';

import { CUSTOMER_FIELDS } from './customers.js';

describe('顧客を登録する画面', () => {
  it('/customers/new が開く', async () => {
    const res = await app.request('/customers/new');
    expect(res.status).toBe(200);
  });

  it('名前・会社名・電話・メール・メモの入力欄が並んでいる', async () => {
    const html = await (await app.request('/customers/new')).text();
    for (const field of CUSTOMER_FIELDS) {
      expect(html).toContain(`name="${field.name}"`);
      expect(html).toContain(`>${field.label}</label>`);
    }
  });

  it('入力欄の並びは 名前 → 会社名 → 電話 → メール → メモ の順', async () => {
    const html = await (await app.request('/customers/new')).text();
    const positions = CUSTOMER_FIELDS.map((field) => html.indexOf(`name="${field.name}"`));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('「登録」ボタンがある', async () => {
    const html = await (await app.request('/customers/new')).text();
    expect(html).toContain('<button type="submit">登録</button>');
  });

  it('名前だけが必須になっている', async () => {
    const html = await (await app.request('/customers/new')).text();
    expect(html).toMatch(/id="f-name"[^>]*required/);
    expect(html).not.toMatch(/id="f-company"[^>]*required/);
  });

  it('トップページから登録画面へ行ける', async () => {
    const html = await (await app.request('/')).text();
    expect(html).toContain('href="/customers/new"');
  });
});
