#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source ./.env
  set +a
fi

PROJECT_ID="${GCP_PROJECT_ID:-}"
REGION="${GCP_REGION:-asia-northeast1}"
SERVICE_NAME="${CLOUD_RUN_SERVICE:-discord-rag-bot}"
IMAGE="${GCP_IMAGE:-}"

print_help() {
  cat <<'USAGE'
Usage: npm run deploy -- -p <GCP_PROJECT_ID>

Options:
  -p, --project-id   GCP Project ID (必須・環境変数 GCP_PROJECT_ID でも可)
  -h, --help         このヘルプを表示

※ リージョンやサービス名は `.env` または環境変数 (GCP_REGION / CLOUD_RUN_SERVICE / GCP_IMAGE) で調整できます。
USAGE
}

while (($#)); do
  case "$1" in
    -p|--project-id)
      PROJECT_ID="$2"
      shift 2
      ;;
    -h|--help)
      print_help
      exit 0
      ;;
    --)
      shift
      break
      ;;
    *)
      echo "Unknown option: $1" >&2
      print_help
      exit 1
      ;;
  esac
done

if [[ -z "$PROJECT_ID" ]]; then
  echo "Error: GCP project id は -p か GCP_PROJECT_ID で指定してください" >&2
  exit 1
fi

if [[ -z "$IMAGE" ]]; then
  IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"
fi

REQUIRED_ENV=(
  DISCORD_TOKEN
  DISCORD_APP_ID
  DISCORD_PUBLIC_KEY
  SUPABASE_URL
  SUPABASE_ANON_KEY
  GEMINI_API_KEY
  DATABASE_URL
)

missing=false
for key in "${REQUIRED_ENV[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "Error: 環境変数 $key が設定されていません" >&2
    missing=true
  fi
done

if [[ "$missing" == true ]]; then
  exit 1
fi

escape_commas() {
  local value="$1"
  printf '%s' "${value//,/\\,}"
}

declare -a env_pairs
for key in "${REQUIRED_ENV[@]}"; do
  value="${!key}"
  env_pairs+=("${key}=$(escape_commas "$value")")
done

ENV_VARS_STRING=$(IFS=','; echo "${env_pairs[*]}")

run() {
  echo ""
  echo "# $*"
  "$@"
}

# pgvector拡張機能を有効化
echo ""
echo "# Enabling pgvector extension..."
if command -v psql &> /dev/null; then
  psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS vector;" || {
    echo "Warning: pgvector拡張の有効化に失敗しました。既に有効化されている可能性があります。" >&2
  }
else
  echo "Warning: psql コマンドが見つかりません。pgvector拡張が有効化されていることを確認してください。" >&2
fi

run npm run db:migrate

# Ensure required GCP services are enabled (idempotent)
run gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  iam.googleapis.com \
  aiplatform.googleapis.com \
  --project "$PROJECT_ID"

run npm run build
run gcloud builds submit --tag "$IMAGE" --project "$PROJECT_ID"
run gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --project "$PROJECT_ID" \
  --set-env-vars "$ENV_VARS_STRING"

echo "\n✅ Deployment completed."
