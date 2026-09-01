import type { Plan, PlanItem } from '../plan.js';

/** テスト用の項目。既定値は「依存なし・専用ファイル1つ・未着手」。 */
export function testItem(overrides: Partial<PlanItem> & Pick<PlanItem, 'id'>): PlanItem {
  return {
    title: `${overrides.id} の見出し`,
    deliverable: 'できるもの',
    verify: ['docs/plan.json を開く', '中身を見る'],
    dependsOn: [],
    files: [`src/${overrides.id}.ts`],
    automation: 'ci',
    status: 'todo',
    origin: 'initial',
    ...overrides,
  };
}

export function testPlan(items: PlanItem[]): Plan {
  return { goal: '問題がなければ即リリースできる状態', items };
}
