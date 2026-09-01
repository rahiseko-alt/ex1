# from-0

Claude Code と Codex で同じリポジトリを扱うための、**公式準拠のリポジトリ雛形**です。

新しいプロジェクトを始めるたびに `AGENTS.md` と `CLAUDE.md` の関係や `.gitignore` の切り分けを
考え直さなくて済むように、判断済みの構成を1セットにまとめてあります。

## この雛形の中身

### 指示ファイル

| ファイル                     | 役割                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------- |
| `AGENTS.md`                  | 全エージェント共通の指示。**唯一の正本**                                         |
| `CLAUDE.md`                  | `@AGENTS.md` の import 1行のみ。ポインタに徹する                                 |
| `.claude/settings.json`      | Claude Code のチーム共有設定（権限・フック）                                     |
| `.claude/hooks/`             | フックのスクリプト。自動整形・型検査・引継ぎ                                     |
| `.claude/skills/`            | スキル。`/checkin` `/checkout` `/handoff`                                        |
| `.claude/agents/`            | サブエージェント。`failure-reviewer`（失敗台帳の整理専用）                       |
| `.mcp.json`                  | MCP サーバの定義（初期状態は空）                                                 |
| `.worktreeinclude`           | worktree 作成時にコピーする gitignore 済みファイル                               |
| `.gitignore`                 | Node/TS・秘密情報・OS に加え、エージェントのローカルファイル                     |
| `.gitattributes`             | 台帳ファイルの union merge 設定                                                  |
| `docs/decisions.md`          | 各項目の根拠。公式由来か選択の結果かを区別した記録                               |
| `docs/handoff.md`            | セッション間の引継ぎ。`AGENTS.md` が import している                             |
| `docs/test-policy.md`        | テストで見つけた問題を重大度順に処理するためのゲート手順                         |
| `docs/failure-action-log.md` | 失敗行動台帳。行動（結果ではない）を書きっぱなしでよく、条件を満たすまで読まない |
| `docs/neglected-log.md`      | 放置台帳。大計画のゴール到達時だけ読む                                           |

### 開発基盤

Node 22 / TypeScript 5 strict / pnpm / ESM。テストは Vitest、整形は Prettier と EditorConfig。
GitHub Actions で整形検査・型チェック・テスト・ビルドを自動実行します。

## なぜこの構成なのか

**Claude Code は `AGENTS.md` を直接読みません。**
[公式ドキュメント](https://code.claude.com/docs/en/memory)に "Claude Code reads `CLAUDE.md`,
not `AGENTS.md`" と明記されています。そこで公式が示す import 方式を採用し、`CLAUDE.md` の先頭に
`@AGENTS.md` の1行を置いて同じ実体を読ませています。Codex は `AGENTS.md` を直接読むため、
実体は1ファイルのまま両対応できます。

> **落とし穴**: `CLAUDE.md` に「AGENTS.md に従うこと」と**文章で書いても機能しません**。
> `@` から始まるパス記法だけが読み込みを発生させます。

**指示ファイルに書く範囲は、公式の判定基準に沿って決めています。**
[best-practices](https://code.claude.com/docs/en/best-practices) は「各行について、これを削ると
Claude が間違えるか？ 間違えないなら削れ」という基準と、Include / Exclude の対照表を示しています。
Include 側はコマンド・既定と違うコード規約・テスト方法・ブランチ命名等のリポジトリ作法・非自明な
落とし穴。Exclude 側はコードを読めば分かること・設計の長い説明・ファイル単位の説明・自明な作法です。
`AGENTS.md` はこの基準で絞り込んであり、ディレクトリ構成や設計理由といった読み物は置いていません
（この README や `docs/decisions.md` が読み物側です）。目安は200行以下です。

ただし**同じ値を2箇所に持つことはしません**。たとえばインデント幅やクォートの種類は
`.prettierrc.json` と `.editorconfig` が正本で、`AGENTS.md` には「Prettier に一任する。正本はそちら」
とだけ書きます。値を二重に持つと、食い違ったときにどちらが正しいか判断できなくなるためです。

**スタックは宣言ではなく強制で守ります。**
`engines.node` を書くだけでは検査されないため、`.npmrc` の `engine-strict=true` と
`.node-version` を併用し、条件を満たさない環境では `pnpm install` が失敗するようにしています。

## 決定論的に強制しているもの

公式ドキュメントは「指示は助言、フックは決定論的」と区別しています。

> Unlike CLAUDE.md instructions which are advisory, hooks are deterministic and guarantee the action happens.

そのため、守られないと困るものは指示ではなく仕組み側に置いています。

| 守りたいこと                   | 仕組み                                                          |
| ------------------------------ | --------------------------------------------------------------- |
| Node のバージョン              | `.npmrc` の `engine-strict` で install が失敗する               |
| 整形が適用されること           | PostToolUse フックが編集直後に Prettier を実行                  |
| 型が壊れていないこと           | PostToolUse フックが編集後に `tsc` を非同期実行し、失敗だけ返す |
| 依存が入っていること           | SessionStart フックが `pnpm install` を実行                     |
| 引継ぎが読まれること           | `AGENTS.md` の `@docs/handoff.md` import。trust に依存しない    |
| 引継ぎが書かれること           | Stop フックが1セッションに1回、未記録の変更があれば更新を求める |
| 秘密情報を読ませない           | `.claude/settings.json` の `permissions.deny`                   |
| 生成物とロックファイルの手編集 | 同上（`dist/` と `pnpm-lock.yaml` を deny）                     |
| CI 通過とレビュー経由の変更    | GitHub の Ruleset（`main` 直 push 禁止・CI 必須）               |

`AGENTS.md` の「`strict` 前提・`any` を使わない」は指示にすぎません。型検査をフックにすることで、
違反は必ず次のターンで Claude に差し戻されます。

> **`allow` ルールは workspace trust を承認するまで効きません。** 各自が**このフォルダ自体**を信頼
> するまで（親フォルダの信頼では足りない）、`.claude/settings.json` の `permissions.allow` は適用
> されず、毎回確認を求められます。`claude -p` や SDK では信頼ダイアログ自体が出ないため `allow` は
> 適用されず、stderr に `this workspace has not been trusted` が出ます。
> **`deny` と `ask` は信頼の有無に関係なく最初から効く**ので、安全性は信頼の状態に依存しません。
> 参考: [What runs before you trust a folder](https://code.claude.com/docs/en/permissions#what-runs-before-you-trust-a-folder)

## 拡張ポイント

Claude Code には他にも拡張機構があります。スキルは `/checkin` `/checkout` `/handoff` の3つが入っていて、残りは**意図的に空**です。必要になった時点で追加してください。

| 機構                                                                               | 置き場所                 | 用途                                           |
| ---------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------- |
| [スキル](https://code.claude.com/docs/en/skills)                                   | `.claude/skills/`        | 手順やドメイン知識。必要なときだけ読み込まれる |
| [サブエージェント](https://code.claude.com/docs/en/sub-agents)                     | `.claude/agents/`        | 別コンテキストで動く専門エージェント           |
| [ルール](https://code.claude.com/docs/en/memory#organize-rules-with-claude/rules/) | `.claude/rules/`         | パス単位で読み込む指示（`paths:` frontmatter） |
| [MCP](https://code.claude.com/docs/en/mcp)                                         | `.mcp.json`              | 外部ツールとの接続                             |
| [プラグイン](https://code.claude.com/docs/en/discover-plugins)                     | 各自の `/plugin install` | LSP・MCP・スキルをまとめて導入                 |

> **注意**: `.claude/` 配下の指示は **Claude Code しか読みません**。Codex からは見えないため、
> 両ツールで守らせたい内容は必ず `AGENTS.md` に書いてください。ここに書いてよいのは、
> Claude Code 固有の手順や、指示ではない仕組み（フック・権限）です。

> **`.claude/commands/` は作らないでください。** 公式が「Custom commands have been merged into
> skills」と明記しています。同名なら skills が優先され、commands 側は `name` と `paths` の
> フロントマターを無視し、bare mode では読み込まれません。`/名前` で呼びたい場合も
> `.claude/skills/<名前>/SKILL.md` を作れば同じことができます。

公式は「CLAUDE.md の一節が事実ではなく手順に育ったら、スキルに移す」ことを勧めています。
`AGENTS.md` が 200 行に近づいてきたら、手順をスキルへ切り出す合図です。

### 導入を検討する価値があるもの

雛形の既定には入れていませんが、公式が勧めていて効果が明確なものです。いずれも**前提が増える**ため、
利用者が判断できるよう前提を明記します。

**TypeScript の code intelligence（`typescript-lsp`）**

公式が TypeScript に名指しで勧めているプラグインです。編集直後に言語サーバが型エラーや未解決 import を
返すため、Claude が同じターンで気づいて直せます。各自のマシンに `typescript-language-server`
バイナリが必要で、**プラグインは入れてくれません**。バイナリを入れたうえで
`/plugin install typescript-lsp@claude-plugins-official` を実行してください。
バイナリ前提のため `.claude/settings.json` の既定には入れていません（未インストールのまま配ると
全員に「not installed」エラーが出ます）。

**セキュリティレビュー（`security-guidance`）**

Claude が書いたコードを3層（編集ごとのパターン照合・ターン終了時の差分レビュー・commit/push 時の
エージェント的レビュー）で点検します。リポジトリを clone した全員とクラウドセッションに効かせる
公式の方法は `.claude/settings.json` への宣言です。

```json
{ "enabledPlugins": { "security-guidance@claude-plugins-official": true } }
```

既定に入れていない理由は2つです。**Node 専用のこの雛形に Python 3.10 以上と pip とネットワークの
前提が増える**こと（初回に `~/.claude/security/` へ venv を作る）、そして**モデル利用コストが増える**
こと（ターン終了時と commit 時のレビューは既定で Claude Opus 4.7 を呼びます）。編集ごとの
パターン照合だけはモデルを呼ばず無料なので、`ENABLE_CODE_SECURITY_REVIEW=0` でその層だけ残せます。
全プランで利用可能です。

**Bash のサンドボックス**

`permissions.deny` は Claude の組み込みファイルツールと、Claude Code が認識する `cat` などの
Bash コマンドには効きますが、**スクリプト経由の間接アクセスには効きません**（`node -e` で `.env` を
読むなど）。OS レベルで止めるにはサンドボックスが要ります。

```json
{
  "sandbox": {
    "enabled": true,
    "network": { "allowedDomains": ["registry.npmjs.org"] },
    "filesystem": { "allowWrite": ["~/.local/share/pnpm"] }
  }
}
```

既定に入れていない理由は、**ネイティブ Windows で動かない**こと（macOS / Linux / WSL2 のみ）と、
`allowWrite` に指定すべき pnpm ストアのパスが環境依存であること（`pnpm store path` で確認）です。
壊れた既定を全リポジトリに配らないため、選択制にしています。

## この雛形の使い方

GitHub の **Use this template** から新しいリポジトリを作り、以下を書き換えてください。

- [ ] `package.json` の `name` と `description`
- [ ] `README.md`（このファイル）をプロジェクトの説明に差し替え
- [ ] `AGENTS.md` の `**目的**` の行
- [ ] `AGENTS.md` の「落とし穴」に、そのプロジェクト固有の注意点を追加
- [ ] `.claude/settings.json` の権限とフックを、使うコマンドに合わせて調整
- [ ] `src/index.ts` と `src/index.test.ts` を実際のコードとテストに置き換え
- [ ] GitHub 側の設定（Ruleset で `main` 保護と CI 必須、Allow auto-merge、head ブランチ自動削除）
- [ ] 各自が一度 `claude` を対話モードで起動し、**workspace trust を承認する**
      （承認するまで `permissions.allow` は効かず、毎回確認を求められます）
- [ ] アプリの起動手順が決まったら `/run-skill-generator` を1回実行し、生成された
      `.claude/skills/run-<名前>/` をコミットする（`/run` と `/verify` が起動方法を再発見せずに済む）

スタックを変える場合（Next.js を入れる等）は `package.json` / `tsconfig.json` /
`.github/workflows/ci.yml` を差し替えてください。指示ファイルの構成はそのまま使えます。

モノレポ化する場合は [Monorepos and large repos](https://code.claude.com/docs/en/large-codebases)
を参照してください。`.claude/settings.json` は**親ディレクトリから継承されません**。worktree の中では
リポジトリルートの `.claude/settings.json` が読まれるので、権限とフックはルート側にも置きます。
`AGENTS.md` を正本にする構成は維持できますが、パッケージ固有の規約は `packages/*/CLAUDE.md` か
`.claude/rules/` の `paths:` に分けることになります。

### Claude Code on the web で使う

**リポジトリ側の準備は不要です。** クラウドセッションは fresh clone から始まりますが、
`CLAUDE.md` / `.claude/settings.json` / `.mcp.json` はコミット済みなのでそのまま届き、
SessionStart フックが `pnpm install` を実行します。Node 22 と pnpm はクラウド VM に
プリインストールされているため、**setup script も不要**です。

claude.ai/code で GitHub を接続し、環境を作るだけで動きます。ただしネットワークを **None** に
すると `pnpm install` が npm レジストリに届かず失敗するので、Trusted を選んでください。

なお `~/.claude/` 配下の個人設定と、`claude mcp add` の user/local スコープはクラウドに**届きません**。
チーム全員とクラウドに効かせたい設定は、必ずリポジトリにコミットしてください。

## セットアップ

```bash
pnpm install
```

Node のバージョンは `.node-version` に固定しています。nvm / fnm / mise などのバージョン管理ツールを
使っていれば自動で切り替わります。合っていない場合は `engine-strict` により install が失敗します。

必要な環境変数は `.env.example` を `.env` にコピーして埋めてください（`.env` はコミットされません）。

## コマンド

| コマンド                | 内容                                           |
| ----------------------- | ---------------------------------------------- |
| `pnpm run check`        | 整形検査 + 型チェック + テスト（コミット前に） |
| `pnpm run test`         | Vitest でテストを実行                          |
| `pnpm run test:watch`   | Vitest を監視モードで起動                      |
| `pnpm run build`        | `tsc` で `dist/` に出力                        |
| `pnpm run typecheck`    | 型チェックのみ                                 |
| `pnpm run format`       | Prettier で整形                                |
| `pnpm run format:check` | 整形差分の検査のみ                             |

## 参照した公式ドキュメント

- [How Claude remembers your project](https://code.claude.com/docs/en/memory) — `CLAUDE.md` と `AGENTS.md` の関係、書き方の指針
- [Claude Code settings](https://code.claude.com/docs/en/settings) — 設定ファイルの階層と優先順位
- [Claude Code settings reference](https://code.claude.com/docs/en/settings-reference) — 設定キー一覧
- [Explore the .claude directory](https://code.claude.com/docs/en/claude-directory) — `.claude/` 配下でコミットすべきもの・すべきでないもの
- [Configure permissions](https://code.claude.com/docs/en/permissions) — 権限ルールの記法
- [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices) — 指示ファイルの Include / Exclude 表、検証手段を持たせること
- [Hooks reference](https://code.claude.com/docs/en/hooks) — フックのイベントと設定形式
- [Extend Claude with skills](https://code.claude.com/docs/en/skills) — スキルの形式と使いどころ
