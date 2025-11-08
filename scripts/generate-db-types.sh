#!/bin/bash
# Supabaseから型を自動生成するスクリプト

set -e

# .envから環境変数を読み込む
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

if [ -z "$SUPABASE_URL" ]; then
  echo "❌ SUPABASE_URLが設定されていません (.envを確認してください)"
  exit 1
fi

# SUPABASE_URLからプロジェクトIDを抽出 (例: https://xxxxx.supabase.co → xxxxx)
PROJECT_ID=$(echo "$SUPABASE_URL" | sed -n 's|https://\([^.]*\)\.supabase\.co|\1|p')

if [ -z "$PROJECT_ID" ]; then
  echo "❌ SUPABASE_URLからプロジェクトIDを抽出できませんでした"
  echo "   URL形式: https://your-project-id.supabase.co"
  exit 1
fi

echo "🔄 Supabaseプロジェクト ($PROJECT_ID) から型を生成中..."
npx supabase gen types typescript --project-id "$PROJECT_ID" --schema public > src/infrastructure/supabase/database.types.ts

echo "✅ 型ファイルを生成しました: src/infrastructure/supabase/database.types.ts"

