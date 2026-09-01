# 引継ぎ

セッションをまたいで作業を継続するための文書です。役割は**「次にどの branch を見ればいいか」の
ポインタ**に限ります。branch 固有の詳細（何が途中か、次に何をするか）はその branch 自身の
コミットや開いてある PR の本文に書き、ここには短いポインタだけを置いてください。恒久的な
リポジトリのルールもここには書きません（`AGENTS.md`・`docs/decisions.md` を参照）。

同時に複数 branch が進行中の場合は、「次にやること」に branch ごと1エントリで列挙してください。
この雛形は複数 branch の並行開発を想定した状態管理は持っていません。本格的に必要になったら
`docs/decisions.md`「3-b. セッション間の引継ぎ」を読んでから設計し直してください。

- `AGENTS.md` がこのファイルを `@` で import しているため、セッション開始時に自動で読み込まれます
- 未記録の変更が残っていると、`.claude/hooks/handoff-check.sh` が1セッションに1回だけ更新を求めます
- セッション終了時、`.claude/hooks/handoff-stamp.sh` が末尾の状態を機械的に**上書き**します（追記ではない）
- 作業開始時は `/checkin`、区切りでは `/handoff`、終了時は `/checkout` を実行してください

**このファイル（引継ぎ文）を更新したら、必ず `main` へマージしてください。** 次のセッションは
`main` を新規クローンし、この docs/handoff.md しか自動では読みません。実際のコード変更は、
未完了なら push 済みの branch/worktree に残したままで構いません（push していれば origin に
残るため消えません）。

---

## いま何をしているか

**顧客管理システム（ひとりで使う CRM）を作っている。全体計画 `docs/plan.json` は30項目。
`T001` が完了し、残り29項目。**

雛形づくりの計画（28項目・完了済み）は `docs/plan.template-setup.json` に退避してある。
参照専用で、進み具合の数字には入らない。

`pnpm run plan:progress` を実行すれば、いつでも今の数字が出る。

## 完了したこと

- **`docs/plan.json` を顧客管理システムの30項目で作成**（PR #1、`main` にマージ済み）。
  ゴールは「顧客の台帳・やり取りの履歴・案件の進み具合を自分のブラウザから登録・検索・更新でき、
  ログインした自分だけが見られる形でネット上に置かれ、いつでも書き出して手元に持ち出せる状態」
  - 台帳 `T001`〜`T010` ／ やり取りの履歴 `T011`〜`T014` ／ 案件 `T015`〜`T020` ／
    使い勝手 `T021`〜`T023` ／ 守り `T024`〜`T026` ／ 公開と実運用 `T027`〜`T030`
  - `automation` が `human` は7件（`T021` `T022` `T023` `T027` `T028` `T029` `T030`）
- **`T001`（自分のパソコンで画面が1枚開く）を実装**（PR #4、branch `claude/checkin-d19vz8`）。
  `pnpm run dev` で http://localhost:8787 に「顧客管理」の見出しが出る
  - `wrangler.toml` ／ `src/app/server.ts` ／ `src/app/server.test.ts` を追加
  - `completion-checker` が実ブラウザ（Playwright の chromium）で3手順をなぞり「通った」
- **スタックを決めて `docs/decisions.md`「4-b.」に記録**
  — Cloudflare Workers ＋ Hono ＋ サーバー側で HTML を組み立てる
- 古い計画を `docs/plan.template-setup.json` へ退避、`AGENTS.md` の「目的」を書き換え
- 公開時に認証が無い期間ができる点を `docs/neglected-log.md` に記録（PR #2）
- `pnpm run check` / `pnpm run build` 通過（47テスト）

## 次にやること

**`pnpm run plan:next` が出す1件に着手する。いまは `T002`（顧客データの置き場をつくる）。**

`T002` の `verify` は `pnpm run db:setup` と `pnpm run db:show` を前提に書いてある。
**この2つのスクリプトはまだ存在しない。`T002` の中で作ること。**
中身は `wrangler d1` のコマンドになる見込み `[曖昧]`（D1 をまだ一度も触っていない）。

### 以前からの積み残し

- **`[曖昧]` Cloudflare の無料枠の実際の上限は未確認。`T027`（公開）までに必ず確認する**
- GitHub Ruleset の実態は `[曖昧]`。ユーザーが Settings → Rules → Rulesets で確認してほしい
- 週次 Routine は無効化済み（`trig_01LVCzPzXcTxdyGFdxtFQZSw`）

## 注意点

**恒久的なリポジトリのルールはここに書かない。** `AGENTS.md`（指示）と `docs/decisions.md`
（根拠）を参照する。ここに書くのは、セッションをまたいで再発しうる作業上の落とし穴だけ。

- **本物の顧客データを入れるのは `T028`（自分以外は開けないようにする）を終えてから。**
  ネット上に置いた画面はアドレスを知られただけで誰でも開ける。顧客の名前・電話番号が
  入るため、`T030`（実データ）は `T028` の後ろに置いてある。**この順番を入れ替えないこと**
- **`pkill -f wrangler` を使わないこと。** 自分のシェルのコマンド文字列にも `wrangler` が
  含まれるため、シェルごと巻き込んで死ぬ（exit 144）。`pgrep -af wrangler` で PID を
  調べ、その PID を `kill` する
- **`curl` はこの環境で拒否される。** HTTP の確認は `node -e` の `fetch` を使う
- **実ブラウザの実行ファイルは `/opt/pw-browsers/chromium`**（`chromium/chrome-linux/chrome`
  ではない。symlink が実行ファイルを直接指している）。`playwright-core` はリポジトリには
  入れず、scratchpad 側に入れて使った
- **`pnpm add` しただけでは `wrangler dev` は動かない。** pnpm 10 は既定でインストール時の
  ビルドを実行しないため、`package.json` の `pnpm.onlyBuiltDependencies` に `esbuild` と
  `workerd` を書く必要がある
- **作業ブランチの remote に、マージ済みの古い履歴が残っていることがある。**
  そのまま push すると `behind` で弾かれる。強制 push は禁止なので、
  `git diff --stat origin/main origin/<branch>` で差分ゼロを確かめてから merge して取り込む。
  そのとき `docs/handoff.md` の自動記録の行が必ず衝突する（新しい方を残せばよい）
- **`verify` の手順は1つあたり8文字以上必要。** 「一覧を開く」は短すぎて検証に弾かれた
  （`src/plan.ts` の `validateVerifySteps`）。「顧客の一覧の画面を開く」のように書く
- **`docs/plan.json` は一度確定したら本文を書き換えない。** できるのは `status` の変更と
  末尾への追記だけ。追記の番号は `pnpm run plan:next-id` で決める
- **リポジトリのコミット履歴が `f95fa9a Initial commit` にまとめ直されている。**
  2026-09-01 より前の引継ぎ文に出てくる PR 番号やコミット SHA はもう辿れない
- **`done` が「要件の取り下げ」を意味することがある**（前の計画で3件あった）。
  `status` に `dropped` が無いための妥協。この計画でも同じ問題が起こりうる
- **`automation` を決めるときは「そのコマンドを誰が入力するか」まで下りて確かめる。**
  「Claude Code の機能だから機械側」は成り立たない
- **判定役に渡す記録には必ず対象の id を書く。** id の無い記録は裏が取れないと差し戻された
- **ドキュメントに具体例を載せるときは、その例を実際に実行・検証してから載せる**
- **`node -e` の中でトップレベル `return` は書けない**（`SyntaxError: Illegal return
statement`）。フックの中で `node -e` を使うときは関数で包むこと
- **PR をスカッシュでマージするとリモートのブランチが自動削除される。** そのまま
  `--force-with-lease` すると `stale info` で失敗する。`git fetch --prune` してから通常の push
- **`git push` がプロキシの 503 で失敗することがある。** 指数バックオフで数回リトライする
- **この引継ぎ文の本文に、自動記録の目印（`session-end-stamp` の HTML コメント）を
  そのまま書かないこと。** 書くと自動記録がそこで本文を切り落とす

<!-- session-end-stamp -->

## セッション終了時点の状態（自動記録）

- 記録時刻: 2026-09-01 12:06 UTC
- ブランチ: `claude/checkin-d19vz8`
- HEAD: `2768366`
- 未コミットの変更: なし
