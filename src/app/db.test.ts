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
  db.exec(readFileSync(join(repoRoot, 'migrations', '0001_customers.sql'), 'utf8'));
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
