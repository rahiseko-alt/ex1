/**
 * 案件。置き場への読み書きと、入力の検査だけを持つ。
 *
 * 画面の組み立て（HTML）はここに置かず `customers.ts` 側にある。両方をここへ入れると、
 * 顧客の画面と互いに import し合う形になり、どちらが先に読まれるかで壊れるため
 * （`history.ts` と同じ理由）。
 */
import type { DealRow } from './db.js';
import { isRealDate, type FieldError } from './validate.js';

/**
 * 進み具合の段階。**この並びが正本で、`migrations/0003_deals.sql` の CHECK と
 * 同じ4つにしてある。** 片方だけ増やすと、画面で選べるのに保存できない状態になる。
 *
 * 並び順は商談が進む順。画面の選択肢と、段階ごとの一覧（T018）の列の順に使う。
 */
export const DEAL_STAGES = ['問合せ中', '見積提出', '受注', '失注'] as const;

export type DealStage = (typeof DEAL_STAGES)[number];

/** 段階として決めた4つのどれかか。 */
export function isDealStage(value: string): value is DealStage {
  return (DEAL_STAGES as readonly string[]).includes(value);
}

/** 書き込む1件ぶん。`deals` の列名と合わせてある。 */
export interface DealInput {
  title: string;
  stage: string;
  /** 打たれたままの金額。`500000` でも `500,000` でも受ける。空文字は「まだ分からない」。 */
  amount: string;
  /** 決まりそうな時期。`2026-03-20` の形。空文字は「まだ分からない」。 */
  expected_on: string;
}

/** 金額の上限（1兆円）。桁を打ち間違えたまま保存されるのを止めるための線引き。 */
export const MAX_AMOUNT = 1_000_000_000_000;

/**
 * 打たれた金額を数にする。読めなければ null。
 *
 * 桁区切りのコンマと全角の空白を落としてから見る。金額は他所から
 * コピーして貼ることが多く、`500,000` を弾くと打ち直しになるため。
 */
export function parseAmount(value: string): number | null {
  const cleaned = value.replaceAll(',', '').replaceAll('\u3000', '').trim();
  if (cleaned === '') return 0;
  if (!/^\d+$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** 画面に出す形（`500,000円`）。0 のときは「未定」。 */
export function formatAmount(amount: number): string {
  if (amount === 0) return '未定';
  return `${amount.toLocaleString('ja-JP')}円`;
}

/** 画面に出す形。空のときは「未定」。 */
export function formatExpectedOn(value: string): string {
  return value === '' ? '未定' : value;
}

/** 案件名に入れられる長さの上限。 */
export const MAX_TITLE_LENGTH = 200;

/** まちがいを全部返す。空配列なら問題なし。 */
export function validateDeal(input: DealInput): FieldError[] {
  const errors: FieldError[] = [];

  if (input.title.trim() === '') {
    errors.push({ field: 'title', message: '案件名を入力してください' });
  } else if (input.title.length > MAX_TITLE_LENGTH) {
    errors.push({ field: 'title', message: `案件名が長すぎます（${MAX_TITLE_LENGTH}文字まで）` });
  }

  if (!isDealStage(input.stage)) {
    errors.push({ field: 'stage', message: '進み具合を選んでください' });
  }

  const amount = parseAmount(input.amount);
  if (amount === null) {
    errors.push({ field: 'amount', message: '金額は数字で入力してください（例: 500000）' });
  } else if (amount > MAX_AMOUNT) {
    errors.push({ field: 'amount', message: '金額が大きすぎます。桁を確かめてください' });
  }

  const expected = input.expected_on.trim();
  if (expected !== '' && !isRealDate(expected)) {
    errors.push({
      field: 'expected_on',
      message: '時期の形が違います。例: 2026-03-20 のように入力してください',
    });
  }

  return errors;
}

/**
 * 送られてきた入力から、表に入れる値を取り出す。
 *
 * 段階が送られてこないときは最初の段階（問合せ中）にする。
 * 案件を作る画面（T016）は段階を選ばせず、作った後に変える（T017）ため。
 */
export function readDealInput(form: FormData): DealInput {
  const read = (name: string): string => {
    const value = form.get(name);
    return typeof value === 'string' ? value : '';
  };
  const stage = read('stage');
  return {
    title: read('title').trim(),
    stage: stage === '' ? DEAL_STAGES[0] : stage,
    amount: read('amount').trim(),
    expected_on: read('expected_on').trim(),
  };
}

/** 案件を1件つくる。 */
export async function insertDeal(
  db: D1Database,
  customerId: number,
  input: DealInput,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO deals (customer_id, title, stage, amount, expected_on) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(
      customerId,
      input.title.trim(),
      input.stage,
      parseAmount(input.amount) ?? 0,
      input.expected_on.trim(),
    )
    .run();
}

/**
 * その顧客の案件を返す。新しく作ったものが上。
 *
 * 段階の順ではなく作った順にしているのは、顧客の画面では
 * 「最近どんな話が動いているか」を先に見たいため。段階ごとの並びは一覧（T018）が受け持つ。
 */
export async function listDealsOfCustomer(db: D1Database, customerId: number): Promise<DealRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM deals WHERE customer_id = ? ORDER BY id DESC')
    .bind(customerId)
    .all<DealRow>();
  return results;
}

/**
 * その顧客の案件を1件返す。見つからなければ null。
 *
 * `customer_id` も条件に入れているのは、アドレスの数字を書き換えただけで
 * 別の顧客の案件を触れないようにするため（`history.ts` と同じ考え方）。
 */
export async function findDeal(
  db: D1Database,
  customerId: number,
  id: number,
): Promise<DealRow | null> {
  return await db
    .prepare('SELECT * FROM deals WHERE id = ? AND customer_id = ?')
    .bind(id, customerId)
    .first<DealRow>();
}

/** 案件を1件書き換える。`updated_at` も進める。 */
export async function updateDeal(
  db: D1Database,
  customerId: number,
  id: number,
  input: DealInput,
): Promise<void> {
  await db
    .prepare(
      `UPDATE deals
          SET title = ?, stage = ?, amount = ?, expected_on = ?, updated_at = datetime('now')
        WHERE id = ? AND customer_id = ?`,
    )
    .bind(
      input.title.trim(),
      input.stage,
      parseAmount(input.amount) ?? 0,
      input.expected_on.trim(),
      id,
      customerId,
    )
    .run();
}

/** 案件と、その持ち主の名前。段階ごとの一覧では「誰の案件か」が分からないと使えないため。 */
export interface DealWithCustomer extends DealRow {
  customer_name: string;
}

/**
 * 全員ぶんの案件を、持ち主の名前つきで返す。新しく作ったものが上。
 *
 * 顧客ごとの一覧（`listDealsOfCustomer`）と分けているのは、
 * こちらは「いま動いている商談を全部見る」用で、持ち主の名前が要るため。
 */
export async function listAllDeals(db: D1Database): Promise<DealWithCustomer[]> {
  const { results } = await db
    .prepare(
      `SELECT deals.*, customers.name AS customer_name
         FROM deals
         JOIN customers ON customers.id = deals.customer_id
        ORDER BY deals.id DESC`,
    )
    .all<DealWithCustomer>();
  return results;
}

/** 段階ごとの区切り1つぶん。 */
export interface DealStageGroup {
  stage: DealStage;
  deals: DealWithCustomer[];
}

/**
 * 段階ごとに分ける。並びは `DEAL_STAGES`（商談が進む順）。
 *
 * 1件も無い段階も残している。抜けていると「案件が無い」のか
 * 「その段階が画面から消えている」のか、見た人に区別が付かないため。
 */
export function groupDealsByStage(rows: readonly DealWithCustomer[]): DealStageGroup[] {
  return DEAL_STAGES.map((stage) => ({
    stage,
    deals: rows.filter((row) => row.stage === stage),
  }));
}
