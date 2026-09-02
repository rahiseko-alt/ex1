import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MAX_BODY_LENGTH, validateHistory } from './history.js';
import type { Env } from './db.js';
import app from './server.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 手元の SQLite を D1 のふりをさせる（`customers.test.ts` と同じ作り）。 */
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

/** 顧客を1人だけ登録した状態から始める。やり取りは必ず誰かにぶら下がるため。 */
function newEnv(name = '山田太郎'): { env: Env; sqlite: DatabaseSync; id: number } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(readFileSync(join(repoRoot, 'migrations', '0001_customers.sql'), 'utf8'));
  sqlite.exec(readFileSync(join(repoRoot, 'migrations', '0002_history.sql'), 'utf8'));
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

describe('やり取りの入力検査', () => {
  it('日付と内容がそろっていれば通る', () => {
    expect(validateHistory({ happened_on: '2026-03-20', body: '電話で相談を受けた' })).toEqual([]);
  });

  it('日付が空だと知らせる', () => {
    const errors = validateHistory({ happened_on: '', body: '電話' });
    expect(errors.map((error) => error.field)).toEqual(['happened_on']);
    expect(errors[0]?.message).toContain('日付');
  });

  it('内容が空だと知らせる', () => {
    const errors = validateHistory({ happened_on: '2026-03-20', body: '   ' });
    expect(errors.map((error) => error.field)).toEqual(['body']);
  });

  it('日付の形が違うと知らせる', () => {
    expect(validateHistory({ happened_on: '2026/03/20', body: '電話' })).toEqual([
      { field: 'happened_on', message: expect.stringContaining('日付の形') },
    ]);
  });

  it('存在しない日は通さない', () => {
    expect(validateHistory({ happened_on: '2026-02-31', body: '電話' })).toEqual([
      { field: 'happened_on', message: expect.stringContaining('日付の形') },
    ]);
  });

  it('内容が長すぎると知らせる', () => {
    const errors = validateHistory({
      happened_on: '2026-03-20',
      body: 'あ'.repeat(MAX_BODY_LENGTH + 1),
    });
    expect(errors.map((error) => error.field)).toEqual(['body']);
  });

  it('まちがいは一度に全部返す', () => {
    expect(validateHistory({ happened_on: '', body: '' })).toHaveLength(2);
  });
});

describe('顧客にやり取りを1件書ける', () => {
  it('詳細画面に「やり取りを追加」の入力欄がある', async () => {
    const { env, id } = newEnv();
    const html = await (await app.request(`/customers/${id}`, {}, env)).text();
    expect(html).toContain(`action="/customers/${id}/history"`);
    expect(html).toContain('name="happened_on"');
    expect(html).toContain('name="body"');
    expect(html).toContain('<button type="submit">やり取りを追加</button>');
  });

  it('やり取りがまだ無いときはそう書いてある', async () => {
    const { env, id } = newEnv();
    const html = await (await app.request(`/customers/${id}`, {}, env)).text();
    expect(html).toContain('まだありません。');
  });

  it('保存すると置き場に書き込まれる', async () => {
    const { env, sqlite, id } = newEnv();
    const res = await app.request(
      `/customers/${id}/history`,
      form({ happened_on: '2026-03-20', body: '電話で相談を受けた' }),
      env,
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/customers/${id}`);

    const row = sqlite.prepare('SELECT * FROM history').get() as Record<string, unknown>;
    expect(row['customer_id']).toBe(id);
    expect(row['happened_on']).toBe('2026-03-20');
    expect(row['body']).toBe('電話で相談を受けた');
  });

  it('保存したやり取りが同じ画面に出る', async () => {
    const { env, id } = newEnv();
    await app.request(
      `/customers/${id}/history`,
      form({ happened_on: '2026-03-20', body: '電話で相談を受けた' }),
      env,
    );
    const html = await (await app.request(`/customers/${id}`, {}, env)).text();
    expect(html).toContain('2026-03-20');
    expect(html).toContain('電話で相談を受けた');
    expect(html).toContain('1件');
  });

  it('同じ顧客に何件でも書ける', async () => {
    const { env, id } = newEnv();
    for (const day of ['2026-01-05', '2026-02-10', '2026-03-20']) {
      await app.request(
        `/customers/${id}/history`,
        form({ happened_on: day, body: `${day} の話` }),
        env,
      );
    }
    const html = await (await app.request(`/customers/${id}`, {}, env)).text();
    expect(html).toContain('3件');
    for (const day of ['2026-01-05', '2026-02-10', '2026-03-20']) {
      expect(html).toContain(`${day} の話`);
    }
  });

  it('別の顧客のやり取りは混ざらない', async () => {
    const { env, sqlite, id } = newEnv();
    sqlite.prepare('INSERT INTO customers (name) VALUES (?)').run('鈴木花子');
    const other = (
      sqlite.prepare('SELECT id FROM customers WHERE name = ?').get('鈴木花子') as {
        id: number;
      }
    ).id;
    await app.request(
      `/customers/${id}/history`,
      form({ happened_on: '2026-03-20', body: '山田の話' }),
      env,
    );
    await app.request(
      `/customers/${other}/history`,
      form({ happened_on: '2026-03-21', body: '鈴木の話' }),
      env,
    );

    const html = await (await app.request(`/customers/${id}`, {}, env)).text();
    expect(html).toContain('山田の話');
    expect(html).not.toContain('鈴木の話');
  });

  it('日付や内容が空のままだと保存されず、その場で知らせる', async () => {
    const { env, sqlite, id } = newEnv();
    const res = await app.request(
      `/customers/${id}/history`,
      form({ happened_on: '', body: '' }),
      env,
    );
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain('日付を入力してください');
    expect(html).toContain('内容を入力してください');

    const count = sqlite.prepare('SELECT COUNT(*) AS n FROM history').get() as { n: number };
    expect(count.n).toBe(0);
  });

  it('やり直せるように、打った内容は画面に残る', async () => {
    const { env, id } = newEnv();
    const html = await (
      await app.request(
        `/customers/${id}/history`,
        form({ happened_on: '', body: '書きかけの内容' }),
        env,
      )
    ).text();
    expect(html).toContain('書きかけの内容');
  });

  it('記号を書いても画面の作りが壊れない', async () => {
    const { env, id } = newEnv();
    await app.request(
      `/customers/${id}/history`,
      form({ happened_on: '2026-03-20', body: '<script>alert(1)</script>' }),
      env,
    );
    const html = await (await app.request(`/customers/${id}`, {}, env)).text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('居ない顧客のやり取りは書けない', async () => {
    const { env } = newEnv();
    expect(
      (
        await app.request(
          '/customers/999/history',
          form({ happened_on: '2026-03-20', body: '話' }),
          env,
        )
      ).status,
    ).toBe(404);
  });
});

describe('やり取りが新しい順に並ぶ', () => {
  /** 詳細画面に出ている日付を、上から順に取り出す。 */
  function datesInOrder(html: string): string[] {
    return [...html.matchAll(/<tr><th>(\d{4}-\d{2}-\d{2})<\/th>/g)].map((m) => m[1] ?? '');
  }

  it('ばらばらに書いても日付の新しいものが上に来る', async () => {
    const { env, id } = newEnv();
    // わざと順番をばらばらに入れる。入れた順に並ぶ作りだと、ここで違いが出る。
    for (const [happened_on, body] of [
      ['2026-03-10', '2番目に新しい'],
      ['2026-01-05', '一番古い'],
      ['2026-05-20', '一番新しい'],
    ] as const) {
      await app.request(`/customers/${id}/history`, form({ happened_on, body }), env);
    }

    const html = await (await app.request(`/customers/${id}`, {}, env)).text();
    expect(datesInOrder(html)).toEqual(['2026-05-20', '2026-03-10', '2026-01-05']);
  });

  it('入れた順に並んでいるわけではない（入力順と並び順が違うことを見る）', async () => {
    const { env, id } = newEnv();
    for (const [happened_on, body] of [
      ['2026-01-05', '先に入れた古い日'],
      ['2026-05-20', '後から入れた新しい日'],
    ] as const) {
      await app.request(`/customers/${id}/history`, form({ happened_on, body }), env);
    }

    const html = await (await app.request(`/customers/${id}`, {}, env)).text();
    expect(html.indexOf('後から入れた新しい日')).toBeLessThan(html.indexOf('先に入れた古い日'));
  });

  it('同じ日なら後から書いたものが上に来る', async () => {
    const { env, id } = newEnv();
    for (const body of ['先に書いた', '後で書いた']) {
      await app.request(`/customers/${id}/history`, form({ happened_on: '2026-03-10', body }), env);
    }

    const html = await (await app.request(`/customers/${id}`, {}, env)).text();
    expect(html.indexOf('後で書いた')).toBeLessThan(html.indexOf('先に書いた'));
  });

  it('年をまたいでも文字列ではなく日付として並ぶ', async () => {
    const { env, id } = newEnv();
    for (const happened_on of ['2025-12-31', '2026-01-01']) {
      await app.request(`/customers/${id}/history`, form({ happened_on, body: happened_on }), env);
    }

    const html = await (await app.request(`/customers/${id}`, {}, env)).text();
    expect(datesInOrder(html)).toEqual(['2026-01-01', '2025-12-31']);
  });

  it('別の顧客のやり取りは並びに混ざらない', async () => {
    const { env, sqlite, id } = newEnv();
    sqlite.prepare('INSERT INTO customers (name) VALUES (?)').run('鈴木花子');
    const other = (
      sqlite.prepare('SELECT id FROM customers WHERE name = ?').get('鈴木花子') as { id: number }
    ).id;

    await app.request(
      `/customers/${id}/history`,
      form({ happened_on: '2026-01-05', body: '山田の分' }),
      env,
    );
    await app.request(
      `/customers/${other}/history`,
      form({ happened_on: '2026-09-09', body: '鈴木の分' }),
      env,
    );

    const html = await (await app.request(`/customers/${id}`, {}, env)).text();
    expect(datesInOrder(html)).toEqual(['2026-01-05']);
    expect(html).not.toContain('鈴木の分');
  });
});

describe('やり取りを直せる・消せる', () => {
  /** 1件書いて、その id を返す。 */
  async function withOneEntry(
    env: Env,
    customerId: number,
    happened_on = '2026-03-10',
    body = 'はじめの内容',
  ): Promise<number> {
    await app.request(`/customers/${customerId}/history`, form({ happened_on, body }), env);
    const html = await (await app.request(`/customers/${customerId}`, {}, env)).text();
    const match = new RegExp(`/customers/${customerId}/history/(\\d+)/edit`).exec(html);
    if (match?.[1] === undefined) throw new Error('やり取りに編集への入口が無い');
    return Number(match[1]);
  }

  it('やり取りの行に「編集」と「削除」の入口がある', async () => {
    const { env, id } = newEnv();
    const entryId = await withOneEntry(env, id);

    const html = await (await app.request(`/customers/${id}`, {}, env)).text();
    expect(html).toContain(`/customers/${id}/history/${entryId}/edit`);
    expect(html).toContain(`/customers/${id}/history/${entryId}/delete`);
  });

  it('編集の画面に今の値が入っている', async () => {
    const { env, id } = newEnv();
    const entryId = await withOneEntry(env, id, '2026-03-10', 'はじめの内容');

    const html = await (
      await app.request(`/customers/${id}/history/${entryId}/edit`, {}, env)
    ).text();
    expect(html).toContain('value="2026-03-10"');
    expect(html).toContain('はじめの内容');
  });

  it('内容を書き換えると詳細画面に新しい内容が出る', async () => {
    const { env, id } = newEnv();
    const entryId = await withOneEntry(env, id);

    const res = await app.request(
      `/customers/${id}/history/${entryId}`,
      form({ happened_on: '2026-03-10', body: '書き換えた内容' }),
      env,
    );
    expect(res.status).toBe(303);

    const html = await (await app.request(`/customers/${id}`, {}, env)).text();
    expect(html).toContain('書き換えた内容');
    expect(html).not.toContain('はじめの内容');
    expect(html).toContain('1件');
  });

  it('日付も書き換えられ、並び順にも効く', async () => {
    const { env, id } = newEnv();
    const oldEntry = await withOneEntry(env, id, '2026-01-05', '古い日で書いた');
    await app.request(
      `/customers/${id}/history`,
      form({ happened_on: '2026-03-10', body: '間の日' }),
      env,
    );

    await app.request(
      `/customers/${id}/history/${oldEntry}`,
      form({ happened_on: '2026-09-09', body: '古い日で書いた' }),
      env,
    );

    const html = await (await app.request(`/customers/${id}`, {}, env)).text();
    expect(html.indexOf('古い日で書いた')).toBeLessThan(html.indexOf('間の日'));
  });

  it('書き換えでも入力の検査は効く', async () => {
    const { env, id } = newEnv();
    const entryId = await withOneEntry(env, id);

    const res = await app.request(
      `/customers/${id}/history/${entryId}`,
      form({ happened_on: '2026-02-31', body: '内容' }),
      env,
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('日付の形が違います');

    // 元の内容は残っている。
    const detail = await (await app.request(`/customers/${id}`, {}, env)).text();
    expect(detail).toContain('はじめの内容');
  });

  it('削除は一度聞き返してから消える', async () => {
    const { env, id } = newEnv();
    const entryId = await withOneEntry(env, id);

    const ask = await (
      await app.request(`/customers/${id}/history/${entryId}/delete`, {}, env)
    ).text();
    expect(ask).toContain('本当に削除しますか');
    expect(ask).toContain('<button type="submit">はい、削除する</button>');

    // 聞き返しを開いただけでは消えない。
    expect(await (await app.request(`/customers/${id}`, {}, env)).text()).toContain('はじめの内容');

    const res = await app.request(
      `/customers/${id}/history/${entryId}/delete`,
      { method: 'POST' },
      env,
    );
    expect(res.status).toBe(303);

    const html = await (await app.request(`/customers/${id}`, {}, env)).text();
    expect(html).not.toContain('はじめの内容');
    expect(html).toContain('まだありません。');
  });

  it('消すのは押した1件だけ', async () => {
    const { env, id } = newEnv();
    const first = await withOneEntry(env, id, '2026-03-10', '消すほう');
    await app.request(
      `/customers/${id}/history`,
      form({ happened_on: '2026-04-01', body: '残すほう' }),
      env,
    );

    await app.request(`/customers/${id}/history/${first}/delete`, { method: 'POST' }, env);

    const html = await (await app.request(`/customers/${id}`, {}, env)).text();
    expect(html).toContain('残すほう');
    expect(html).not.toContain('消すほう');
    expect(html).toContain('1件');
  });

  it('顧客を消してもやり取りは道連れになるだけで、他人のものは残る', async () => {
    const { env, sqlite, id } = newEnv();
    sqlite.prepare('INSERT INTO customers (name) VALUES (?)').run('鈴木花子');
    const other = (
      sqlite.prepare('SELECT id FROM customers WHERE name = ?').get('鈴木花子') as { id: number }
    ).id;
    await withOneEntry(env, id, '2026-03-10', '山田の分');
    await app.request(
      `/customers/${other}/history`,
      form({ happened_on: '2026-03-11', body: '鈴木の分' }),
      env,
    );

    await app.request(`/customers/${id}/delete`, { method: 'POST' }, env);

    const html = await (await app.request(`/customers/${other}`, {}, env)).text();
    expect(html).toContain('鈴木の分');
  });

  it('別の顧客のやり取りは、アドレスを書き換えても触れない', async () => {
    const { env, sqlite, id } = newEnv();
    sqlite.prepare('INSERT INTO customers (name) VALUES (?)').run('鈴木花子');
    const other = (
      sqlite.prepare('SELECT id FROM customers WHERE name = ?').get('鈴木花子') as { id: number }
    ).id;
    const entryId = await withOneEntry(env, id, '2026-03-10', '山田の分');

    // 鈴木のアドレスから、山田のやり取りの id を指す。
    expect((await app.request(`/customers/${other}/history/${entryId}/edit`, {}, env)).status).toBe(
      404,
    );
    expect(
      (
        await app.request(
          `/customers/${other}/history/${entryId}`,
          form({ happened_on: '2026-03-10', body: '乗っ取り' }),
          env,
        )
      ).status,
    ).toBe(404);
    expect(
      (await app.request(`/customers/${other}/history/${entryId}/delete`, { method: 'POST' }, env))
        .status,
    ).toBe(404);

    // 山田の側は無事。
    const html = await (await app.request(`/customers/${id}`, {}, env)).text();
    expect(html).toContain('山田の分');
    expect(html).not.toContain('乗っ取り');
  });

  it('居ないやり取りを開くと404になる', async () => {
    const { env, id } = newEnv();
    expect((await app.request(`/customers/${id}/history/999/edit`, {}, env)).status).toBe(404);
    expect((await app.request(`/customers/${id}/history/999/delete`, {}, env)).status).toBe(404);
  });
});
