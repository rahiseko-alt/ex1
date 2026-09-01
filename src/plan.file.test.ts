import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { countProgress, nextItem, parsePlan, validatePlan } from './plan.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const examplePath = join(repoRoot, 'docs', 'plan.example.json');
const planPath = join(repoRoot, 'docs', 'plan.json');

function read(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('docs/plan.example.json', () => {
  it('見本そのものが検証を通る', () => {
    expect(validatePlan(read(examplePath))).toEqual([]);
  });

  it('人間が確認するしかない項目を含んでいる（2段階の書き分けの見本になっている）', () => {
    const plan = parsePlan(read(examplePath));
    expect(plan.items.some((item) => item.automation === 'human')).toBe(true);
    expect(plan.items.some((item) => item.automation === 'ci')).toBe(true);
  });

  it('依存先が未完了の項目は次の一手に選ばれない', () => {
    const plan = parsePlan(read(examplePath));
    const next = nextItem(plan);
    expect(next?.id).toBe('T003');
  });

  it('当初計画と追加分を分けて数えられる', () => {
    const progress = countProgress(parsePlan(read(examplePath)));
    expect(progress.initial.total).toBeGreaterThan(0);
    expect(progress.added.total).toBeGreaterThan(0);
  });
});

// 実際の計画ファイルは、このリポジトリを雛形として使い始めてから /plan-init で作られる。
// 存在するときだけ検証する。これが「番号は不変・追記のみ」を CI で守らせる本体。
describe.skipIf(!existsSync(planPath))('docs/plan.json', () => {
  it('計画ファイルが検証を通る', () => {
    expect(validatePlan(read(planPath))).toEqual([]);
  });
});
