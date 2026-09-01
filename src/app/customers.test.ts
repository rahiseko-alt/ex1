import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CUSTOMER_FIELDS, escapeHtml } from './customers.js';
import type { Env } from './db.js';
import app from './server.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * 手元の SQLite を D1 のふりをさせる。D1 は SQLite なので、保存されたかどうかを
 * 本物と同じ SQL で確かめられる。wrangler を起動しないぶん CI で毎回まわせる。
 */
function fakeD1(sqlite: DatabaseSync): D1Database {
  const statement = (sql: string, params: SQLInputValue[]) => ({
    bind: (...args: SQLInputValue[]) => statement(sql, args),
    run: async () => sqlite.prepare(sql).run(...params),
    all: async () => ({ results: sqlite.prepare(sql).all(...params) }),
    first: async () => sqlite.prepare(sql).get(...params) ?? null,
  });
  return {
    prepare: (sql: string) => statement(sql, []),
  } as unknown as D1Database;
}

function newEnv(): { env: Env; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(join(repoRoot, 'migrations', '0001_customers.sql'), 'utf8'));
  return { env: { DB: fakeD1(sqlite) }, sqlite };
}

function form(values: Record<string, string>): RequestInit {
  const body = new URLSearchParams(values);
  return {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  };
}

describe('顧客を登録する画面', () => {
  it('/customers/new が開く', async () => {
    const { env } = newEnv();
    expect((await app.request('/customers/new', {}, env)).status).toBe(200);
  });

  it('名前・会社名・電話・メール・メモの入力欄が並んでいる', async () => {
    const { env } = newEnv();
    const html = await (await app.request('/customers/new', {}, env)).text();
    for (const field of CUSTOMER_FIELDS) {
      expect(html).toContain(`name="${field.name}"`);
      expect(html).toContain(`>${field.label}</label>`);
    }
  });

  it('入力欄の並びは 名前 → 会社名 → 電話 → メール → メモ の順', async () => {
    const { env } = newEnv();
    const html = await (await app.request('/customers/new', {}, env)).text();
    const positions = CUSTOMER_FIELDS.map((field) => html.indexOf(`name="${field.name}"`));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('「登録」ボタンがある', async () => {
    const { env } = newEnv();
    const html = await (await app.request('/customers/new', {}, env)).text();
    expect(html).toContain('<button type="submit">登録</button>');
  });

  it('名前だけが必須になっている', async () => {
    const { env } = newEnv();
    const html = await (await app.request('/customers/new', {}, env)).text();
    expect(html).toMatch(/id="f-name"[^>]*required/);
    expect(html).not.toMatch(/id="f-company"[^>]*required/);
  });

  it('トップページから登録画面へ行ける', async () => {
    const { env } = newEnv();
    expect(await (await app.request('/', {}, env)).text()).toContain('href="/customers/new"');
  });
});

describe('登録した顧客が消えずに残る', () => {
  it('登録すると置き場に書き込まれる', async () => {
    const { env, sqlite } = newEnv();
    const res = await app.request('/customers', form({ name: '山田太郎' }), env);

    expect(res.status).toBe(303);
    const rows = sqlite.prepare('SELECT name FROM customers').all() as { name: string }[];
    expect(rows.map((row) => row.name)).toEqual(['山田太郎']);
  });

  it('登録のあと一覧に名前が出る（同じ置き場を開き直した想定）', async () => {
    const { env } = newEnv();
    await app.request('/customers', form({ name: '山田太郎' }), env);

    // 別の要求としてもう一度開く。画面の中に持ち越した値ではなく置き場から読んでいることを見る。
    const html = await (await app.request('/customers', {}, env)).text();
    expect(html).toContain('山田太郎');
  });

  it('入力しなかった欄は空文字で埋まる', async () => {
    const { env, sqlite } = newEnv();
    await app.request('/customers', form({ name: '山田太郎' }), env);

    const row = sqlite.prepare('SELECT * FROM customers').get() as Record<string, unknown>;
    expect(row['company']).toBe('');
    expect(row['note']).toBe('');
  });

  it('全部の欄が入力どおりに保存される', async () => {
    const { env, sqlite } = newEnv();
    await app.request(
      '/customers',
      form({
        name: '鈴木花子',
        company: '鈴木商店',
        phone: '03-1234-5678',
        email: 'hanako@example.com',
        note: '紹介元は山田さん',
      }),
      env,
    );

    const row = sqlite.prepare('SELECT * FROM customers').get() as Record<string, unknown>;
    expect(row['company']).toBe('鈴木商店');
    expect(row['phone']).toBe('03-1234-5678');
    expect(row['email']).toBe('hanako@example.com');
    expect(row['note']).toBe('紹介元は山田さん');
  });

  it('前後の空白は落として保存する', async () => {
    const { env, sqlite } = newEnv();
    await app.request('/customers', form({ name: '  山田太郎  ' }), env);

    const row = sqlite.prepare('SELECT name FROM customers').get() as { name: string };
    expect(row.name).toBe('山田太郎');
  });

  it('名前に記号が入っていても画面の作りが壊れない', async () => {
    const { env } = newEnv();
    await app.request('/customers', form({ name: '<script>x</script>' }), env);

    const html = await (await app.request('/customers', {}, env)).text();
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  // 並び順は文字コード順（佐藤 U+4F50 → 鈴木 U+9234 → 青木 U+9752）で、五十音順ではない。
  // 五十音順にはふりがなの欄が要るため、T031 として計画の末尾に積んである。
  it('一覧は入れた順ではなく決まった順に並ぶ', async () => {
    const { env } = newEnv();
    for (const name of ['青木', '佐藤', '鈴木']) {
      await app.request('/customers', form({ name }), env);
    }

    const html = await (await app.request('/customers', {}, env)).text();
    const order = ['佐藤', '鈴木', '青木'].map((name) => html.indexOf(name));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe('顧客の一覧', () => {
  const people = [
    { name: '山田太郎', company: '山田工務店' },
    { name: '鈴木花子', company: '鈴木商店' },
    { name: '佐藤次郎', company: '佐藤製作所' },
  ];

  async function withThreeCustomers(): Promise<{ env: Env; html: string }> {
    const { env } = newEnv();
    for (const person of people) {
      await app.request('/customers', form(person), env);
    }
    const html = await (await app.request('/customers', {}, env)).text();
    return { env, html };
  }

  it('登録した3件すべてが並ぶ', async () => {
    const { html } = await withThreeCustomers();
    for (const person of people) {
      expect(html).toContain(person.name);
    }
  });

  it('名前と会社名がどちらも出る', async () => {
    const { html } = await withThreeCustomers();
    for (const person of people) {
      expect(html).toContain(person.company);
    }
  });

  it('見出しに「名前」と「会社名」がある', async () => {
    const { html } = await withThreeCustomers();
    expect(html).toContain('<th>名前</th>');
    expect(html).toContain('<th>会社名</th>');
  });

  it('件数が出る', async () => {
    const { html } = await withThreeCustomers();
    expect(html).toContain('3件');
  });

  it('同じ行に名前と会社名が並ぶ', async () => {
    const { html } = await withThreeCustomers();
    // 名前は詳細への入口（T006）になっているので、id を問わない形で見る。
    expect(html).toMatch(
      /<tr><td><a href="\/customers\/\d+">山田太郎<\/a><\/td><td>山田工務店<\/td><\/tr>/,
    );
  });

  it('会社名が空でも行が出る', async () => {
    const { env } = newEnv();
    await app.request('/customers', form({ name: '名無しの権兵衛' }), env);

    const html = await (await app.request('/customers', {}, env)).text();
    expect(html).toMatch(
      /<tr><td><a href="\/customers\/\d+">名無しの権兵衛<\/a><\/td><td><\/td><\/tr>/,
    );
    expect(html).toContain('1件');
  });

  it('会社名の記号もそのまま画面に出さない', async () => {
    const { env } = newEnv();
    await app.request('/customers', form({ name: '甲', company: '<b>乙</b>' }), env);

    const html = await (await app.request('/customers', {}, env)).text();
    expect(html).not.toContain('<b>乙</b>');
    expect(html).toContain('&lt;b&gt;');
  });
});

describe('顧客1件の詳細', () => {
  const person = {
    name: '山田太郎',
    company: '山田工務店',
    phone: '03-1234-5678',
    email: 'taro@example.com',
    note: '紹介元は佐藤さん',
  };

  async function withPerson(): Promise<{ env: Env; id: string }> {
    const { env } = newEnv();
    await app.request('/customers', form(person), env);
    const listHtml = await (await app.request('/customers', {}, env)).text();
    const match = /href="\/customers\/(\d+)"/.exec(listHtml);
    if (match?.[1] === undefined) throw new Error('一覧に詳細へのリンクが無い');
    return { env, id: match[1] };
  }

  it('一覧の名前が詳細への入口になっている', async () => {
    const { id } = await withPerson();
    expect(Number(id)).toBeGreaterThan(0);
  });

  it('電話・メール・メモが全部出る', async () => {
    const { env, id } = await withPerson();
    const html = await (await app.request(`/customers/${id}`, {}, env)).text();

    expect(html).toContain(person.phone);
    expect(html).toContain(person.email);
    expect(html).toContain(person.note);
    expect(html).toContain(person.company);
  });

  it('見出しがその人の名前になる', async () => {
    const { env, id } = await withPerson();
    const html = await (await app.request(`/customers/${id}`, {}, env)).text();
    expect(html).toContain(`<h1>${person.name}</h1>`);
  });

  it('一覧へ戻る道がある', async () => {
    const { env, id } = await withPerson();
    const html = await (await app.request(`/customers/${id}`, {}, env)).text();
    expect(html).toContain('href="/customers"');
  });

  it('いない顧客を開くと404になり、一覧へ戻れる', async () => {
    const { env } = newEnv();
    const res = await app.request('/customers/999', {}, env);

    expect(res.status).toBe(404);
    expect(await res.text()).toContain('href="/customers"');
  });

  it('/customers/new は詳細と取り違えられない', async () => {
    const { env } = newEnv();
    const html = await (await app.request('/customers/new', {}, env)).text();
    expect(html).toContain('<h1>顧客を登録する</h1>');
  });

  it('メモの記号もそのまま画面に出さない', async () => {
    const { env } = newEnv();
    await app.request('/customers', form({ name: '甲', note: '<img src=x>' }), env);
    const listHtml = await (await app.request('/customers', {}, env)).text();
    const id = /href="\/customers\/(\d+)"/.exec(listHtml)?.[1];

    const html = await (await app.request(`/customers/${id}`, {}, env)).text();
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;img');
  });
});

describe('escapeHtml', () => {
  it('記号を安全な書き方に直す', () => {
    expect(escapeHtml('<a href="x">&\'')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });
});
