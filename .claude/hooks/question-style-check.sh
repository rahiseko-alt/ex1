#!/usr/bin/env bash
# Stop: 非エンジニアが答えられない聞き方をしたまま終わるのを止める関門。
# 設計と判定基準は docs/decisions.md「19.」。
#
# PreToolUse で AskUserQuestion を捕まえる案もあるが、それでは
# 「ツールを使わず素の文章で聞く」場合を素通りさせる。弾きたいのはまさにそれ。
#
# 見るのは最後のアシスタント発言だけ。過去まで見ると、既に答えた質問で毎回鳴る。
# 会話の意味は判定しない。誤検出は許容する（差し戻しは1セッションに1回だけ）。

set -uo pipefail

event=$(cat)

json_field() {
  printf '%s' "$event" | node -e '
    const field = process.argv[1];
    let s = "";
    process.stdin.on("data", (d) => (s += d));
    process.stdin.on("end", () => {
      try {
        process.stdout.write(String(JSON.parse(s)?.[field] ?? ""));
      } catch {
        process.stdout.write("");
      }
    });
  ' "$1" 2>/dev/null
}

cwd=$(json_field cwd) || exit 0
cd "${cwd:-${CLAUDE_PROJECT_DIR:-.}}" || exit 0

transcript=$(json_field transcript_path) || exit 0
[ -n "$transcript" ] && [ -f "$transcript" ] || exit 0

# 最後のアシスタント発言の本文と、そこで使われたツール名を取り出す。
verdict=$(
  node -e '
    const { readFileSync } = require("node:fs");

    // 用語リストの正本はここ。実際に非エンジニアが詰まった語を足していく。
    // AGENTS.md には書かない（二重管理になるため）。
    const JARGON = [
      "lockfile", "rebase", "worktree", "merge", "commit", "branch",
      "フック", "hook", "バリデーション", "リファクタ", "デプロイ",
      "マイグレーション", "スキーマ", "キャッシュ", "リポジトリ",
    ];
    // 用語を説明していると見なす書き方。
    const EXPLAINED = ["＝", "という", "つまり", "（", "とは"];

    function judge(path) {
      let lines;
      try {
        lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim() !== "");
      } catch {
        return "skip";
      }

      // 最後のアシスタント発言だけを見る。過去まで見ると、既に答えた質問で毎回鳴る。
      let text = "";
      let usedAsk = false;
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        let entry;
        try {
          entry = JSON.parse(lines[i]);
        } catch {
          continue;
        }
        if (entry?.type !== "assistant") continue;
        const content = entry?.message?.content;
        if (!Array.isArray(content)) continue;
        for (const part of content) {
          if (part?.type === "text" && typeof part.text === "string") text += part.text;
          if (part?.type === "tool_use" && part?.name === "AskUserQuestion") usedAsk = true;
        }
        break;
      }

      if (text.trim() === "") return "skip";

      const asksSomething = /[？?]\s*$/m.test(text) || /(ますか|しますか|ください)/.test(text);
      if (!asksSomething) return "ok";

      // 選択肢が示されているか（AskUserQuestion か、行頭の番号・箇条書き）
      const hasChoices = usedAsk || /^\s*(?:[0-9]+[.)]|[-*・]|[AaBb][.)])\s+\S/m.test(text);
      const unexplained = JARGON.filter(
        (word) => text.includes(word) && !EXPLAINED.some((mark) => text.includes(mark)),
      );

      const problems = [];
      if (!hasChoices) problems.push("choices");
      if (unexplained.length > 0) problems.push("jargon:" + unexplained.join(","));
      return problems.length === 0 ? "ok" : problems.join(" ");
    }

    process.stdout.write(judge(process.argv[1]));
  ' "$transcript" 2>/dev/null
) || exit 0

case "$verdict" in
  ok | skip | '') exit 0 ;;
esac

session_id=$(json_field session_id | tr -cd 'A-Za-z0-9_-') || exit 0
[ -n "$session_id" ] || exit 0

marker=".claude/.handoff-state/question-${session_id}"
[ -e "$marker" ] && exit 0
mkdir -p .claude/.handoff-state || exit 0
: >"$marker" || exit 0

{
  echo "その聞き方では、非エンジニアが答えられません（検出: ${verdict}）。"
  echo
  case "$verdict" in
    *choices*)
      echo "・選択肢がありません。AskUserQuestion ツールで、選べる形にしてください。"
      ;;
  esac
  case "$verdict" in
    *jargon*)
      echo "・説明のない専門用語があります。何が起きているかを普通の言葉で書いてください。"
      ;;
  esac
  echo
  echo "順番は「何が起きているか → どれを勧めるか → 選ぶとどうなるか → 選択肢」です。"
  echo "この差し戻しは1セッションに1回だけです。"
} >&2

exit 2
