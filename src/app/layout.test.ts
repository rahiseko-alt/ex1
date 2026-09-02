import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { Env } from './db.js';
import { escapeHtml, MENU, page } from './layout.js';
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

function form(values: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    body: new URLSearchParams(values),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  };
}

/** 顧客と案件を1件ずつ入れた状態から始める。全ページを開いて見比べるため。 */
async function newEnv(): Promise<{ env: Env; customerId: number; dealId: number }> {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  applyAllMigrations(sqlite);
  const env: Env = { DB: fakeD1(sqlite) };

  await app.request('/customers', form({ name: '山田太郎' }), env);
  await app.request('/customers/1/deals', form({ title: '事務所の改装' }), env);
  return { env, customerId: 1, dealId: 1 };
}

/** 画面のあるページを全部（`/` から案件1件まで）。 */
async function everyPage(): Promise<{ path: string; html: string }[]> {
  const { env, customerId, dealId } = await newEnv();
  const paths = [
    '/',
    '/customers',
    '/customers/new',
    `/customers/${customerId}`,
    `/customers/${customerId}/edit`,
    `/customers/${customerId}/delete`,
    '/deals',
    `/customers/${customerId}/deals/${dealId}`,
  ];

  const pages = [];
  for (const path of paths) {
    const res = await app.request(path, {}, env);
    expect(res.status, `${path} が開けない`).toBe(200);
    pages.push({ path, html: await res.text() });
  }
  return pages;
}

describe('どのページも同じ枠になる', () => {
  it('どのページにも上に同じメニューが出る', async () => {
    for (const { path, html } of await everyPage()) {
      expect(html, `${path} にメニューが無い`).toContain('class="site-nav"');
      for (const item of MENU) {
        expect(html, `${path} に ${item.label} が無い`).toContain(
          `<a href="${item.href}">${item.label}</a>`,
        );
      }
    }
  });

  it('どのページも同じ見た目の指定（style.css）を読む', async () => {
    for (const { path, html } of await everyPage()) {
      expect(html, `${path} が style.css を読んでいない`).toContain(
        '<link rel="stylesheet" href="/style.css" />',
      );
    }
  });

  it('どのページも枠の作りがそろっている', async () => {
    for (const { path, html } of await everyPage()) {
      expect(html, `${path} の枠が違う`).toContain('<header class="site-header">');
      expect(html, `${path} に main が無い`).toContain('<main>');
      expect(html, `${path} に画面幅の指定が無い`).toContain('name="viewport"');
    }
  });

  it('ページごとに題名が変わる', async () => {
    const pages = await everyPage();
    const titles = pages.map(({ html }) => /<title>(.*)<\/title>/.exec(html)?.[1]);
    expect(titles.every((title) => title !== undefined && title !== '')).toBe(true);
    // 全部が同じ題名だと、開いているページがタブから分からない。
    expect(new Set(titles).size).toBeGreaterThan(1);
  });

  it('メニューの並びは「顧客」「案件」', () => {
    expect(MENU.map((item) => item.label)).toEqual(['顧客', '案件']);
  });

  it('題名の記号もそのまま出さない', () => {
    expect(page('<script>', '')).toContain('<title>&lt;script&gt;</title>');
  });

  it('escapeHtml は記号を安全な書き方に直す', () => {
    expect(escapeHtml('<a href="x">&\'')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });
});
