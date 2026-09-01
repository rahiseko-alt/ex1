#!/usr/bin/env bash
# Edit / Write の直後に、変更されたファイルを Prettier で整形する。
#
# AGENTS.md の「整形は Prettier に一任する」は助言にすぎず、守られない可能性がある。
# フックは決定論的に実行されるため、この整形は必ず適用される。
# 公式ドキュメント: https://code.claude.com/docs/en/hooks
#
# 標準入力でフックのイベント JSON を受け取る。jq に依存しないよう node で解析する
# （この雛形は Node プロジェクトなので node は必ず存在する）。

set -uo pipefail

event=$(cat)

file_path=$(
  printf '%s' "$event" | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d));
    process.stdin.on("end", () => {
      try {
        const input = JSON.parse(s);
        process.stdout.write(input?.tool_input?.file_path ?? "");
      } catch {
        process.stdout.write("");
      }
    });
  '
) || exit 0

[ -n "$file_path" ] || exit 0
[ -f "$file_path" ] || exit 0

# Prettier が扱える拡張子だけを対象にする
case "$file_path" in
*.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs | *.json | *.md | *.yml | *.yaml | *.css | *.html) ;;
*) exit 0 ;;
esac

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

# 整形に失敗しても編集自体は成立しているので、フックは成功扱いで終える
pnpm exec prettier --write "$file_path" >/dev/null 2>&1 || true

exit 0
