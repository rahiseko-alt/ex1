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
