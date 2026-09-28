# henry-minutes-routine

導入議事録DB で `ステータス` を `完了` にすると、Claude Code が起動して案件の Slack チャンネルへ議事録を展開する。

```
Notion 導入議事録DB（ステータス → 完了）
  └ DB automation: Send webhook
      ├ Plan A: ルーティンの fire URL へ直接 POST（サーバー不要）
      └ Plan B: 自前の受け口（scripts/receiver.py）→ claude -p
            ↓
      ROUTINE_PROMPT.md の手順で
        1. 「完了 かつ 未処理」の議事録を検索
        2. プロジェクト → 導入案件リソースDB → Slack チャンネルID
        3. 区分=社外 なら hospital-minutes で docx（+PDF）生成
        4. Slack 投稿（添付 or Notion 添付へのリンク）
        5. 更新履歴を本文に追記 → AI処理日時 を書き戻し
```

Webhook の中身は使わない。ルーティン側が「完了かつ未処理」を自分で探すので、Notion の再送や同時起動があっても二重投稿にならない。

## 構成

| パス | 役割 |
|---|---|
| `ROUTINE_PROMPT.md` | ルーティンに貼る指示文（手順の正本） |
| `CLAUDE.md` | 触ってよい範囲・環境変数 |
| `.claude/skills/hospital-minutes/` | 顧客展開用議事録を作るスキル |
| `.mcp.json` | Notion / Slack のコネクタ（Plan B で使用） |
| `scripts/receiver.py` | Plan B の受け口 |

## 0. 共通：Notion 側

`導入議事録DB` に `ステータス`（select）を追加済み: `準備中` / `完了`。処理済みかどうかは `AI処理日時` と本文末尾の「更新履歴」で分かる。

DB automation を 1 つ作る。

- トリガー: `ステータス` が `完了` に変更されたとき
- アクション: Send webhook（URL とヘッダは Plan A / B で異なる。下記）

`導入案件リソースDB` の `Slack チャンネルID` が空の案件は通知されない（議事録ページにコメントが残る）ので、事前に埋めておく。

## Plan A: Claude Code ルーティン（推奨・サーバー不要）

1. このリポジトリを GitHub に push する
2. [claude.ai/code/routines](https://claude.ai/code/routines) でルーティンを作成
   - リポジトリ: このリポジトリ
   - Instructions: `ROUTINE_PROMPT.md` の内容を貼る
   - コネクタ: Notion と Slack を接続
   - 環境変数（任意）: `SLACK_BOT_TOKEN`（設定できる場合のみ。無くても動く）
3. Edit → **Add another trigger → API** で URL とトークンを発行
4. Notion の Send webhook に設定
   - URL: `https://api.anthropic.com/v1/claude_code/routines/trig_.../fire`
   - カスタムヘッダ:
     - `Authorization`: `Bearer sk-ant-oat01-...`
     - `anthropic-version`: `2023-06-01`
     - `Content-Type`: `application/json`
5. 議事録を 1 件 `完了` にして、ルーティンのセッションが立ち上がることを確認

制約:

- fire は 1 ルーティン 30 回/時、アカウント 100 回/時
- 実行はクラウド環境。`soffice` が無ければ PDF は作られず docx のみ（指示文がそう扱う）
- ルーティンは research preview

## Plan B: 自前の Claude Code 環境

クラウドで LibreOffice が使えない、Slack へ直接ファイルを上げたい、実行環境を手元に置きたい、のいずれかなら B。

前提: `claude` CLI がログイン済み、`node`・`python3`、PDF が要るなら LibreOffice と poppler（`pdftoppm`）。

```bash
npm ci
cp .env.example .env   # WEBHOOK_SECRET を決める
set -a; . ./.env; set +a
python3 scripts/receiver.py --port 8787
```

外から届くようにする（Cloud Run にコンテナ化するか、手元なら `cloudflared tunnel --url http://localhost:8787`）。

Notion の Send webhook に設定:

- URL: 受け口の公開 URL
- カスタムヘッダ: `X-Webhook-Secret`: `<WEBHOOK_SECRET>`

受け口は即 202 を返し、`claude -p ROUTINE_PROMPT.md` を直列で 1 本ずつ流す。Notion / Slack は `.mcp.json` の HTTP MCP を使う（初回は `claude` を対話で起動して `/mcp` から認証しておく）。

Cloud Run に載せる場合の Dockerfile の要点:

```dockerfile
FROM node:22-bookworm
RUN apt-get update && apt-get install -y libreoffice-writer poppler-utils python3 fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
RUN npm i -g @anthropic-ai/claude-code
WORKDIR /app
COPY . .
RUN npm ci
CMD ["python3", "scripts/receiver.py", "--port", "8080"]
```

`claude` の認証は `ANTHROPIC_API_KEY` を Secret Manager から渡す（従量課金）。サブスクの `claude -p` は 2026-06-15 以降 Agent SDK 枠の消費になる点に注意。

## 手動で 1 回だけ流す

```bash
claude -p "$(cat ROUTINE_PROMPT.md)"
```

Plan A / B のどちらでも、まずこれで 1 件通してから automation を有効にする。
