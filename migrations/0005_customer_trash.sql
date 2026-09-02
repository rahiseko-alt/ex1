-- 消した顧客を「ごみ箱」に入れておくための欄。
--
-- 表から本当に消してしまうと、押し間違いを取り消せない。空文字なら「使っている」、
-- 日時が入っていれば「ごみ箱の中」。真偽値ではなく日時にしているのは、
-- あとで「30日で本当に消す」を足すときに、いつ消したかが要るため。
ALTER TABLE customers ADD COLUMN deleted_at TEXT NOT NULL DEFAULT '';

-- 一覧は「ごみ箱に入っていないものだけ」で毎回引くため。
CREATE INDEX IF NOT EXISTS idx_customers_deleted_at ON customers (deleted_at);
