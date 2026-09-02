-- 五十音順に並べるための「ふりがな」。
--
-- 漢字だけでは読み方が決まらない（「東」は ひがし とも あずま とも読む）ため、
-- 並び順は人が入れた読みに頼るしかない。空のままでも登録できる形にしてある。
ALTER TABLE customers ADD COLUMN kana TEXT NOT NULL DEFAULT '';

-- 一覧はこの欄で並べ替えるため。
CREATE INDEX IF NOT EXISTS idx_customers_kana ON customers (kana);
