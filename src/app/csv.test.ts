import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BOM,
  CSV_COLUMNS,
  csvFileName,
  parseCustomersCsv,
  toCsv,
  type CsvCustomer,
} from './csv.js';
import type { Env } from './db.js';
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

function newEnv(): { env: Env; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const dir = join(repoRoot, 'migrations');
  for (const file of readdirSync(dir).sort()) {
    if (file.endsWith('.sql')) sqlite.exec(readFileSync(join(dir, file), 'utf8'));
  }
  return { env: { DB: fakeD1(sqlite) }, sqlite };
}

function form(values: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    body: new URLSearchParams(values),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  };
}

const person = (name: string, extra: Partial<CsvCustomer> = {}): CsvCustomer => ({
  name,
  company: '',
  phone: '',
  email: '',
  note: '',
  ...extra,
});

describe('CSV に書き出す', () => {
  it('1行目は見出し', () => {
    expect(toCsv([]).replace(BOM, '')).toBe('名前,会社名,電話,メール,メモ\r\n');
  });

  it('1人が1行になる', () => {
    const csv = toCsv([
      person('山田太郎', { company: '山田工務店', phone: '090-1111-2222' }),
      person('鈴木花子'),
    ]);
    const lines = csv.replace(BOM, '').trimEnd().split('\r\n');

    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('山田太郎,山田工務店,090-1111-2222,,');
    expect(lines[2]).toBe('鈴木花子,,,,');
  });

  it('コンマを含む値は引用符で囲む', () => {
    const csv = toCsv([person('山田太郎', { note: '住所は東京都,港区' })]);
    expect(csv).toContain('"住所は東京都,港区"');
  });

  it('引用符は2つ重ねて表す', () => {
    const csv = toCsv([person('山田太郎', { note: '通称"タロー"' })]);
    expect(csv).toContain('"通称""タロー"""');
  });

  it('改行を含むメモでも1人1行が崩れない（引用符の中に入る）', () => {
    const csv = toCsv([person('山田太郎', { note: '1行目\n2行目' })]);
    expect(csv).toContain('"1行目\n2行目"');
  });

  it('Excel が文字化けしないよう先頭に印（BOM）を付ける', () => {
    expect(toCsv([]).startsWith(BOM)).toBe(true);
  });

  it('ファイル名に日付が入る', () => {
    expect(csvFileName(new Date(2026, 8, 2))).toBe('customers-2026-09-02.csv');
  });

  it('書き出しと取り込みで使う列は名前・会社名・電話・メール・メモ', () => {
    expect(CSV_COLUMNS.map((column) => column.key)).toEqual([
      'name',
      'company',
      'phone',
      'email',
      'note',
    ]);
  });
});

describe('画面から書き出す', () => {
  it('一覧に「書き出し」の入口がある', async () => {
    const { env } = newEnv();
    await app.request('/customers', form({ name: '山田太郎' }), env);
    expect(await (await app.request('/customers', {}, env)).text()).toContain(
      'href="/customers/export"',
    );
  });

  it('押すとファイルとして落ちてくる', async () => {
    const { env } = newEnv();
    const res = await app.request('/customers/export', {}, env);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    // 画面に出すのではなく保存させる指定。
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(res.headers.get('content-disposition')).toMatch(
      /filename="customers-\d{4}-\d{2}-\d{2}\.csv"/,
    );
  });

  it('登録した3件が1行ずつ全部入っている', async () => {
    const { env } = newEnv();
    for (const name of ['山田太郎', '鈴木花子', '佐藤一郎']) {
      await app.request('/customers', form({ name, company: `${name[0]}社` }), env);
    }

    const csv = await (await app.request('/customers/export', {}, env)).text();
    const lines = csv.replace(BOM, '').trimEnd().split('\r\n');

    expect(lines).toHaveLength(4); // 見出し + 3件
    expect(csv).toContain('山田太郎');
    expect(csv).toContain('鈴木花子');
    expect(csv).toContain('佐藤一郎');
  });

  it('入力した中身がそのまま入る', async () => {
    const { env } = newEnv();
    await app.request(
      '/customers',
      form({
        name: '山田太郎',
        company: '山田工務店',
        phone: '090-1111-2222',
        email: 'yamada@example.com',
        note: 'メモです',
      }),
      env,
    );

    const csv = await (await app.request('/customers/export', {}, env)).text();
    expect(csv).toContain('山田太郎,山田工務店,090-1111-2222,yamada@example.com,メモです');
  });

  it('ごみ箱の中の顧客は書き出されない', async () => {
    const { env } = newEnv();
    await app.request('/customers', form({ name: '山田太郎' }), env);
    await app.request('/customers', form({ name: '鈴木花子' }), env);
    await app.request('/customers/1/delete', { method: 'POST' }, env);

    const csv = await (await app.request('/customers/export', {}, env)).text();
    expect(csv).not.toContain('山田太郎');
    expect(csv).toContain('鈴木花子');
  });
});

describe('CSV を読み取る', () => {
  it('見出しと3件を読み取る', () => {
    const { customers, problems } = parseCustomersCsv(
      '名前,会社名,電話,メール,メモ\r\n山田太郎,山田工務店,090-1,a@example.com,メモ1\r\n鈴木花子,,,,\r\n佐藤一郎,佐藤商事,,,\r\n',
    );

    expect(problems).toEqual([]);
    expect(customers).toHaveLength(3);
    expect(customers[0]).toEqual({
      name: '山田太郎',
      company: '山田工務店',
      phone: '090-1',
      email: 'a@example.com',
      note: 'メモ1',
    });
  });

  it('書き出したものをそのまま読み戻せる', () => {
    const original = [
      { name: '山田太郎', company: '山田,工務店', phone: '090-1', email: '', note: '通称"タロー"' },
      { name: '鈴木花子', company: '', phone: '', email: '', note: '1行目\n2行目' },
    ];
    const { customers, problems } = parseCustomersCsv(toCsv(original));

    expect(problems).toEqual([]);
    expect(customers).toEqual(original);
  });

  it('改行が LF だけでも読める（Excel 以外で作ったファイル）', () => {
    const { customers } = parseCustomersCsv('名前,会社名\n山田太郎,山田工務店\n');
    expect(customers).toEqual([
      { name: '山田太郎', company: '山田工務店', phone: '', email: '', note: '' },
    ]);
  });

  it('列の順番が入れ替わっていても、見出しを見て読む', () => {
    const { customers } = parseCustomersCsv('会社名,名前\n山田工務店,山田太郎\n');
    expect(customers[0]?.name).toBe('山田太郎');
    expect(customers[0]?.company).toBe('山田工務店');
  });

  it('空の行は読み飛ばす', () => {
    const { customers, problems } = parseCustomersCsv('名前\n山田太郎\n\n\n鈴木花子\n');
    expect(problems).toEqual([]);
    expect(customers.map((row) => row.name)).toEqual(['山田太郎', '鈴木花子']);
  });

  it('名前が空の行は、行番号つきで知らせる', () => {
    const { problems } = parseCustomersCsv('名前,会社名\n山田太郎,山田工務店\n,鈴木デザイン\n');
    expect(problems).toEqual([{ line: 3, message: '名前が空です' }]);
  });

  it('見出しが無いファイルは知らせる', () => {
    const { problems } = parseCustomersCsv('山田太郎,山田工務店\n鈴木花子,\n');
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain('1行目に見出しが要ります');
  });

  it('空のファイルは知らせる', () => {
    expect(parseCustomersCsv('').problems).toEqual([{ line: 1, message: 'ファイルが空です' }]);
  });
});

describe('画面から取り込む', () => {
  /** ファイルを1つ送る形（画面の「取り込む」ボタンと同じ）。 */
  function upload(text: string, fileName = 'customers.csv'): RequestInit {
    const body = new FormData();
    body.append('file', new File([text], fileName, { type: 'text/csv' }));
    return { method: 'POST', body };
  }

  it('一覧に「取り込み」の入口がある', async () => {
    const { env } = newEnv();
    await app.request('/customers', form({ name: '山田太郎' }), env);
    expect(await (await app.request('/customers', {}, env)).text()).toContain(
      'href="/customers/import"',
    );
  });

  it('取り込みの画面にファイルを選ぶ欄がある', async () => {
    const { env } = newEnv();
    const html = await (await app.request('/customers/import', {}, env)).text();
    expect(html).toContain('type="file"');
    expect(html).toContain('enctype="multipart/form-data"');
  });

  it('3件のファイルを取り込むと、一覧に3件並ぶ', async () => {
    const { env } = newEnv();
    const csv =
      '名前,会社名,電話,メール,メモ\r\n山田太郎,山田工務店,090-1,a@example.com,メモ1\r\n鈴木花子,鈴木デザイン,,,\r\n佐藤一郎,佐藤商事,,,\r\n';

    const res = await app.request('/customers/import', upload(csv), env);
    expect(res.status).toBe(303);

    const html = await (await app.request('/customers', {}, env)).text();
    expect(html).toContain('3件');
    for (const name of ['山田太郎', '鈴木花子', '佐藤一郎']) {
      expect(html).toContain(name);
    }
  });

  it('取り込んだ中身が詳細にも入っている', async () => {
    const { env } = newEnv();
    await app.request(
      '/customers/import',
      upload('名前,会社名,電話,メール,メモ\n山田太郎,山田工務店,090-1111,a@example.com,メモです\n'),
      env,
    );

    const html = await (await app.request('/customers/1', {}, env)).text();
    expect(html).toContain('山田工務店');
    expect(html).toContain('090-1111');
    expect(html).toContain('メモです');
  });

  it('書き出したファイルをそのまま取り込める', async () => {
    const { env } = newEnv();
    for (const name of ['山田太郎', '鈴木花子']) {
      await app.request(
        '/customers',
        form({ name, company: `${name}商店`, note: 'メモ, 入り' }),
        env,
      );
    }
    const exported = await (await app.request('/customers/export', {}, env)).text();

    const { env: other } = newEnv();
    await app.request('/customers/import', upload(exported), other);

    const html = await (await app.request('/customers', {}, other)).text();
    expect(html).toContain('2件');
    expect(html).toContain('山田太郎商店');
  });

  it('問題のある行があると、1件も取り込まず行番号を知らせる', async () => {
    const { env } = newEnv();
    const res = await app.request(
      '/customers/import',
      upload('名前,会社名\n山田太郎,山田工務店\n,鈴木デザイン\n'),
      env,
    );

    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain('3行目');
    expect(html).toContain('名前が空です');

    // 1件も入っていない。
    expect(await (await app.request('/customers', {}, env)).text()).toContain('0件');
  });

  it('ファイルを選ばずに押すと知らせる', async () => {
    const { env } = newEnv();
    const body = new FormData();
    const res = await app.request('/customers/import', { method: 'POST', body }, env);

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('ファイルを選んでください。');
  });

  it('見出しだけのファイルは知らせる', async () => {
    const { env } = newEnv();
    const res = await app.request('/customers/import', upload('名前,会社名\n'), env);

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('1件も入っていません');
  });
});

describe('1人も登録していないときの入口', () => {
  it('顧客が0件でも「取り込み」に行ける', async () => {
    const { env } = newEnv();
    const html = await (await app.request('/customers', {}, env)).text();
    expect(html).toContain('まだ1人も登録されていません。');
    expect(html).toContain('href="/customers/import"');
  });
});
