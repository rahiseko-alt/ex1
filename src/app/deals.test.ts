import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { Env } from './db.js';
import {
  DEAL_STAGES,
  formatAmount,
  formatExpectedOn,
  groupDealsByStage,
  isDealStage,
  MAX_AMOUNT,
  MAX_TITLE_LENGTH,
  parseAmount,
  validateDeal,
  type DealWithCustomer,
} from './deals.js';
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
    expect(
      validateDeal({ title: '事務所の改装', stage: '問合せ中', amount: '', expected_on: '' }),
    ).toEqual([]);
  });

  it('案件名が空だと知らせる', () => {
    const errors = validateDeal({ title: '', stage: '問合せ中', amount: '', expected_on: '' });
    expect(errors).toEqual([{ field: 'title', message: '案件名を入力してください' }]);
  });

  it('案件名が空白だけでも空とみなす', () => {
    expect(
      validateDeal({ title: '   ', stage: '問合せ中', amount: '', expected_on: '' }).map(
        (e) => e.field,
      ),
    ).toEqual(['title']);
  });

  it('案件名が長すぎると知らせる', () => {
    const errors = validateDeal({
      title: 'あ'.repeat(MAX_TITLE_LENGTH + 1),
      stage: '問合せ中',
      amount: '',
      expected_on: '',
    });
    expect(errors.map((e) => e.field)).toEqual(['title']);
  });

  it('決めた段階以外は知らせる', () => {
    const errors = validateDeal({ title: '案件', stage: '検討中', amount: '', expected_on: '' });
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

describe('案件の進み具合を変えられる', () => {
  /** 案件を1件つくって、その id を返す。 */
  async function withOneDeal(
    env: Env,
    customerId: number,
    title = '事務所の改装',
  ): Promise<number> {
    await app.request(`/customers/${customerId}/deals`, form({ title }), env);
    const html = await (await app.request(`/customers/${customerId}`, {}, env)).text();
    const match = new RegExp(`/customers/${customerId}/deals/(\\d+)`).exec(html);
    if (match?.[1] === undefined) throw new Error('案件の画面への入口が無い');
    return Number(match[1]);
  }

  it('顧客の画面から案件を開ける', async () => {
    const { env, id } = newEnv();
    const dealId = await withOneDeal(env, id);

    const res = await app.request(`/customers/${id}/deals/${dealId}`, {}, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('事務所の改装');
  });

  it('案件の画面に4つの段階が選択肢として並ぶ', async () => {
    const { env, id } = newEnv();
    const dealId = await withOneDeal(env, id);

    const html = await (await app.request(`/customers/${id}/deals/${dealId}`, {}, env)).text();
    for (const stage of DEAL_STAGES) {
      expect(html).toContain(`<option value="${stage}"`);
    }
  });

  it('いまの段階が選ばれた状態で出る', async () => {
    const { env, id } = newEnv();
    const dealId = await withOneDeal(env, id);

    const html = await (await app.request(`/customers/${id}/deals/${dealId}`, {}, env)).text();
    expect(html).toContain('<option value="問合せ中" selected>');
    expect(html).not.toContain('<option value="見積提出" selected>');
  });

  it('「見積提出」に選び直すと画面の表示が変わる', async () => {
    const { env, id } = newEnv();
    const dealId = await withOneDeal(env, id);

    const res = await app.request(
      `/customers/${id}/deals/${dealId}`,
      form({ title: '事務所の改装', stage: '見積提出' }),
      env,
    );
    expect(res.status).toBe(303);

    const html = await (await app.request(`/customers/${id}/deals/${dealId}`, {}, env)).text();
    expect(html).toContain('いまの進み具合: <strong>見積提出</strong>');
    expect(html).toContain('<option value="見積提出" selected>');
  });

  it.each([...DEAL_STAGES])('どの段階にも選び直せる: %s', async (stage) => {
    const { env, sqlite, id } = newEnv();
    const dealId = await withOneDeal(env, id);

    await app.request(
      `/customers/${id}/deals/${dealId}`,
      form({ title: '事務所の改装', stage }),
      env,
    );

    const row = sqlite.prepare('SELECT stage FROM deals WHERE id = ?').get(dealId) as {
      stage: string;
    };
    expect(row.stage).toBe(stage);
  });

  it('段階を変えても案件名は消えない', async () => {
    const { env, sqlite, id } = newEnv();
    const dealId = await withOneDeal(env, id);

    await app.request(
      `/customers/${id}/deals/${dealId}`,
      form({ title: '事務所の改装', stage: '受注' }),
      env,
    );

    const row = sqlite.prepare('SELECT title FROM deals WHERE id = ?').get(dealId) as {
      title: string;
    };
    expect(row.title).toBe('事務所の改装');
  });

  it('案件名も一緒に書き換えられる', async () => {
    const { env, id } = newEnv();
    const dealId = await withOneDeal(env, id);

    await app.request(
      `/customers/${id}/deals/${dealId}`,
      form({ title: '事務所の全面改装', stage: '見積提出' }),
      env,
    );

    const html = await (await app.request(`/customers/${id}`, {}, env)).text();
    expect(html).toContain('事務所の全面改装');
  });

  it('決めた段階以外を送っても保存されない', async () => {
    const { env, sqlite, id } = newEnv();
    const dealId = await withOneDeal(env, id);

    const res = await app.request(
      `/customers/${id}/deals/${dealId}`,
      form({ title: '事務所の改装', stage: '検討中' }),
      env,
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('進み具合を選んでください');

    const row = sqlite.prepare('SELECT stage FROM deals WHERE id = ?').get(dealId) as {
      stage: string;
    };
    expect(row.stage).toBe('問合せ中');
  });

  it('書き換えても案件は増えない', async () => {
    const { env, sqlite, id } = newEnv();
    const dealId = await withOneDeal(env, id);

    await app.request(
      `/customers/${id}/deals/${dealId}`,
      form({ title: '事務所の改装', stage: '受注' }),
      env,
    );

    expect((sqlite.prepare('SELECT COUNT(*) AS n FROM deals').get() as { n: number }).n).toBe(1);
  });

  it('別の顧客の案件は、アドレスを書き換えても触れない', async () => {
    const { env, sqlite, id } = newEnv();
    sqlite.prepare('INSERT INTO customers (name) VALUES (?)').run('鈴木花子');
    const other = (
      sqlite.prepare('SELECT id FROM customers WHERE name = ?').get('鈴木花子') as { id: number }
    ).id;
    const dealId = await withOneDeal(env, id);

    expect((await app.request(`/customers/${other}/deals/${dealId}`, {}, env)).status).toBe(404);
    expect(
      (
        await app.request(
          `/customers/${other}/deals/${dealId}`,
          form({ title: '乗っ取り', stage: '受注' }),
          env,
        )
      ).status,
    ).toBe(404);

    const row = sqlite.prepare('SELECT title, stage FROM deals WHERE id = ?').get(dealId) as {
      title: string;
      stage: string;
    };
    expect(row.title).toBe('事務所の改装');
    expect(row.stage).toBe('問合せ中');
  });

  it('居ない案件を開くと404になる', async () => {
    const { env, id } = newEnv();
    expect((await app.request(`/customers/${id}/deals/999`, {}, env)).status).toBe(404);
  });
});

describe('段階ごとの案件一覧', () => {
  /** 案件を1件つくり、段階をそこまで進めて、その番号を返す。 */
  async function makeDeal(
    env: Env,
    customerId: number,
    title: string,
    stage: string,
  ): Promise<number> {
    await app.request(`/customers/${customerId}/deals`, form({ title }), env);
    const html = await (await app.request(`/customers/${customerId}`, {}, env)).text();
    const match = new RegExp(`/customers/${customerId}/deals/(\\d+)">${title}`).exec(html);
    if (match?.[1] === undefined) throw new Error(`案件の画面への入口が無い: ${title}`);
    const id = Number(match[1]);
    await app.request(`/customers/${customerId}/deals/${id}`, form({ title, stage }), env);
    return id;
  }

  /** 段階の見出しから次の見出しまで＝その段階の場所だけを取り出す。 */
  function sectionOf(html: string, stage: string): string {
    const part = html.split('<h2>').find((chunk) => chunk.startsWith(stage));
    if (part === undefined) throw new Error(`段階の区切りが無い: ${stage}`);
    return part;
  }

  it('/deals が開ける', async () => {
    const { env } = newEnv();
    const res = await app.request('/deals', {}, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('案件の一覧');
  });

  it('案件が1件も無くても、4つの段階すべてが場所として出る', async () => {
    const { env } = newEnv();
    const html = await (await app.request('/deals', {}, env)).text();
    for (const stage of DEAL_STAGES) {
      expect(html).toContain(`<h2>${stage}（0件）</h2>`);
    }
  });

  it('段階の違う3件が、それぞれ自分の段階の場所に並ぶ', async () => {
    const { env, id } = newEnv();
    await makeDeal(env, id, '事務所の改装', '問合せ中');
    await makeDeal(env, id, '看板の入替', '見積提出');
    await makeDeal(env, id, '駐車場の舗装', '受注');

    const html = await (await app.request('/deals', {}, env)).text();

    expect(sectionOf(html, '問合せ中')).toContain('事務所の改装');
    expect(sectionOf(html, '見積提出')).toContain('看板の入替');
    expect(sectionOf(html, '受注')).toContain('駐車場の舗装');

    // 他の段階の場所に混ざっていないことも見る。混ざっていても上の3つは通ってしまう。
    expect(sectionOf(html, '問合せ中')).not.toContain('看板の入替');
    expect(sectionOf(html, '見積提出')).not.toContain('駐車場の舗装');
    expect(sectionOf(html, '失注')).toContain('この段階の案件はありません。');
  });

  it('段階を変えると、並ぶ場所も移る', async () => {
    const { env, id } = newEnv();
    const dealId = await makeDeal(env, id, '事務所の改装', '問合せ中');

    await app.request(
      `/customers/${id}/deals/${dealId}`,
      form({ title: '事務所の改装', stage: '受注' }),
      env,
    );

    const html = await (await app.request('/deals', {}, env)).text();
    expect(sectionOf(html, '受注')).toContain('事務所の改装');
    expect(sectionOf(html, '問合せ中')).not.toContain('事務所の改装');
  });

  it('誰の案件かが分かる', async () => {
    const { env, sqlite, id } = newEnv();
    sqlite.prepare('INSERT INTO customers (name) VALUES (?)').run('鈴木花子');
    const other = (
      sqlite.prepare('SELECT id FROM customers WHERE name = ?').get('鈴木花子') as { id: number }
    ).id;
    await makeDeal(env, id, '事務所の改装', '問合せ中');
    await makeDeal(env, other, '看板の入替', '問合せ中');

    const section = sectionOf(await (await app.request('/deals', {}, env)).text(), '問合せ中');
    expect(section).toContain('山田太郎');
    expect(section).toContain('鈴木花子');
  });

  it('一覧から案件の画面へ行ける', async () => {
    const { env, id } = newEnv();
    const dealId = await makeDeal(env, id, '事務所の改装', '見積提出');

    const html = await (await app.request('/deals', {}, env)).text();
    expect(html).toContain(`href="/customers/${id}/deals/${dealId}"`);
  });

  it('最初の画面と顧客の画面に、一覧への入口がある', async () => {
    const { env, id } = newEnv();
    expect(await (await app.request('/', {}, env)).text()).toContain('href="/deals"');
    expect(await (await app.request(`/customers/${id}`, {}, env)).text()).toContain(
      'href="/deals"',
    );
  });

  it('件数が段階ごとに出る', async () => {
    const { env, id } = newEnv();
    await makeDeal(env, id, '事務所の改装', '受注');
    await makeDeal(env, id, '看板の入替', '受注');

    const html = await (await app.request('/deals', {}, env)).text();
    expect(html).toContain('<h2>受注（2件）</h2>');
    expect(html).toContain('ぜんぶで 2件');
  });
});

describe('groupDealsByStage', () => {
  it('1件も無い段階も残る。並びは商談が進む順', () => {
    const groups = groupDealsByStage([]);
    expect(groups.map((group) => group.stage)).toEqual([...DEAL_STAGES]);
    expect(groups.every((group) => group.deals.length === 0)).toBe(true);
  });

  it('段階ごとに振り分ける', () => {
    const deal = (id: number, stage: string): DealWithCustomer => ({
      id,
      customer_id: 1,
      title: `案件${id}`,
      stage,
      amount: 0,
      expected_on: '',
      created_at: '2026-09-01 00:00:00',
      updated_at: '2026-09-01 00:00:00',
      customer_name: '山田太郎',
    });

    const groups = groupDealsByStage([deal(1, '受注'), deal(2, '問合せ中'), deal(3, '受注')]);
    const byStage = new Map(groups.map((group) => [group.stage, group.deals.map((d) => d.id)]));

    expect(byStage.get('問合せ中')).toEqual([2]);
    expect(byStage.get('受注')).toEqual([1, 3]);
    expect(byStage.get('失注')).toEqual([]);
  });
});

describe('金額と見込みの時期', () => {
  const ok = { title: '事務所の改装', stage: '問合せ中' };

  it('金額を数にする', () => {
    expect(parseAmount('500000')).toBe(500000);
    expect(parseAmount('500,000')).toBe(500000);
    expect(parseAmount('  500000  ')).toBe(500000);
  });

  it('空欄は 0（まだ分からない）とみなす', () => {
    expect(parseAmount('')).toBe(0);
    expect(parseAmount('   ')).toBe(0);
  });

  it.each(['五十万', '50万', '-100', '1.5', '500 000'])('数として読めない: %s', (value) => {
    expect(parseAmount(value)).toBeNull();
  });

  it('画面に出す形', () => {
    expect(formatAmount(500000)).toBe('500,000円');
    expect(formatAmount(0)).toBe('未定');
    expect(formatExpectedOn('2026-03-20')).toBe('2026-03-20');
    expect(formatExpectedOn('')).toBe('未定');
  });

  it('金額と時期は空でも通る', () => {
    expect(validateDeal({ ...ok, amount: '', expected_on: '' })).toEqual([]);
  });

  it('数でない金額は知らせる', () => {
    const errors = validateDeal({ ...ok, amount: '五十万', expected_on: '' });
    expect(errors.map((e) => e.field)).toEqual(['amount']);
  });

  it('桁が大きすぎる金額は知らせる', () => {
    const errors = validateDeal({ ...ok, amount: String(MAX_AMOUNT + 1), expected_on: '' });
    expect(errors.map((e) => e.field)).toEqual(['amount']);
  });

  it('実在しない日付の時期は知らせる', () => {
    const errors = validateDeal({ ...ok, amount: '', expected_on: '2026-02-31' });
    expect(errors.map((e) => e.field)).toEqual(['expected_on']);
  });

  /** 案件を1件つくって、その番号を返す。 */
  async function withDeal(env: Env, customerId: number): Promise<number> {
    await app.request(`/customers/${customerId}/deals`, form({ title: '事務所の改装' }), env);
    const html = await (await app.request(`/customers/${customerId}`, {}, env)).text();
    const match = new RegExp(`/customers/${customerId}/deals/(\\d+)`).exec(html);
    if (match?.[1] === undefined) throw new Error('案件の画面への入口が無い');
    return Number(match[1]);
  }

  it('案件の画面に金額と時期の欄がある', async () => {
    const { env, id } = newEnv();
    const dealId = await withDeal(env, id);

    const html = await (await app.request(`/customers/${id}/deals/${dealId}`, {}, env)).text();
    expect(html).toContain('id="f-amount"');
    expect(html).toContain('id="f-expected_on"');
  });

  it('入れた金額と時期が保存され、開き直しても残る', async () => {
    const { env, sqlite, id } = newEnv();
    const dealId = await withDeal(env, id);

    await app.request(
      `/customers/${id}/deals/${dealId}`,
      form({
        title: '事務所の改装',
        stage: '見積提出',
        amount: '500000',
        expected_on: '2026-03-20',
      }),
      env,
    );

    const row = sqlite
      .prepare('SELECT amount, expected_on FROM deals WHERE id = ?')
      .get(dealId) as {
      amount: number;
      expected_on: string;
    };
    expect(row.amount).toBe(500000);
    expect(row.expected_on).toBe('2026-03-20');

    const html = await (await app.request(`/customers/${id}/deals/${dealId}`, {}, env)).text();
    expect(html).toContain('500,000円');
    expect(html).toContain('2026-03-20');
  });

  it('案件の一覧に金額と時期が出る', async () => {
    const { env, id } = newEnv();
    const dealId = await withDeal(env, id);
    await app.request(
      `/customers/${id}/deals/${dealId}`,
      form({
        title: '事務所の改装',
        stage: '見積提出',
        amount: '500000',
        expected_on: '2026-03-20',
      }),
      env,
    );

    const html = await (await app.request('/deals', {}, env)).text();
    const row = html.split('<tr>').find((chunk) => chunk.includes('事務所の改装'));
    expect(row).toContain('500,000円');
    expect(row).toContain('2026-03-20');
  });

  it('金額を入れていない案件は「未定」と出る', async () => {
    const { env, id } = newEnv();
    await withDeal(env, id);

    const html = await (await app.request('/deals', {}, env)).text();
    const row = html.split('<tr>').find((chunk) => chunk.includes('事務所の改装'));
    expect(row).toContain('未定');
  });

  it('金額がおかしいときは保存せず、打った内容を返す', async () => {
    const { env, sqlite, id } = newEnv();
    const dealId = await withDeal(env, id);

    const res = await app.request(
      `/customers/${id}/deals/${dealId}`,
      form({ title: '事務所の改装', stage: '問合せ中', amount: '五十万', expected_on: '' }),
      env,
    );

    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain('金額は数字で入力してください（例: 500000）');
    expect(html).toContain('value="五十万"');

    const row = sqlite.prepare('SELECT amount FROM deals WHERE id = ?').get(dealId) as {
      amount: number;
    };
    expect(row.amount).toBe(0);
  });
});
