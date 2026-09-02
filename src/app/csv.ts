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

export type CsvColumnKey = (typeof CSV_COLUMNS)[number]['key'];

export type CsvCustomer = Pick<CustomerRow, CsvColumnKey>;

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

/**
 * CSV の文字列を、1行 = 文字列の配列 に切り分ける。
 *
 * 引用符の中ではコンマも改行も区切りにならない（RFC 4180）。この扱いを
 * 自前で書いているのは、外から取り込むファイルは Excel が書いたものが多く、
 * メモの中に改行やコンマが普通に入っているため。
 */
export function parseCsvRows(text: string): string[][] {
  const chars = [...(text.startsWith(BOM) ? text.slice(1) : text)];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i] ?? '';
    if (inQuotes) {
      if (ch === '"') {
        // 引用符が2つ続いていたら、引用符そのもの1文字。
        if (chars[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      // CR は次に来る LF と合わせて1つの改行として扱うので、ここでは捨てる。
      field += ch;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/** 取り込みで見つかった問題1つ。`line` はファイルの中の行番号（1から数える）。 */
export interface CsvProblem {
  line: number;
  message: string;
}

/** 取り込みの結果。問題が1つでもあれば `customers` は使わない。 */
export interface CsvParseResult {
  customers: CsvCustomer[];
  problems: CsvProblem[];
}

/**
 * 取り込んだ CSV を顧客の形にする。
 *
 * 1行目は見出しとして読み、**列の順番はそこから決める**。書き出したものを
 * そのまま戻す使い方だけでなく、表計算ソフトで列を入れ替えた後でも通るようにするため。
 */
export function parseCustomersCsv(text: string): CsvParseResult {
  const rows = parseCsvRows(text).filter((row) => row.some((cell) => cell.trim() !== ''));
  if (rows.length === 0) {
    return { customers: [], problems: [{ line: 1, message: 'ファイルが空です' }] };
  }

  const header = (rows[0] ?? []).map((cell) => cell.trim());
  const indexOf = new Map<string, number>();
  for (const column of CSV_COLUMNS) {
    const at = header.indexOf(column.label);
    if (at >= 0) indexOf.set(column.key, at);
  }

  if (!indexOf.has('name')) {
    return {
      customers: [],
      problems: [
        {
          line: 1,
          message: '1行目に見出しが要ります。「書き出し」で作ったファイルと同じ形にしてください',
        },
      ],
    };
  }

  const customers: CsvCustomer[] = [];
  const problems: CsvProblem[] = [];

  rows.slice(1).forEach((row, at) => {
    const line = at + 2; // 見出しが1行目なので、中身は2行目から
    const read = (key: CsvColumnKey): string => {
      const column = indexOf.get(key);
      return column === undefined ? '' : (row[column] ?? '').trim();
    };

    const name = read('name');
    if (name === '') {
      problems.push({ line, message: '名前が空です' });
      return;
    }

    customers.push({
      name,
      company: read('company'),
      phone: read('phone'),
      email: read('email'),
      note: read('note'),
    });
  });

  return { customers, problems };
}
