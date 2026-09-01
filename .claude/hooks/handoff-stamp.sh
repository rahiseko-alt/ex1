#!/usr/bin/env bash
# SessionEnd: 機械的に確認できる事実だけを docs/handoff.md の末尾に記録する。
#
# SessionEnd はモデルを呼べず、共有予算も既定 1.5 秒しかない（settings.json 側で
# timeout を延ばしている）。そのため文章は書けない。ブランチ・HEAD・変更ファイルなど、
# シェルだけで取れる事実を残す。文章側は Stop フックと /handoff スキルが担当する。
# https://code.claude.com/docs/en/hooks

set -uo pipefail

event=$(cat)

# worktree に入っていても ${CLAUDE_PROJECT_DIR} はメインのチェックアウトを指したままなので、
# 標準入力 JSON の cwd（Claude が実際に作業しているディレクトリ）を優先する。
cwd=$(
  printf '%s' "$event" | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d));
    process.stdin.on("end", () => {
      try {
        process.stdout.write(JSON.parse(s)?.cwd ?? "");
      } catch {
        process.stdout.write("");
      }
    });
  '
) || exit 0

cd "${cwd:-${CLAUDE_PROJECT_DIR:-.}}" || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
[ -f docs/handoff.md ] || exit 0

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")
head=$(git rev-parse --short HEAD 2>/dev/null || echo "?")
changed=$(git status --porcelain 2>/dev/null | head -20)
stamp=$(date -u '+%Y-%m-%d %H:%M UTC')

BRANCH="$branch" HEAD_SHA="$head" CHANGED="$changed" STAMP="$stamp" node -e '
  const fs = require("fs");
  const path = "docs/handoff.md";
  const MARK = "<!-- session-end-stamp -->";

  let text;
  try {
    text = fs.readFileSync(path, "utf8");
  } catch {
    process.exit(0);
  }

  const changed = (process.env.CHANGED || "").trim();
  const block =
    MARK +
    "\n\n## セッション終了時点の状態（自動記録）\n\n" +
    "- 記録時刻: " + process.env.STAMP + "\n" +
    "- ブランチ: `" + process.env.BRANCH + "`\n" +
    "- HEAD: `" + process.env.HEAD_SHA + "`\n" +
    // 行末に空白を残すと Prettier の format:check が落ち、CI が赤くなる。
    // ラベル側には空白を付けず、"なし" の側だけ区切りの空白を持たせる。
    "- 未コミットの変更:" +
    (changed ? "\n\n```\n" + changed + "\n```\n" : " なし\n");

  // 最初ではなく最後の目印で切る。引継ぎ本文がこの目印の文字列そのものに言及すると、
  // indexOf では本文の途中で切ってしまい、締めるたびに末尾が壊れて重複が積もる（実際に起きた）。
  const i = text.lastIndexOf(MARK);
  const next = (i === -1 ? text.trimEnd() + "\n\n" : text.slice(0, i)) + block;

  try {
    fs.writeFileSync(path, next);
  } catch {
    /* 書けなくてもセッション終了は妨げない */
  }
' 2>/dev/null

exit 0
