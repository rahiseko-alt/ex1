import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { Env } from './db.js';
import { DEAL_STAGES, isDealStage, MAX_TITLE_LENGTH, validateDeal } from './deals.js';
import app from './server.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 手元の SQLite を D1 のふりをさせる（他のテストと同じ作り）。 */
function fakeD1(sqlite: DatabaseSync): D1Database {
  const statement = (sql: string, params: SQLInputValue[]) => ({
    bind: (...args: SQLInputValue[]) => statement(sql, args),
    run: async () => sqlite.prepare(sql).run(...params),
    all: async () => ({ results: sqlite.prepare(sql).all(...params) }),
    first: async () => sqlite.prepare(sql).get(...params) ?? null,
  });
  return { prepare: (sql: string) => statement(sql, []) } as unknown as D1Database;
}

/** `migrations/` にある SQL を番号順に全部当てる（`pnpm run db:setup` と同じ）。 */
function applyAllMigrations(db: DatabaseSync): void {
  const dir = join(repoRoot, 'migrations');
  for (const file of readdirSync(dir).sort()) {
    if (file.endsWith('.sql')) db.exec(readFileSync(join(dir, file), 'utf8'));
  }
}

/** 顧客を1人だけ登録した状態から始める。案件は必ず誰かにぶら下がるため。 */
function newEnv(name = '山田太郎'): { env: Env; sqlite: DatabaseSync; id: number } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  applyAllMigrations(sqlite);
  sqlite.prepare('INSERT INTO customers (name) VALUES (?)').run(name);
  const row = sqlite.prepare('SELECT id FROM customers WHERE name = ?').get(name) as { id: number };
  return { env: { DB: fakeD1(sqlite) }, sqlite, id: row.id };
}

function form(values: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    body: new URLSearchParams(values),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  };
}

describe('進み具合の段階', () => {
  it('段階は商談が進む順に並んでいる', () => {
    expect([...DEAL_STAGES]).toEqual(['問合せ中', '見積提出', '受注', '失注']);
  });

  it.each([...DEAL_STAGES])('段階として認める: %s', (stage) => {
    expect(isDealStage(stage)).toBe(true);
  });

  it.each(['検討中', '', '受注済み', 'won'])('段階として認めない: %s', (stage) => {
    expect(isDealStage(stage)).toBe(false);
  });
});

describe('案件の入力検査', () => {
  it('案件名と段階がそろっていれば通る', () => {
    expect(validateDeal({ title: '事務所の改装', stage: '問合せ中' })).toEqual([]);
  });

  it('案件名が空だと知らせる', () => {
    const errors = validateDeal({ title: '', stage: '問合せ中' });
    expect(errors).toEqual([{ field: 'title', message: '案件名を入力してください' }]);
  });

  it('案件名が空白だけでも空とみなす', () => {
    expect(validateDeal({ title: '   ', stage: '問合せ中' }).map((e) => e.field)).toEqual([
      'title',
    ]);
  });

  it('案件名が長すぎると知らせる', () => {
    const errors = validateDeal({ title: 'あ'.repeat(MAX_TITLE_LENGTH + 1), stage: '問合せ中' });
    expect(errors.map((e) => e.field)).toEqual(['title']);
  });

  it('決めた段階以外は知らせる', () => {
    const errors = validateDeal({ title: '案件', stage: '検討中' });
    expect(errors).toEqual([{ field: 'stage', message: '進み具合を選んでください' }]);
  });
});

describe('顧客に案件をつくれる', () => {
  it('詳細画面に「案件を追加」の入力欄がある', async () => {
    const { env, id } = newEnv();
    const html = await (await app.request(`/customers/${id}`, {}, env)).text();

    expect(html).toContain('<h2>案件</h2>');
    expect(html).toContain('name="title"');
    expect(html).toContain('<button type="submit">案件を追加</button>');
  });

  it('案件がまだ無いときはそう書いてある', async () => {
    const { env, id } = newEnv();
    expect(await (await app.request(`/customers/${id}`, {}, env)).text()).toContain(
      '案件はまだありません。',
    );
  });

  it('案件名を書いて保存すると、その顧客のものとして残る', async () => {
    const { env, sqlite, id } = newEnv();
    const res = await app.request(`/customers/${id}/deals`, form({ title: '事務所の改装' }), env);
    expect(res.status).toBe(303);

    const row = sqlite.prepare('SELECT * FROM deals').get() as Record<string, unknown>;
    expect(row['title']).toBe('事務所の改装');
    expect(row['customer_id']).toBe(id);
  });

  it('保存した案件が同じ画面に出る', async () => {
    const { env, id } = newEnv();
    await app.request(`/customers/${id}/deals`, form({ title: '事務所の改装' }), env);

    const html = await (await app.request(`/customers/${id}`, {}, env)).text();
    expect(html).toContain('事務所の改装');
    expect(html).toContain('案件 1件');
  });

  it('作ったばかりの案件は「問合せ中」から始まる', async () => {
    const { env, sqlite, id } = newEnv();
    await app.request(`/customers/${id}/deals`, form({ title: '事務所の改装' }), env);

    const row = sqlite.prepare('SELECT stage FROM deals').get() as { stage: string };
    expect(row.stage).toBe('問合せ中');
  });

  it('同じ顧客に何件でもつくれる', async () => {
    const { env, id } = newEnv();
    for (const title of ['事務所の改装', '倉庫の増築']) {
      await app.request(`/customers/${id}/deals`, form({ title }), env);
    }

    const html = await (await app.request(`/customers/${id}`, {}, env)).text();
    expect(html).toContain('案件 2件');
    expect(html).toContain('事務所の改装');
    expect(html).toContain('倉庫の増築');
  });

  it('別の顧客の案件は混ざらない', async () => {
    const { env, sqlite, id } = newEnv();
    sqlite.prepare('INSERT INTO customers (name) VALUES (?)').run('鈴木花子');
    const other = (
      sqlite.prepare('SELECT id FROM customers WHERE name = ?').get('鈴木花子') as { id: number }
    ).id;

    await app.request(`/customers/${id}/deals`, form({ title: '山田の案件' }), env);
    await app.request(`/customers/${other}/deals`, form({ title: '鈴木の案件' }), env);

    const html = await (await app.request(`/customers/${id}`, {}, env)).text();
    expect(html).toContain('山田の案件');
    expect(html).not.toContain('鈴木の案件');
  });

  it('案件名が空のままだと保存されず、その場で知らせる', async () => {
    const { env, sqlite, id } = newEnv();
    const res = await app.request(`/customers/${id}/deals`, form({ title: '' }), env);

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('案件名を入力してください');
    expect((sqlite.prepare('SELECT COUNT(*) AS n FROM deals').get() as { n: number }).n).toBe(0);
  });

  it('やり直せるように、打った案件名は画面に残る', async () => {
    const { env, id } = newEnv();
    const html = await (
      await app.request(`/customers/${id}/deals`, form({ title: 'あ'.repeat(201) }), env)
    ).text();
    expect(html).toContain('案件名が長すぎます');
    expect(html).toContain('value="あああ');
  });

  it('記号を書いても画面の作りが壊れない', async () => {
    const { env, id } = newEnv();
    await app.request(`/customers/${id}/deals`, form({ title: '<script>x</script>' }), env);

    const html = await (await app.request(`/customers/${id}`, {}, env)).text();
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('居ない顧客の案件は作れない', async () => {
    const { env } = newEnv();
    expect((await app.request('/customers/999/deals', form({ title: '案件' }), env)).status).toBe(
      404,
    );
  });
});
