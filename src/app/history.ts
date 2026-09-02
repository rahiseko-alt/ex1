/**
 * やり取りの履歴。置き場への読み書きと、入力の検査だけを持つ。
 *
 * 画面の組み立て（HTML）はここに置かず `customers.ts` 側にある。両方をここへ入れると、
 * 顧客の画面と互いに import し合う形になり、どちらが先に読まれるかで壊れるため。
 */
import type { HistoryRow } from './db.js';
import { isRealDate, type FieldError } from './validate.js';

/** 書き込む1件ぶん。`history` の列名と合わせてある。 */
export interface HistoryInput {
  /** やり取りがあった日。`2026-03-20` の形（`input type="date"` が送ってくる形）。 */
  happened_on: string;
  body: string;
}

/** 内容に入れられる長さの上限。顧客のメモより長めにしてあるのは、議事録を貼ることがあるため。 */
export const MAX_BODY_LENGTH = 2000;

/** まちがいを全部返す。空配列なら問題なし。顧客の入力検査と同じ考え方（`validate.ts` の冒頭）。 */
export function validateHistory(input: HistoryInput): FieldError[] {
  const errors: FieldError[] = [];

  if (input.happened_on.trim() === '') {
    errors.push({ field: 'happened_on', message: '日付を入力してください' });
  } else if (!isRealDate(input.happened_on.trim())) {
    errors.push({
      field: 'happened_on',
      message: '日付の形が違います。例: 2026-03-20 のように入力してください',
    });
  }

  if (input.body.trim() === '') {
    errors.push({ field: 'body', message: '内容を入力してください' });
  } else if (input.body.length > MAX_BODY_LENGTH) {
    errors.push({ field: 'body', message: `内容が長すぎます（${MAX_BODY_LENGTH}文字まで）` });
  }

  return errors;
}

/** やり取りを1件書き込む。 */
export async function insertHistory(
  db: D1Database,
  customerId: number,
  input: HistoryInput,
): Promise<void> {
  await db
    .prepare('INSERT INTO history (customer_id, happened_on, body) VALUES (?, ?, ?)')
    .bind(customerId, input.happened_on.trim(), input.body)
    .run();
}

/**
 * その顧客のやり取りを返す。日付の新しいものから、同じ日なら後から書いたものが上。
 *
 * 並び順は `migrations/0002_history.sql` の索引と同じ組にしてある。
 */
export async function listHistory(db: D1Database, customerId: number): Promise<HistoryRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM history WHERE customer_id = ? ORDER BY happened_on DESC, id DESC')
    .bind(customerId)
    .all<HistoryRow>();
  return results;
}

/**
 * その顧客のやり取りを1件返す。見つからなければ null。
 *
 * `customer_id` も条件に入れているのは、アドレスの数字を書き換えただけで
 * 別の顧客のやり取りを触れないようにするため。
 */
export async function findHistory(
  db: D1Database,
  customerId: number,
  id: number,
): Promise<HistoryRow | null> {
  return await db
    .prepare('SELECT * FROM history WHERE id = ? AND customer_id = ?')
    .bind(id, customerId)
    .first<HistoryRow>();
}

/** やり取りを1件書き換える。`updated_at` も進める。 */
export async function updateHistory(
  db: D1Database,
  customerId: number,
  id: number,
  input: HistoryInput,
): Promise<void> {
  await db
    .prepare(
      `UPDATE history
          SET happened_on = ?, body = ?, updated_at = datetime('now')
        WHERE id = ? AND customer_id = ?`,
    )
    .bind(input.happened_on.trim(), input.body, id, customerId)
    .run();
}

/** やり取りを1件消す。 */
export async function deleteHistory(db: D1Database, customerId: number, id: number): Promise<void> {
  await db
    .prepare('DELETE FROM history WHERE id = ? AND customer_id = ?')
    .bind(id, customerId)
    .run();
}
