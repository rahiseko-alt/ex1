import { describe, expect, it } from 'vitest';

import { countProgress } from '../plan.js';
import { testItem, testPlan } from './fixture.js';
import { formatProgress } from './progress.js';

function render(...items: Parameters<typeof testPlan>[0]): string {
  const plan = testPlan(items);
  return formatProgress(countProgress(plan), plan);
}

describe('formatProgress', () => {
  it('完了数・全体数・残り数を日本語の文章で出す', () => {
    const text = render(
      testItem({ id: 'T001', status: 'done' }),
      testItem({ id: 'T002' }),
      testItem({ id: 'T003' }),
    );
    expect(text).toContain('全3件のうち1件が終わりました。残り2件です。');
  });

  it('人に見てもらう順番待ちを見出しつきで並べる', () => {
    const text = render(
      testItem({
        id: 'T001',
        status: 'awaiting_human',
        automation: 'human',
        title: '画面を見せる',
      }),
      testItem({ id: 'T002' }),
    );
    expect(text).toContain('人に見てもらう順番待ち: 1件あります。');
    expect(text).toContain('画面を見せる');
    expect(text).toContain('T001');
  });

  it('順番待ちが無いときはその旨を出す', () => {
    expect(render(testItem({ id: 'T001' }))).toContain('人に見てもらう順番待ち: ありません。');
  });

  it('あとから足した分は、実際に追記があるときだけ出す', () => {
    expect(render(testItem({ id: 'T001' }))).not.toContain('あとから足した分');
    expect(render(testItem({ id: 'T001' }), testItem({ id: 'T002', origin: 'added' }))).toContain(
      'あとから足した分',
    );
  });

  // T013: 読み手は非エンジニア。計画ファイルの中で使っている英語の項目名を出さない。
  it('計画ファイルの内部の項目名をそのまま出さない', () => {
    const text = render(
      testItem({ id: 'T001', status: 'done' }),
      testItem({ id: 'T002', status: 'awaiting_human', automation: 'human' }),
      testItem({ id: 'T003', origin: 'added' }),
    );
    for (const field of [
      'status',
      'dependsOn',
      'automation',
      'deliverable',
      'verify',
      'origin',
      'awaitingHuman',
      'awaiting_human',
      'initial',
      'added',
      'total',
      'done',
    ]) {
      expect(text).not.toContain(field);
    }
  });
});
