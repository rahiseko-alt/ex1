-- 案件に「いくらの話か」と「いつごろ決まりそうか」を足す。
--
-- どちらも空のまま作れるようにしている（既定値つき）。案件は金額が決まる前に
-- 動き始めることが多く、入力を必須にすると案件そのものを登録できなくなるため。
-- 金額は円単位の整数。小数を持たないのは、日本円に小数の商談が無いため。
ALTER TABLE deals ADD COLUMN amount INTEGER NOT NULL DEFAULT 0;

-- 見込みの時期。`2026-03-20` の形。空文字は「まだ分からない」。
ALTER TABLE deals ADD COLUMN expected_on TEXT NOT NULL DEFAULT '';
