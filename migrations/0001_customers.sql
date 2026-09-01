-- 顧客の台帳。1行が1人（または1社の担当者）にあたる。
--
-- 名前だけを必須にしている。電話もメールも分からないまま登録したい場面が実際にあり、
-- ここで必須にすると入力できずに台帳の外へ逃げてしまうため。
CREATE TABLE IF NOT EXISTS customers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  company     TEXT    NOT NULL DEFAULT '',
  phone       TEXT    NOT NULL DEFAULT '',
  email       TEXT    NOT NULL DEFAULT '',
  note        TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 一覧は名前順で出すため。件数が増えてから足すと作り直しになる。
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers (name);
