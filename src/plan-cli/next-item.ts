import { nextItem, type PlanItem } from '../plan.js';
import { isMain } from './is-main.js';
import { loadPlan, planPathFromArgv } from './load-plan.js';

export function formatNextItem(item: PlanItem | undefined): string {
  if (item === undefined) {
    return '着手できる項目がありません。すべて終わったか、残りが誰かの完了待ちです。';
  }
  return [
    `次に着手するのは ${item.id} です。`,
    '',
    `  やること: ${item.title}`,
    `  終わった状態: ${item.deliverable}`,
    '  確かめ方:',
    ...item.verify.map((step, index) => `    ${index + 1}. ${step}`),
    `  触るファイル: ${item.files.join(', ')}`,
  ].join('\n');
}

if (isMain(import.meta.url)) {
  console.log(formatNextItem(nextItem(loadPlan(planPathFromArgv(process.argv)))));
}
