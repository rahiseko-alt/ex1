import { pathToFileURL } from 'node:url';

/**
 * このファイルが `node <file>` で直接実行されたかを判定する。
 * import されただけのときに標準出力へ書くと、テストの出力を汚す。
 */
export function isMain(importMetaUrl: string): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return importMetaUrl === pathToFileURL(entry).href;
}
