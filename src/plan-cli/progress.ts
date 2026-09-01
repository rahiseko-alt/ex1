import { countProgress, type Plan, type Progress } from '../plan.js';
import { isMain } from './is-main.js';
import { loadPlan, planPathFromArgv } from './load-plan.js';

/** 「全10件のうち3件が終わりました。残り7件です。」の1行を作る。 */
function sentence(label: string, counted: { done: number; total: number }): string {
  const rest = counted.total - counted.done;
  if (counted.total === 0) return `${label}: ありません。`;
  return `${label}: 全${counted.total}件のうち${counted.done}件が終わりました。残り${rest}件です。`;
}

/**
 * 進み具合を日本語の文章で表示する。
 * 合計値はファイルに書かず、その場で数えて出す（同時に働く AI が書き換えると競合するため）。
 * 読み手は非エンジニアなので、計画ファイルの中で使っている英語の項目名はそのまま出さない。
 */
export function formatProgress(progress: Progress, plan: Plan): string {
  const lines = [sentence('進み具合', progress.initial)];

  // 追加分は、実際に追記があったときだけ出す。0件の行は読み手には雑音でしかない。
  if (progress.added.total > 0) {
    lines.push(sentence('あとから足した分', progress.added));
  }

  if (progress.awaitingHuman.length === 0) {
    lines.push('人に見てもらう順番待ち: ありません。');
  } else {
    lines.push(`人に見てもらう順番待ち: ${progress.awaitingHuman.length}件あります。`);
    for (const id of progress.awaitingHuman) {
      const found = plan.items.find((candidate) => candidate.id === id);
      lines.push(`  ・${found?.title ?? id}（${id}）`);
    }
  }

  return lines.join('\n');
}

if (isMain(import.meta.url)) {
  const plan = loadPlan(planPathFromArgv(process.argv));
  console.log(formatProgress(countProgress(plan), plan));
}
