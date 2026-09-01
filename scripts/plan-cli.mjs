#!/usr/bin/env node
// pnpm run plan:* の入口。dist が古いときだけビルドし直す。
//
// 以前は4つのコマンドが毎回 tsc を走らせており、読むだけの操作に1.6秒かかっていた
// （docs/neglected-log.md の 081）。/checkin は起動のたびに複数回叩くため、この差が積もる。
//
// 判定は「src の .ts と tsconfig.build.json のうち一番新しい更新時刻」対
// 「呼び出す dist のファイルの更新時刻」。ハッシュではなく更新時刻で足りる——
// 目的はビルドの省略であって、ビルドの正しさは tsc 側の責任。

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function newestTypeScriptMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestTypeScriptMtime(full));
    } else if (entry.name.endsWith('.ts')) {
      newest = Math.max(newest, statSync(full).mtimeMs);
    }
  }
  return newest;
}

const [name, ...args] = process.argv.slice(2);
if (name === undefined) {
  console.error(
    '使い方: node scripts/plan-cli.mjs <progress|next-item|next-id|parallel> [計画ファイル]',
  );
  process.exit(2);
}

const target = join(repoRoot, 'dist', 'plan-cli', `${name}.js`);
const sourceMtime = Math.max(
  newestTypeScriptMtime(join(repoRoot, 'src')),
  statSync(join(repoRoot, 'tsconfig.build.json')).mtimeMs,
);
const builtMtime = existsSync(target) ? statSync(target).mtimeMs : 0;

if (builtMtime < sourceMtime) {
  const build = spawnSync('pnpm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const run = spawnSync(process.execPath, [target, ...args], { cwd: repoRoot, stdio: 'inherit' });
process.exit(run.status ?? 1);
