/**
 * 案件。置き場への読み書きと、入力の検査だけを持つ。
 *
 * 画面の組み立て（HTML）はここに置かず `customers.ts` 側にある。両方をここへ入れると、
 * 顧客の画面と互いに import し合う形になり、どちらが先に読まれるかで壊れるため
 * （`history.ts` と同じ理由）。
 */
import type { DealRow } from './db.js';
import type { FieldError } from './validate.js';

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
  return { title: read('title').trim(), stage: stage === '' ? DEAL_STAGES[0] : stage };
}

/** 案件を1件つくる。 */
export async function insertDeal(
  db: D1Database,
  customerId: number,
  input: DealInput,
): Promise<void> {
  await db
    .prepare('INSERT INTO deals (customer_id, title, stage) VALUES (?, ?, ?)')
    .bind(customerId, input.title.trim(), input.stage)
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
