-- やり取りの履歴。1行が「いつ・何を話したか」1件にあたる。
--
-- 顧客1人に何件でもぶら下がる形にしている。回数の上限を設けると、
-- 長い付き合いの相手ほど古い記録から捨てることになり、台帳の意味が薄れるため。
CREATE TABLE IF NOT EXISTS history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 顧客を消したら、その人のやり取りも一緒に消える。
  -- 消し忘れた記録だけが残ると、誰のものか分からない行になるため。
  customer_id  INTEGER NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  -- 「いつ」。書いた日ではなく、実際にやり取りがあった日を入れる。
  -- 後から思い出して書くことがあるため、created_at では代用できない。
  happened_on  TEXT    NOT NULL,
  body         TEXT    NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 詳細画面は「その顧客の分だけを新しい順に」出すため、この2つを1組で引く。
CREATE INDEX IF NOT EXISTS idx_history_customer_happened_on
  ON history (customer_id, happened_on DESC);
