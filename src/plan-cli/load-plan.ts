import { readFileSync } from 'node:fs';
import { parsePlan, type Plan } from '../plan.js';

/** 既定の計画ファイル。CLI の第1引数で差し替えられる（テスト用の計画を渡すため）。 */
export const DEFAULT_PLAN_PATH = 'docs/plan.json';

/**
 * 計画ファイルを読んで検証する。
 * 壊れた計画をそのまま表示すると「動いているように見える」ため、必ず parsePlan を通す。
 */
export function loadPlan(path: string = DEFAULT_PLAN_PATH): Plan {
  return parsePlan(JSON.parse(readFileSync(path, 'utf8')));
}

/** CLI の第1引数を計画ファイルのパスとして受け取る。省略時は既定値。 */
export function planPathFromArgv(argv: readonly string[]): string {
  return argv[2] ?? DEFAULT_PLAN_PATH;
}
