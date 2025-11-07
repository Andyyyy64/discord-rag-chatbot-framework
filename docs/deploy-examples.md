# Cloud Run デプロイのコマンド例

## 基本コマンド

ローカルの `.env` に必須シークレットを入れた状態で、プロジェクト ID のみ指定します。

```bash
npm run deploy -- -p my-gcp-project-123
```

## リージョンやサービス名を変えたい場合

実行前に環境変数で上書きしてください（CLIオプションは `-p` のみ）。

```bash
export GCP_REGION=us-central1
export CLOUD_RUN_SERVICE=discord-rag-prod
export GCP_IMAGE=us-docker.pkg.dev/my-gcp-project-123/rag/discord-rag:latest
npm run deploy -- -p my-gcp-project-123
```

## 参考: `.env` に設定する最低限のキー

```
DISCORD_TOKEN=...
DISCORD_APP_ID=...
DISCORD_PUBLIC_KEY=...
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
DATABASE_URL=postgresql://...
GEMINI_API_KEY=...
```

実際に `npm run deploy` を叩くと、以下が自動で実行されます。

1. `supabase db push --db-url $DATABASE_URL`（supabase CLI があれば）
2. `npm run build`
3. `gcloud builds submit`
4. `gcloud run deploy`（`DISCORD_*`, `SUPABASE_*`, `GEMINI_API_KEY` などを `--set-env-vars` で注入）
