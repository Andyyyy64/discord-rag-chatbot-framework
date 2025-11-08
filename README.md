# Discord RAG Chatbot Framework

Discord上の全メッセージをembeddingしてchatできるdiscordbotの構築フレームワーク

## 必要なもの

- Node.js 20+
- Supabase アカウント
- gcpアカウント
- Google Gemini API キー
- Discord Bot トークン

supabaseやgcpは **推奨** なだけであって自分で勝手に別のインフラストラクチャに変えていいです。なんならsupabaseなんて使う必要ないよね

discordbotである以上botのtokenは必須です。あと僕はgeminiのembeddingモデルが一番使い勝手がよいと感じたのでgemini-embedding-001を選択しました。正直これもなんでもいいと思う

## セットアップ(推奨フロー)

### 1. Supabaseプロジェクトの作成

1. [Supabase](https://supabase.com) でプロジェクトを作成
2. プロジェクトの設定から以下を取得：
   - `Project URL` (例: `https://xxxxx.supabase.co`)
   - `anon public key`
   - `Database URL` (Settings → Database → Connection string → URI)

### 2. データベーススキーマの作成

Supabase Dashboardで SQL Editor を開き、以下のファイルの内容を実行：

```bash
supabase/migrations/00000000000000_init.sql
```

または、以下のコマンドでローカルから実行：

```bash
# Supabaseにログイン（初回のみ）
npx supabase login

# リモートプロジェクトとリンク
npx supabase link

# マイグレーションを適用
npx supabase db push
```

> **重要**: pgvector拡張が自動的に有効化されます。有効化されない場合は、SQL Editorで手動実行：
> ```sql
> CREATE EXTENSION IF NOT EXISTS vector;
> ```

### 3. 環境変数の設定

`.env.example` をコピーして `.env` を作成：

```bash
cp .env.example .env
```

`.env` を編集して、以下を設定：

```env
# Discord Bot設定
DISCORD_TOKEN=your_discord_bot_token
DISCORD_APP_ID=your_app_id
DISCORD_PUBLIC_KEY=your_public_key

# Supabase設定
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=your_anon_key
DATABASE_URL=postgresql://postgres:[password]@[host]:5432/postgres

# Gemini API設定
GEMINI_API_KEY=your_gemini_api_key
CHAT_MODEL=gemini-2.0-flash-exp
EMBEDDING_MODEL=gemini-embedding-
EMBEDDING_DIM=768

# Rerank設定（オプション）
RERANK_PROVIDER=none
RERANK_MODEL=rerank-3.5
RERANK_TOPK=5
COHERE_API_KEY=
```

### 4. 依存関係のインストール

```bash
npm install
```

### 5. 起動

```bash
# 開発モード（ホットリロード）
npm run dev

# 本番モード
npm run build
npm start
```

## コマンド一覧

### 開発

```bash
npm run dev          # 開発サーバー起動（ホットリロード）
npm run build        # プロダクションビルド
npm start            # ビルド済みアプリを起動
npm run check        # Lint + 型チェック
```

### データベース

```bash
npm run db:types     # Supabaseから型定義を再生成
npm run db:reset     # 全テーブルのデータを削除
```

### デプロイ

```bash
npm run deploy       # Dockerビルド & デプロイ
```

## 型定義の管理

### 自動生成される型

`src/infrastructure/supabase/database.types.ts` はSupabaseから自動生成されます：

```bash
npm run db:types
```

> **注意**: このファイルは編集しないでください。スキーマ変更時に上書きされます。

### カスタム型拡張

アプリケーション固有の型は `database-extensions.types.ts` で定義

## Discord Bot コマンド

### チャット

```
/chat <質問>
```

過去のメッセージから関連する情報を検索して回答

### 同期

```
/sync             # ギルド全体を同期
```

## デプロイ

### Docker

```bash
npm run deploy
```

または手動で：

```bash
docker build -t discord-rag-bot .
docker run -d --env-file .env discord-rag-bot
```

### 環境変数

本番環境では以下を確実に設定：

- `DISCORD_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `DATABASE_URL`
- `GEMINI_API_KEY`

