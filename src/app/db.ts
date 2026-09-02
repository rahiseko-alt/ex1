/**
 * 顧客データの置き場（Cloudflare D1）への入口。
 *
 * 表の形は `migrations/*.sql` が正本で、ここはその形を TypeScript 側から
 * 扱うための型と、置き場を受け取るための約束だけを持つ。
 * SQL をここに集めないのは、画面ごとの取り出し方がそれぞれ違うため。
 */

/** Workers が実行時に渡してくる置き場。名前は wrangler.toml の binding と一致させる。 */
export interface Env {
  DB: D1Database;
}

/** `customers` の1行。`migrations/0001_customers.sql` と対応する。 */
export interface CustomerRow {
  id: number;
  name: string;
  company: string;
  phone: string;
  email: string;
  note: string;
  /** ごみ箱に入れた日時。空文字なら使っている顧客。 */
  deleted_at: string;
  created_at: string;
  updated_at: string;
}

/**
 * `history` の1行。`migrations/0002_history.sql` と対応する。
 *
 * `happened_on` は「やり取りがあった日」で、書き込んだ日（`created_at`）とは別。
 * 後から思い出して書き足すことがあるため分けている。
 */
export interface HistoryRow {
  id: number;
  customer_id: number;
  happened_on: string;
  body: string;
  created_at: string;
  updated_at: string;
}

/** `deals` の1行。`migrations/0003_deals.sql` と対応する。 */
export interface DealRow {
  id: number;
  customer_id: number;
  title: string;
  stage: string;
  /** 円単位。0 は「まだ分からない」。小数を持たないのは日本円に小数の商談が無いため。 */
  amount: number;
  /** 決まりそうな時期。`2026-03-20` の形。空文字は「まだ分からない」。 */
  expected_on: string;
  created_at: string;
  updated_at: string;
}

/** 置き場にある表の名前を全部返す。中身ではなく「入れ物が出来ているか」を見るために使う。 */
export async function listTableNames(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all<{ name: string }>();
  return results.map((row) => row.name);
}

/** 顧客を1件書き込む。空欄は空文字で埋める（表の既定値と揃える）。 */
export async function insertCustomer(
  db: D1Database,
  input: Pick<CustomerRow, 'name' | 'company' | 'phone' | 'email' | 'note'>,
): Promise<void> {
  await db
    .prepare('INSERT INTO customers (name, company, phone, email, note) VALUES (?, ?, ?, ?, ?)')
    .bind(input.name, input.company, input.phone, input.email, input.note)
    .run();
}

/**
 * 顧客を名前順で返す。`keyword` があれば、名前か会社名にそれを含むものだけ。
 *
 * `LIKE` の前後を `%` で挟むだけの単純な探し方にしている。件数が少ないうちは十分で、
 * ふりがなや読み替えを入れるのは別の項目（T031）の仕事。
 */
export async function listCustomers(db: D1Database, keyword = ''): Promise<CustomerRow[]> {
  const trimmed = keyword.trim();
  if (trimmed === '') {
    const { results } = await db
      .prepare("SELECT * FROM customers WHERE deleted_at = '' ORDER BY name")
      .all<CustomerRow>();
    return results;
  }

  // `%` と `_` は LIKE では「何にでも当たる」記号なので、打ち込まれたら文字として扱う。
  const escaped = trimmed.replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_');
  const pattern = `%${escaped}%`;
  const { results } = await db
    .prepare(
      `SELECT * FROM customers
        WHERE deleted_at = ''
          AND (name LIKE ? ESCAPE '!' OR company LIKE ? ESCAPE '!')
        ORDER BY name`,
    )
    .bind(pattern, pattern)
    .all<CustomerRow>();
  return results;
}

/** 顧客を1件返す。見つからなければ null。 */
export async function findCustomer(db: D1Database, id: number): Promise<CustomerRow | null> {
  // ごみ箱の中の顧客は「無い」ものとして扱う。消したはずの相手の画面が
  // アドレスを覚えているだけで開けると、消えたかどうかが分からなくなるため。
  return await db
    .prepare("SELECT * FROM customers WHERE id = ? AND deleted_at = ''")
    .bind(id)
    .first<CustomerRow>();
}

/** ごみ箱の中の顧客を1件返す。見つからなければ null。 */
export async function findDeletedCustomer(db: D1Database, id: number): Promise<CustomerRow | null> {
  return await db
    .prepare("SELECT * FROM customers WHERE id = ? AND deleted_at <> ''")
    .bind(id)
    .first<CustomerRow>();
}

/** ごみ箱の中身。あとで消したものが上。 */
export async function listDeletedCustomers(db: D1Database): Promise<CustomerRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM customers WHERE deleted_at <> '' ORDER BY deleted_at DESC, id DESC")
    .all<CustomerRow>();
  return results;
}

/** 顧客を1件書き換える。updated_at も同時に進める。 */
export async function updateCustomer(
  db: D1Database,
  id: number,
  input: Pick<CustomerRow, 'name' | 'company' | 'phone' | 'email' | 'note'>,
): Promise<void> {
  await db
    .prepare(
      `UPDATE customers
          SET name = ?, company = ?, phone = ?, email = ?, note = ?, updated_at = datetime('now')
        WHERE id = ?`,
    )
    .bind(input.name, input.company, input.phone, input.email, input.note, id)
    .run();
}

/** 顧客を1件消す。 */
export async function deleteCustomer(db: D1Database, id: number): Promise<void> {
  // 表からは消さず、ごみ箱へ移すだけ。やり取りと案件もぶら下がったまま残るので、
  // 元に戻せば消す前とまったく同じ状態に戻る。
  await db
    .prepare("UPDATE customers SET deleted_at = datetime('now') WHERE id = ? AND deleted_at = ''")
    .bind(id)
    .run();
}

/** ごみ箱から出して、また使えるようにする。 */
export async function restoreCustomer(db: D1Database, id: number): Promise<void> {
  await db
    .prepare("UPDATE customers SET deleted_at = '' WHERE id = ? AND deleted_at <> ''")
    .bind(id)
    .run();
}
