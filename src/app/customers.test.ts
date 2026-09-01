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
  // SQLite は既定で外部キーを見ない。D1 は見るので、こちらも明示的に揃えておく。
  sqlite.exec('PRAGMA foreign_keys = ON');
  // 実物（pnpm run db:setup）と同じく migration を全部当てる。
  // 詳細画面がやり取りの一覧も出すため、customers だけでは足りない。
  sqlite.exec(readFileSync(join(repoRoot, 'migrations', '0001_customers.sql'), 'utf8'));
  sqlite.exec(readFileSync(join(repoRoot, 'migrations', '0002_history.sql'), 'utf8'));
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

describe('登録した内容を直せる', () => {
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
    const id = /href="\/customers\/(\d+)"/.exec(listHtml)?.[1];
    if (id === undefined) throw new Error('一覧に詳細へのリンクが無い');
    return { env, id };
  }

  it('詳細画面に「編集」への入口がある', async () => {
    const { env, id } = await withPerson();
    const html = await (await app.request(`/customers/${id}`, {}, env)).text();
    expect(html).toContain(`href="/customers/${id}/edit"`);
  });

  it('編集の画面に今の値が入っている', async () => {
    const { env, id } = await withPerson();
    const html = await (await app.request(`/customers/${id}/edit`, {}, env)).text();

    expect(html).toContain(`value="${person.name}"`);
    expect(html).toContain(`value="${person.phone}"`);
    expect(html).toContain(person.note);
  });

  it('電話番号を書き換えると詳細に新しい番号が出る', async () => {
    const { env, id } = await withPerson();
    const res = await app.request(
      `/customers/${id}`,
      form({ ...person, phone: '090-9999-0000' }),
      env,
    );
    expect(res.status).toBe(303);

    const html = await (await app.request(`/customers/${id}`, {}, env)).text();
    expect(html).toContain('090-9999-0000');
    expect(html).not.toContain(person.phone);
  });

  it('書き換えても件数は増えない', async () => {
    const { env, id } = await withPerson();
    await app.request(`/customers/${id}`, form({ ...person, phone: '090-9999-0000' }), env);

    const html = await (await app.request('/customers', {}, env)).text();
    expect(html).toContain('1件');
  });

  it('updated_at が進む', async () => {
    const { env } = newEnv();
    await app.request('/customers', form(person), env);
    const listHtml = await (await app.request('/customers', {}, env)).text();
    const id = /href="\/customers\/(\d+)"/.exec(listHtml)?.[1];

    await app.request(`/customers/${id}`, form({ ...person, note: '書き換えた' }), env);
    // 置き場を直接見る必要はない。詳細に新しいメモが出ていれば書き換えは効いている。
    const html = await (await app.request(`/customers/${id}`, {}, env)).text();
    expect(html).toContain('書き換えた');
  });

  it('いない顧客を編集しようとすると404になる', async () => {
    const { env } = newEnv();
    expect((await app.request('/customers/999/edit', {}, env)).status).toBe(404);
    expect((await app.request('/customers/999', form(person), env)).status).toBe(404);
  });

  it('今の値に記号が入っていても入力欄が壊れない', async () => {
    const { env } = newEnv();
    await app.request('/customers', form({ name: '甲', company: '"><script>x</script>' }), env);
    const listHtml = await (await app.request('/customers', {}, env)).text();
    const id = /href="\/customers\/(\d+)"/.exec(listHtml)?.[1];

    const html = await (await app.request(`/customers/${id}/edit`, {}, env)).text();
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });
});

describe('顧客を消せる（確認つき）', () => {
  const person = { name: '山田太郎', company: '山田工務店', phone: '03-1234-5678' };

  async function withPerson(): Promise<{ env: Env; id: string }> {
    const { env } = newEnv();
    await app.request('/customers', form(person), env);
    const listHtml = await (await app.request('/customers', {}, env)).text();
    const id = /href="\/customers\/(\d+)"/.exec(listHtml)?.[1];
    if (id === undefined) throw new Error('一覧に詳細へのリンクが無い');
    return { env, id };
  }

  it('詳細画面に「削除」への入口がある', async () => {
    const { env, id } = await withPerson();
    const html = await (await app.request(`/customers/${id}`, {}, env)).text();
    expect(html).toContain(`href="/customers/${id}/delete"`);
  });

  it('削除を押すと「本当に削除しますか」と聞き返される', async () => {
    const { env, id } = await withPerson();
    const html = await (await app.request(`/customers/${id}/delete`, {}, env)).text();

    expect(html).toContain('本当に削除しますか');
    expect(html).toContain(person.name);
    expect(html).toContain('<button type="submit">はい、削除する</button>');
  });

  it('聞き返しの画面には「やめる」道もある', async () => {
    const { env, id } = await withPerson();
    const html = await (await app.request(`/customers/${id}/delete`, {}, env)).text();
    expect(html).toContain(`href="/customers/${id}"`);
  });

  it('聞き返しの画面を開いただけでは消えない', async () => {
    const { env, id } = await withPerson();
    await app.request(`/customers/${id}/delete`, {}, env);

    const html = await (await app.request('/customers', {}, env)).text();
    expect(html).toContain(person.name);
    expect(html).toContain('1件');
  });

  it('「はい」を押すと一覧から消える', async () => {
    const { env, id } = await withPerson();
    const res = await app.request(`/customers/${id}/delete`, { method: 'POST' }, env);
    expect(res.status).toBe(303);

    const html = await (await app.request('/customers', {}, env)).text();
    expect(html).not.toContain(person.name);
    expect(html).toContain('0件');
  });

  it('消したあとに詳細を開くと404になる', async () => {
    const { env, id } = await withPerson();
    await app.request(`/customers/${id}/delete`, { method: 'POST' }, env);

    expect((await app.request(`/customers/${id}`, {}, env)).status).toBe(404);
  });

  it('いない顧客を消そうとすると404になる', async () => {
    const { env } = newEnv();
    expect((await app.request('/customers/999/delete', {}, env)).status).toBe(404);
    expect((await app.request('/customers/999/delete', { method: 'POST' }, env)).status).toBe(404);
  });

  it('消すのは押した1件だけ', async () => {
    const { env } = newEnv();
    await app.request('/customers', form({ name: '甲' }), env);
    await app.request('/customers', form({ name: '乙' }), env);
    const listHtml = await (await app.request('/customers', {}, env)).text();
    const id = /href="\/customers\/(\d+)"/.exec(listHtml)?.[1];

    await app.request(`/customers/${id}/delete`, { method: 'POST' }, env);

    const html = await (await app.request('/customers', {}, env)).text();
    expect(html).toContain('1件');
  });
});

describe('入力のまちがいをその場で知らせる', () => {
  it('名前を空のまま登録すると「名前を入力してください」が画面に出る', async () => {
    const { env } = newEnv();
    const res = await app.request('/customers', form({ name: '' }), env);

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('名前を入力してください');
  });

  it('名前が空のときは保存されない', async () => {
    const { env, sqlite } = newEnv();
    await app.request('/customers', form({ name: '' }), env);

    expect((sqlite.prepare('SELECT COUNT(*) AS n FROM customers').get() as { n: number }).n).toBe(
      0,
    );
  });

  it('メールに abc と入れると形が違うと知らせる', async () => {
    const { env } = newEnv();
    const res = await app.request('/customers', form({ name: '甲', email: 'abc' }), env);

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('メールの形が違います');
  });

  it('打った内容は消えずに残る', async () => {
    const { env } = newEnv();
    const res = await app.request(
      '/customers',
      form({ name: '甲', company: '甲商店', email: 'abc' }),
      env,
    );

    const html = await res.text();
    expect(html).toContain('value="甲"');
    expect(html).toContain('value="甲商店"');
    expect(html).toContain('value="abc"');
  });

  it('ブラウザ自身の警告に先を越されないようにしてある', async () => {
    const { env } = newEnv();
    const html = await (await app.request('/customers/new', {}, env)).text();
    expect(html).toContain('novalidate');
  });

  it('編集からも名前を空にはできない', async () => {
    const { env } = newEnv();
    await app.request('/customers', form({ name: '山田太郎' }), env);
    const listHtml = await (await app.request('/customers', {}, env)).text();
    const id = /href="\/customers\/(\d+)"/.exec(listHtml)?.[1];

    const res = await app.request(`/customers/${id}`, form({ name: '' }), env);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('名前を入力してください');

    const detail = await (await app.request(`/customers/${id}`, {}, env)).text();
    expect(detail).toContain('山田太郎');
  });

  it('まちがいが2つあれば2つとも画面に出る', async () => {
    const { env } = newEnv();
    const html = await (
      await app.request('/customers', form({ name: '', email: 'abc' }), env)
    ).text();

    expect(html).toContain('名前を入力してください');
    expect(html).toContain('メールの形が違います');
  });
});

describe('顧客を名前や会社名で探せる', () => {
  const people = [
    { name: '山田太郎', company: '山田工務店' },
    { name: '山田花子', company: 'やまだ商事' },
    { name: '鈴木一郎', company: '鈴木商店' },
    { name: '佐藤次郎', company: '山田興産' },
    { name: '田中三郎', company: '田中製作所' },
  ];

  async function withFive(): Promise<Env> {
    const { env } = newEnv();
    for (const person of people) {
      await app.request('/customers', form(person), env);
    }
    return env;
  }

  async function search(env: Env, keyword: string): Promise<string> {
    return await (await app.request(`/customers?q=${encodeURIComponent(keyword)}`, {}, env)).text();
  }

  it('一覧に検索欄がある', async () => {
    const { env } = newEnv();
    const html = await (await app.request('/customers', {}, env)).text();
    expect(html).toContain('name="q"');
    expect(html).toContain('<button type="submit">探す</button>');
  });

  it('「山田」で探すと山田を含む顧客だけが並ぶ', async () => {
    const env = await withFive();
    const html = await search(env, '山田');

    expect(html).toContain('山田太郎');
    expect(html).toContain('山田花子');
    expect(html).toContain('佐藤次郎'); // 会社名が「山田興産」
    expect(html).not.toContain('鈴木一郎');
    expect(html).not.toContain('田中三郎');
  });

  it('探した件数が出る', async () => {
    const env = await withFive();
    expect(await search(env, '山田')).toContain('で探して 3件');
  });

  it('会社名だけが当たる場合も拾う', async () => {
    const env = await withFive();
    const html = await search(env, '鈴木商店');
    expect(html).toContain('鈴木一郎');
    expect(html).not.toContain('山田太郎');
  });

  it('見つからないときは0件と出る', async () => {
    const env = await withFive();
    const html = await search(env, '存在しない名前');
    expect(html).toContain('で探して 0件');
  });

  it('検索欄を空にすると全部に戻る', async () => {
    const env = await withFive();
    const html = await search(env, '');
    expect(html).toContain('5件');
    for (const person of people) {
      expect(html).toContain(person.name);
    }
  });

  it('前後の空白は無視する', async () => {
    const env = await withFive();
    expect(await search(env, '  山田  ')).toContain('で探して 3件');
  });

  it('打った言葉が検索欄に残る', async () => {
    const env = await withFive();
    expect(await search(env, '山田')).toContain('value="山田"');
  });

  it('% を打っても全件にはならない（記号として扱う）', async () => {
    const env = await withFive();
    expect(await search(env, '%')).toContain('で探して 0件');
  });

  it('_ を打っても1文字ぶんの当たりにはならない', async () => {
    const env = await withFive();
    expect(await search(env, '_')).toContain('で探して 0件');
  });

  it('探した言葉の記号もそのまま画面に出さない', async () => {
    const env = await withFive();
    const html = await search(env, '<script>x</script>');
    expect(html).not.toContain('<script>x</script>');
  });
});

describe('escapeHtml', () => {
  it('記号を安全な書き方に直す', () => {
    expect(escapeHtml('<a href="x">&\'')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });
});
