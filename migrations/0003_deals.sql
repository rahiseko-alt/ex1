-- 案件。1行が1つの商談にあたる。
--
-- やり取りの履歴（history）と分けているのは、性質が違うため。
-- 履歴は「起きたことを積む」もので消さない。案件は「いま，どこまで進んでいるか」を
-- 表す1つの状態で、進むたびに上書きしていく。
CREATE TABLE IF NOT EXISTS deals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 顧客を消したら、その人の案件も一緒に消える（history と同じ扱い）。
  customer_id  INTEGER NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  title        TEXT    NOT NULL,
  -- 進み具合。取りうる値は src/app/deals.ts の DEAL_STAGES が正本で、
  -- ここでも CHECK で縛る。画面を通さずに書き込まれても、決めた4つ以外は入らない。
  stage        TEXT    NOT NULL DEFAULT '問合せ中'
                 CHECK (stage IN ('問合せ中', '見積提出', '受注', '失注')),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 顧客の詳細画面（T019）は「その顧客の案件だけ」を引く。
CREATE INDEX IF NOT EXISTS idx_deals_customer ON deals (customer_id);

-- 案件の一覧（T018）は段階ごとに分けて出す。
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals (stage);
