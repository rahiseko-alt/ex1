/**
 * 入力のまちがいを見つける。
 *
 * ブラウザ任せ（`required` や `type="email"`）にしないのは3つの理由による。
 * 1. 出る文言がブラウザごとに違い、こちらで言葉を選べない
 * 2. ブラウザの警告は画面の外に出るため、機械から見えない（毎回人手で確かめることになる）
 * 3. 画面を通さずに送られてきた入力は素通りする
 */

/** 見つけたまちがい1つ。`field` は `customers` の列名と合わせてある。 */
export interface FieldError {
  field: string;
  message: string;
}

/** 見る対象。入力欄の名前と同じ。 */
export interface CustomerInput {
  name: string;
  company: string;
  phone: string;
  email: string;
  note: string;
}

/**
 * メールらしい形かどうか。
 * 厳密な規格どおりの判定はしない。打ち間違いを拾うのが目的で、
 * 珍しいが正しい書き方を弾いて登録できなくする方が困るため。
 */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * `2026-03-20` の形で、かつ実在する日かどうか。
 *
 * 形だけ見て通すと `2026-02-31` のような日が入り、あとで並べ替えたときに
 * 順番が狂う。Date に通して同じ文字列へ戻るかで確かめている。
 *
 * やり取りの日付（`history.ts`）と案件の見込み時期（`deals.ts`）の両方が使う。
 */
export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

/** 1つの欄に入れられる長さの上限。置き場を守るためというより、貼り付け事故を止めるため。 */
const MAX_LENGTH = 1000;

/** まちがいを全部返す。空配列なら問題なし。最初の1つで打ち切らないのは、一度に直せるようにするため。 */
export function validateCustomer(input: CustomerInput): FieldError[] {
  const errors: FieldError[] = [];

  if (input.name.trim() === '') {
    errors.push({ field: 'name', message: '名前を入力してください' });
  }

  if (input.email !== '' && !looksLikeEmail(input.email)) {
    errors.push({
      field: 'email',
      message: 'メールの形が違います。例: taro@example.com のように入力してください',
    });
  }

  for (const [field, label] of [
    ['name', '名前'],
    ['company', '会社名'],
    ['phone', '電話'],
    ['email', 'メール'],
    ['note', 'メモ'],
  ] as const) {
    if (input[field].length > MAX_LENGTH) {
      errors.push({ field, message: `${label}が長すぎます（${MAX_LENGTH}文字まで）` });
    }
  }

  return errors;
}
