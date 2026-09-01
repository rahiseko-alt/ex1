import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { listTableNames } from './db.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * D1 は SQLite なので、同じ SQL を手元の SQLite にかければ表の形を検査できる。
 * wrangler を起動せずに済むぶん、CI で毎回まわせる。
 */
function applyMigrations(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  // SQLite は既定で外部キーを見ない。D1 は見るので、こちらも明示的に揃えておく。
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(readFileSync(join(repoRoot, 'migrations', '0001_customers.sql'), 'utf8'));
  db.exec(readFileSync(join(repoRoot, 'migrations', '0002_history.sql'), 'utf8'));
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
