import { canRunInParallel, type Plan, type PlanItem } from '../plan.js';
import { isMain } from './is-main.js';
import { loadPlan, planPathFromArgv } from './load-plan.js';

/**
 * 同時に進めてよい項目の組をすべて挙げる。
 * 対象は未着手（todo）のうち、依存先がすべて done の項目だけ。
 * 着手できない項目を候補に出すと、選んだ側が依存を踏み外す。
 */
export function parallelPairs(plan: Plan): Array<[PlanItem, PlanItem]> {
  const done = new Set(plan.items.filter((item) => item.status === 'done').map((item) => item.id));
  const ready = plan.items.filter(
    (item) => item.status === 'todo' && item.dependsOn.every((id) => done.has(id)),
  );

  const pairs: Array<[PlanItem, PlanItem]> = [];
  for (let i = 0; i < ready.length; i += 1) {
    for (let j = i + 1; j < ready.length; j += 1) {
      const a = ready[i];
      const b = ready[j];
      if (a && b && canRunInParallel(a, b)) pairs.push([a, b]);
    }
  }
  return pairs;
}

export function formatParallelPairs(pairs: ReadonlyArray<readonly [PlanItem, PlanItem]>): string {
  if (pairs.length === 0) {
    return '今このタイミングで同時に進められる組はありません。1つずつ進めてください。';
  }
  const lines = pairs.map(([a, b]) => `- ${a.id} と ${b.id}\n    ${a.title}\n    ${b.title}`);
  return [
    `同時に進めてよい組が ${pairs.length} 通りあります。`,
    '（依存関係が無く、触るファイルも重ならない組だけを挙げています）',
    '',
    ...lines,
  ].join('\n');
}

if (isMain(import.meta.url)) {
  console.log(formatParallelPairs(parallelPairs(loadPlan(planPathFromArgv(process.argv)))));
}
