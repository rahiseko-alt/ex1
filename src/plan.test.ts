import { describe, expect, it } from 'vitest';

import {
  canRunInParallel,
  countProgress,
  nextId,
  nextItem,
  parsePlan,
  validatePlan,
  validateVerifySteps,
  type Plan,
  type PlanItem,
} from './plan.js';

function item(overrides: Partial<PlanItem> & Pick<PlanItem, 'id'>): PlanItem {
  return {
    title: '見出し',
    deliverable: 'できるもの',
    verify: ['docs/plan.json を開く', '中身が書かれていることを確認する'],
    dependsOn: [],
    files: [`${overrides.id}.html`],
    automation: 'ci',
    status: 'todo',
    origin: 'initial',
    ...overrides,
  };
}

function plan(items: PlanItem[]): Plan {
  return { goal: '問題がなければ即リリースできる状態', items };
}

describe('validatePlan', () => {
  it('妥当な計画では違反を返さない', () => {
    expect(validatePlan(plan([item({ id: 'T001' }), item({ id: 'T002' })]))).toEqual([]);
  });

  it('id の重複を検出する', () => {
    const errors = validatePlan(plan([item({ id: 'T001' }), item({ id: 'T001' })]));
    expect(errors.some((e) => e.includes('重複'))).toBe(true);
  });

  it('id が昇順でないことを検出する（既存項目の書き換えの兆候）', () => {
    const errors = validatePlan(plan([item({ id: 'T002' }), item({ id: 'T001' })]));
    expect(errors.some((e) => e.includes('昇順'))).toBe(true);
  });

  it('確かめ方が空の項目を弾く', () => {
    const errors = validatePlan(plan([item({ id: 'T001', verify: [] })]));
    expect(errors.some((e) => e.includes('確かめ方'))).toBe(true);
  });

  it('触るファイルが空の項目を弾く', () => {
    const errors = validatePlan(plan([item({ id: 'T001', files: [] })]));
    expect(errors.some((e) => e.includes('触るファイル'))).toBe(true);
  });

  it('存在しない依存先を検出する', () => {
    const errors = validatePlan(plan([item({ id: 'T001', dependsOn: ['T999'] })]));
    expect(errors.some((e) => e.includes('T999'))).toBe(true);
  });

  it('自分自身への依存を検出する', () => {
    const errors = validatePlan(plan([item({ id: 'T001', dependsOn: ['T001'] })]));
    expect(errors.some((e) => e.includes('自分自身'))).toBe(true);
  });

  it('automation と status の値を制限する', () => {
    const errors = validatePlan(
      plan([item({ id: 'T001', automation: 'browser' as never, status: '済' as never })]),
    );
    expect(errors.some((e) => e.includes('automation'))).toBe(true);
    expect(errors.some((e) => e.includes('status'))).toBe(true);
  });

  it('ゴールが空の計画を弾く', () => {
    expect(validatePlan({ goal: '   ', items: [] }).some((e) => e.includes('goal'))).toBe(true);
  });

  it('違反を最初の1件で打ち切らない', () => {
    const errors = validatePlan(plan([item({ id: 'T001', verify: [], files: [] })]));
    expect(errors.length).toBeGreaterThan(1);
  });
});

describe('parsePlan', () => {
  it('違反があれば例外を投げる', () => {
    expect(() => parsePlan(plan([item({ id: 'T001', verify: [] })]))).toThrow(/確かめ方/);
  });
});

describe('countProgress', () => {
  it('当初計画と追加分を分けて数える', () => {
    const progress = countProgress(
      plan([
        item({ id: 'T001', status: 'done' }),
        item({ id: 'T002', status: 'todo' }),
        item({ id: 'T003', status: 'done', origin: 'added' }),
      ]),
    );
    expect(progress.initial).toEqual({ done: 1, total: 2 });
    expect(progress.added).toEqual({ done: 1, total: 1 });
  });

  it('人間の確認待ちを完了に数えない', () => {
    const progress = countProgress(
      plan([item({ id: 'T001', status: 'awaiting_human', automation: 'human' })]),
    );
    expect(progress.initial).toEqual({ done: 0, total: 1 });
    expect(progress.awaitingHuman).toEqual(['T001']);
  });
});

describe('nextItem', () => {
  it('依存先が完了していない項目は選ばない', () => {
    const chosen = nextItem(
      plan([item({ id: 'T001', status: 'todo' }), item({ id: 'T002', dependsOn: ['T001'] })]),
    );
    expect(chosen?.id).toBe('T001');
  });

  it('依存先が完了していれば選ぶ', () => {
    const chosen = nextItem(
      plan([item({ id: 'T001', status: 'done' }), item({ id: 'T002', dependsOn: ['T001'] })]),
    );
    expect(chosen?.id).toBe('T002');
  });

  it('確認待ちの項目は選び直さない', () => {
    expect(nextItem(plan([item({ id: 'T001', status: 'awaiting_human' })]))).toBeUndefined();
  });
});

describe('canRunInParallel', () => {
  it('依存も重複ファイルもなければ並列にできる', () => {
    expect(
      canRunInParallel(
        item({ id: 'T001', files: ['a.html'] }),
        item({ id: 'T002', files: ['b.html'] }),
      ),
    ).toBe(true);
  });

  it('触るファイルが重なれば並列にできない', () => {
    expect(
      canRunInParallel(
        item({ id: 'T001', files: ['a.html', 'style.css'] }),
        item({ id: 'T002', files: ['style.css'] }),
      ),
    ).toBe(false);
  });

  it('依存関係があれば並列にできない', () => {
    expect(
      canRunInParallel(
        item({ id: 'T001', files: ['a.html'] }),
        item({ id: 'T002', files: ['b.html'], dependsOn: ['T001'] }),
      ),
    ).toBe(false);
  });
});

describe('nextId', () => {
  it('既存の最大値の次を返す（欠番は埋めない）', () => {
    expect(nextId(plan([item({ id: 'T001' }), item({ id: 'T008' })]))).toBe('T009');
  });
});

// T009: 「テストが通る」のように、何を実行し何が起きれば合格かを示さない書き方を拒む。
describe('validateVerifySteps', () => {
  it('対象も期待結果も示さない書き方を拒む', () => {
    expect(validateVerifySteps(['テストが通る']).length).toBeGreaterThan(0);
  });

  it('対象コマンドと期待結果を示す書き方は通す', () => {
    expect(
      validateVerifySteps(['pnpm run testを実行し、新しいテストが通ることを確認する']),
    ).toEqual([]);
  });

  it('下ごしらえの手順に期待結果が無くても、項目のどこかにあれば通す', () => {
    expect(
      validateVerifySteps([
        'index.html をブラウザで開く',
        '画面幅をスマホ相当（375px）まで狭める',
        '文字が画面からはみ出していないことを確認する',
      ]),
    ).toEqual([]);
  });

  it('期待結果がどの手順にも無ければ拒む', () => {
    const errors = validateVerifySteps(['index.html をブラウザで開く', '画面幅を狭めてみる']);
    expect(errors.some((e) => e.includes('できた'))).toBe(true);
  });

  it('一言だけの手順を拒む', () => {
    const errors = validateVerifySteps(['開く', '表示されることを確認する']);
    expect(errors.some((e) => e.includes('短すぎます'))).toBe(true);
  });

  it('人が見て判断する項目（説明してもらう）も期待結果として認める', () => {
    expect(validateVerifySteps(['実際に画面を見せ、進み具合を説明してもらう'])).toEqual([]);
  });
});

describe('validatePlan と確かめ方の書き方', () => {
  it('曖昧な確かめ方の項目を含む計画はエラーになる', () => {
    const errors = validatePlan(plan([item({ id: 'T001', verify: ['テストが通る'] })]));
    expect(errors.some((e) => e.includes('items[0]'))).toBe(true);
  });
});
