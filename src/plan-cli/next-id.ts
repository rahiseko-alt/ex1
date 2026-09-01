import { nextId } from '../plan.js';
import { isMain } from './is-main.js';
import { loadPlan, planPathFromArgv } from './load-plan.js';

export function formatNextId(id: string): string {
  return [
    `次に追記する項目の番号は ${id} です。`,
    '既存の最大値 +1 です。番号は手で決めないでください（過去の PR や台帳からの参照が壊れます）。',
  ].join('\n');
}

if (isMain(import.meta.url)) {
  console.log(formatNextId(nextId(loadPlan(planPathFromArgv(process.argv)))));
}
