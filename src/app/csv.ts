/**
 * 顧客を表計算ソフト（Excel・Numbers・Google スプレッドシート）で開ける形にする。
 *
 * 書き出し（T025）と取り込み（T026）で同じ列を使うため、列の定義はここ1箇所に置く。
 * 片方だけ列を足すと、書き出したファイルを取り込めない状態になる。
 */
import type { CustomerRow } from './db.js';

/** 書き出す列。**この並びが正本**で、1行目の見出しにもこの言葉をそのまま使う。 */
export const CSV_COLUMNS = [
  { key: 'name', label: '名前' },
  { key: 'company', label: '会社名' },
  { key: 'phone', label: '電話' },
  { key: 'email', label: 'メール' },
  { key: 'note', label: 'メモ' },
] as const satisfies readonly { key: keyof CustomerRow; label: string }[];

export type CsvCustomer = Pick<CustomerRow, (typeof CSV_COLUMNS)[number]['key']>;

/**
 * Excel は先頭に BOM が無いと、日本語を別の文字集合として読んで文字化けする。
 * 3バイトぶん増えるだけなので、常に付ける。
 */
export const BOM = '﻿';

/** 1つの値を CSV の1マスにする。 */
function escapeCell(value: string): string {
  // 引用符・コンマ・改行のどれかが入っていたら、全体を引用符で囲む決まり（RFC 4180）。
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

/**
 * 顧客を CSV の文字列にする。
 *
 * 行の区切りを CRLF にしているのは、古い Excel が LF だけの改行を
 * 1行として読まないことがあるため。
 */
export function toCsv(rows: readonly CsvCustomer[]): string {
  const lines = [CSV_COLUMNS.map((column) => escapeCell(column.label)).join(',')];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((column) => escapeCell(row[column.key])).join(','));
  }
  return BOM + lines.join('\r\n') + '\r\n';
}

/** 書き出すファイルの名前。日付を入れるのは、いつ取った控えかを後から見分けるため。 */
export function csvFileName(today: Date): string {
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return `customers-${yyyy}-${mm}-${dd}.csv`;
}
