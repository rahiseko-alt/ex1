import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { listTableNames } from './db.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * `migrations/` にある SQL を番号順に全部当てる。
 *
 * 1つずつ名前で書くと、migration を足したときに書き足し忘れて
 * 「実物では動くのにテストだけ落ちる」状態になる（実際に2度起きた）。
 * `pnpm run db:setup` と同じく、置いてあるものを全部当てる形にしてある。
 */
function applyAllMigrations(db: DatabaseSync): void {
  const dir = join(repoRoot, 'migrations');
  for (const file of readdirSync(dir).sort()) {
    if (file.endsWith('.sql')) db.exec(readFileSync(join(dir, file), 'utf8'));
  }
}

/**
 * D1 は SQLite なので、同じ SQL を手元の SQLite にかければ表の形を検査できる。
 * wrangler を起動せずに済むぶん、CI で毎回まわせる。
 */
function applyMigrations(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  // SQLite は既定で外部キーを見ない。D1 は見るので、こちらも明示的に揃えておく。
  db.exec('PRAGMA foreign_keys = ON');
  applyAllMigrations(db);
  return db;
}

describe('顧客データの置き場', () => {
  it('customers の表ができる', () => {
    const db = applyMigrations();
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    expect(rows.map((row) => row.name)).toContain('customers');
  });

  it('名前・会社名・電話・メール・メモの欄がある', () => {
    const db = applyMigrations();
    const columns = (db.prepare('PRAGMA table_info(customers)').all() as { name: string }[]).map(
      (row) => row.name,
    );
    expect(columns).toEqual(expect.arrayContaining(['name', 'company', 'phone', 'email', 'note']));
  });

  it('名前だけでも1件入れられる（他の欄は空で埋まる）', () => {
    const db = applyMigrations();
    db.prepare('INSERT INTO customers (name) VALUES (?)').run('山田太郎');
    const row = db.prepare('SELECT * FROM customers').get() as Record<string, unknown>;
    expect(row['name']).toBe('山田太郎');
    expect(row['company']).toBe('');
    expect(row['note']).toBe('');
  });

  it('名前が無いものは入れられない', () => {
    const db = applyMigrations();
    expect(() =>
      db.prepare('INSERT INTO customers (company) VALUES (?)').run('株式会社A'),
    ).toThrow();
  });
});

describe('やり取りの記録の置き場', () => {
  it('history の表ができる', () => {
    const db = applyMigrations();
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    expect(rows.map((row) => row.name)).toContain('history');
  });

  it('顧客・日付・内容の欄がある', () => {
    const db = applyMigrations();
    const columns = (db.prepare('PRAGMA table_info(history)').all() as { name: string }[]).map(
      (row) => row.name,
    );
    expect(columns).toEqual(
      expect.arrayContaining(['customer_id', 'happened_on', 'body', 'created_at', 'updated_at']),
    );
  });

  it('顧客1人に何件でもぶら下げられる', () => {
    const db = applyMigrations();
    db.prepare('INSERT INTO customers (name) VALUES (?)').run('山田太郎');
    for (const day of ['2026-01-05', '2026-02-10', '2026-03-20']) {
      db.prepare('INSERT INTO history (customer_id, happened_on, body) VALUES (1, ?, ?)').run(
        day,
        `${day} に電話`,
      );
    }
    const row = db.prepare('SELECT COUNT(*) AS n FROM history WHERE customer_id = 1').get() as {
      n: number;
    };
    expect(row.n).toBe(3);
  });

  it('居ない顧客のやり取りは入れられない', () => {
    const db = applyMigrations();
    expect(() =>
      db
        .prepare('INSERT INTO history (customer_id, happened_on, body) VALUES (?, ?, ?)')
        .run(999, '2026-01-05', '電話'),
    ).toThrow();
  });

  it('日付と内容が空のままでは入れられない', () => {
    const db = applyMigrations();
    db.prepare('INSERT INTO customers (name) VALUES (?)').run('山田太郎');
    expect(() => db.prepare('INSERT INTO history (customer_id) VALUES (1)').run()).toThrow();
  });

  it('顧客を消すと、その人のやり取りも消える', () => {
    const db = applyMigrations();
    db.prepare('INSERT INTO customers (name) VALUES (?)').run('山田太郎');
    db.prepare('INSERT INTO history (customer_id, happened_on, body) VALUES (1, ?, ?)').run(
      '2026-01-05',
      '電話',
    );
    db.prepare('DELETE FROM customers WHERE id = 1').run();
    const row = db.prepare('SELECT COUNT(*) AS n FROM history').get() as { n: number };
    expect(row.n).toBe(0);
  });
});

describe('listTableNames', () => {
  it('置き場が返した表の名前を並べて返す', async () => {
    const db = {
      prepare: () => ({
        all: async () => ({ results: [{ name: 'customers' }, { name: 'd1_migrations' }] }),
      }),
    } as unknown as D1Database;

    await expect(listTableNames(db)).resolves.toEqual(['customers', 'd1_migrations']);
  });
});

describe('案件の置き場', () => {
  it('deals の表ができる', () => {
    const db = applyMigrations();
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    expect(rows.map((row) => row.name)).toContain('deals');
  });

  it('案件名・顧客・進み具合の欄がある', () => {
    const db = applyMigrations();
    const columns = (db.prepare('PRAGMA table_info(deals)').all() as { name: string }[]).map(
      (row) => row.name,
    );
    expect(columns).toEqual(expect.arrayContaining(['title', 'customer_id', 'stage']));
  });

  it('段階を書かなければ「問合せ中」から始まる', () => {
    const db = applyMigrations();
    db.prepare('INSERT INTO customers (name) VALUES (?)').run('山田太郎');
    db.prepare('INSERT INTO deals (customer_id, title) VALUES (1, ?)').run('事務所の改装');

    const row = db.prepare('SELECT stage FROM deals').get() as { stage: string };
    expect(row.stage).toBe('問合せ中');
  });

  it('決めた4つ以外の段階は入れられない', () => {
    const db = applyMigrations();
    db.prepare('INSERT INTO customers (name) VALUES (?)').run('山田太郎');

    expect(() =>
      db
        .prepare('INSERT INTO deals (customer_id, title, stage) VALUES (1, ?, ?)')
        .run('案件', '検討中'),
    ).toThrow();
  });

  it.each(['問合せ中', '見積提出', '受注', '失注'])('段階として入れられる: %s', (stage) => {
    const db = applyMigrations();
    db.prepare('INSERT INTO customers (name) VALUES (?)').run('山田太郎');
    db.prepare('INSERT INTO deals (customer_id, title, stage) VALUES (1, ?, ?)').run('案件', stage);

    const row = db.prepare('SELECT stage FROM deals').get() as { stage: string };
    expect(row.stage).toBe(stage);
  });

  it('居ない顧客の案件は入れられない', () => {
    const db = applyMigrations();
    expect(() =>
      db.prepare('INSERT INTO deals (customer_id, title) VALUES (999, ?)').run('宙に浮いた案件'),
    ).toThrow();
  });

  it('顧客を消すとその人の案件も消える', () => {
    const db = applyMigrations();
    db.prepare('INSERT INTO customers (name) VALUES (?)').run('山田太郎');
    db.prepare('INSERT INTO deals (customer_id, title) VALUES (1, ?)').run('事務所の改装');

    db.prepare('DELETE FROM customers WHERE id = 1').run();

    const left = db.prepare('SELECT COUNT(*) AS n FROM deals').get() as { n: number };
    expect(left.n).toBe(0);
  });

  it('案件名は空にできない', () => {
    const db = applyMigrations();
    db.prepare('INSERT INTO customers (name) VALUES (?)').run('山田太郎');
    expect(() => db.prepare('INSERT INTO deals (customer_id) VALUES (1)').run()).toThrow();
  });
});
