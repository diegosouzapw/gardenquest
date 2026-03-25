#!/bin/bash

set -euo pipefail

load_env_file() {
  local env_file="$1"

  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"

    case "$line" in
      ''|'#'*) continue ;;
    esac

    if [[ "$line" != *=* ]]; then
      continue
    fi

    local key="${line%%=*}"
    local value="${line#*=}"

    case "$key" in
      APP_ENV|PROJECT_ID|REGION|BACKEND_SERVICE_NAME|FRONTEND_SERVICE_NAME|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|JWT_SECRET|ADMIN_GOOGLE_EMAILS|SUPABASE_DB_URL|SUPABASE_DB_SSL_CA_PATH|LOCAL_BACKEND_URL|OPENAI_API_KEY_SECRET_NAME|OPENAI_API_KEY_SECRET_VERSION|JWT_SECRET_SECRET_NAME|JWT_SECRET_SECRET_VERSION|SUPABASE_DB_URL_SECRET_NAME|SUPABASE_DB_URL_SECRET_VERSION|GOOGLE_CLIENT_SECRET_SECRET_NAME|GOOGLE_CLIENT_SECRET_SECRET_VERSION)
        printf -v "$key" '%s' "$value"
        export "$key"
        ;;
    esac
  done < "$env_file"
}

ENV_FILE=${1:-${ENV_FILE:-""}}

if [ -z "$ENV_FILE" ]; then
  if [ -f .env.production ]; then
    ENV_FILE=".env.production"
  elif [ -f .env ]; then
    ENV_FILE=".env"
  fi
fi

if [ -n "$ENV_FILE" ] && [ ! -f "$ENV_FILE" ]; then
  echo "Error: env file not found: $ENV_FILE"
  exit 1
fi

if [ -n "$ENV_FILE" ]; then
  echo "Loading configuration from $ENV_FILE..."
  load_env_file "$ENV_FILE"
fi

PROJECT_ID=${3:-${PROJECT_ID:-""}}
REGION=${4:-${REGION:-"southamerica-east1"}}
APP_ENV=${APP_ENV:-"production"}

if [ -z "$PROJECT_ID" ]; then
  echo "Error: PROJECT_ID is required. Set it in .env or pass as first argument."
  exit 1
fi

TARGET=${2:-${TARGET:-"all"}}

BACKEND_SERVICE_NAME=${BACKEND_SERVICE_NAME:-"gardenquest-api"}
FRONTEND_SERVICE_NAME=${FRONTEND_SERVICE_NAME:-"gardenquest-web"}
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID:-""}
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET:-""}
JWT_SECRET=${JWT_SECRET:-""}
ADMIN_GOOGLE_EMAILS=${ADMIN_GOOGLE_EMAILS:-""}
SUPABASE_DB_URL=${SUPABASE_DB_URL:-""}
SUPABASE_DB_SSL_CA_PATH=${SUPABASE_DB_SSL_CA_PATH:-""}
OPENAI_API_KEY_SECRET_NAME=${OPENAI_API_KEY_SECRET_NAME:-""}
OPENAI_API_KEY_SECRET_VERSION=${OPENAI_API_KEY_SECRET_VERSION:-"1"}
JWT_SECRET_SECRET_NAME=${JWT_SECRET_SECRET_NAME:-""}
JWT_SECRET_SECRET_VERSION=${JWT_SECRET_SECRET_VERSION:-"1"}
SUPABASE_DB_URL_SECRET_NAME=${SUPABASE_DB_URL_SECRET_NAME:-""}
SUPABASE_DB_URL_SECRET_VERSION=${SUPABASE_DB_URL_SECRET_VERSION:-"1"}
GOOGLE_CLIENT_SECRET_SECRET_NAME=${GOOGLE_CLIENT_SECRET_SECRET_NAME:-""}
GOOGLE_CLIENT_SECRET_SECRET_VERSION=${GOOGLE_CLIENT_SECRET_SECRET_VERSION:-"1"}

require_env() {
  local name="$1"
  local value="${!name:-}"
  if [ -z "$value" ]; then
    echo "Error: $name is required for deploy."
    exit 1
  fi
}

require_env GOOGLE_CLIENT_ID
require_env ADMIN_GOOGLE_EMAILS

if [ -z "$JWT_SECRET_SECRET_NAME" ]; then
  require_env JWT_SECRET
fi

if [ -z "$SUPABASE_DB_URL_SECRET_NAME" ]; then
  require_env SUPABASE_DB_URL
fi

if [ -z "$GOOGLE_CLIENT_SECRET_SECRET_NAME" ]; then
  require_env GOOGLE_CLIENT_SECRET
fi

echo "----------------------------------"
echo "  Garden Quest -- Cloud Run Deploy"
echo "  Project: $PROJECT_ID"
echo "  Region:  $REGION"
echo "  Target:  $TARGET"
echo "----------------------------------"

gcloud config set project "$PROJECT_ID"

BACKEND_URL=""
FRONTEND_URL=""

if [ "$TARGET" = "all" ] || [ "$TARGET" = "backend" ]; then
  echo ""
  echo "Deploying Backend..."
  cd backend

BACKEND_ENV_VARS=(
  "NODE_ENV=production"
  "APP_ENV=$APP_ENV"
  "GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID"
  "ADMIN_GOOGLE_EMAILS=$ADMIN_GOOGLE_EMAILS"
  "SUPABASE_DB_SSL=true"
  "COOKIE_SAME_SITE=Lax"
)

if [ -n "$SUPABASE_DB_SSL_CA_PATH" ]; then
  BACKEND_ENV_VARS+=("SUPABASE_DB_SSL_CA_PATH=$SUPABASE_DB_SSL_CA_PATH")
fi

if [ -z "$GOOGLE_CLIENT_SECRET_SECRET_NAME" ]; then
  BACKEND_ENV_VARS+=("GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET")
else
  echo "Binding GOOGLE_CLIENT_SECRET from Secret Manager: $GOOGLE_CLIENT_SECRET_SECRET_NAME:$GOOGLE_CLIENT_SECRET_SECRET_VERSION"
fi

if [ -z "$JWT_SECRET_SECRET_NAME" ]; then
  BACKEND_ENV_VARS+=("JWT_SECRET=$JWT_SECRET")
else
  echo "Binding JWT_SECRET from Secret Manager: $JWT_SECRET_SECRET_NAME:$JWT_SECRET_SECRET_VERSION"
fi

BACKEND_SECRETS=()
if [ -n "$GOOGLE_CLIENT_SECRET_SECRET_NAME" ]; then
  BACKEND_SECRETS+=("GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET_SECRET_NAME:$GOOGLE_CLIENT_SECRET_SECRET_VERSION")
fi

if [ -n "$JWT_SECRET_SECRET_NAME" ]; then
  BACKEND_SECRETS+=("JWT_SECRET=$JWT_SECRET_SECRET_NAME:$JWT_SECRET_SECRET_VERSION")
fi

if [ -z "$SUPABASE_DB_URL_SECRET_NAME" ]; then
  BACKEND_ENV_VARS+=("SUPABASE_DB_URL=$SUPABASE_DB_URL")
else
  echo "Binding SUPABASE_DB_URL from Secret Manager: $SUPABASE_DB_URL_SECRET_NAME:$SUPABASE_DB_URL_SECRET_VERSION"
  BACKEND_SECRETS+=("SUPABASE_DB_URL=$SUPABASE_DB_URL_SECRET_NAME:$SUPABASE_DB_URL_SECRET_VERSION")
fi

if [ -n "$OPENAI_API_KEY_SECRET_NAME" ]; then
  echo "Binding OPENAI_API_KEY from Secret Manager: $OPENAI_API_KEY_SECRET_NAME:$OPENAI_API_KEY_SECRET_VERSION"
  BACKEND_SECRETS+=("OPENAI_API_KEY=$OPENAI_API_KEY_SECRET_NAME:$OPENAI_API_KEY_SECRET_VERSION")
elif [ -z "$GOOGLE_CLIENT_SECRET_SECRET_NAME" ] && [ -z "$JWT_SECRET_SECRET_NAME" ] && [ -z "$SUPABASE_DB_URL_SECRET_NAME" ]; then
  echo "No backend secrets configured via Secret Manager."
fi

if [ -z "$OPENAI_API_KEY_SECRET_NAME" ]; then
  echo "OPENAI_API_KEY secret not configured for Cloud Run. Backend will keep fallback AI behavior."
fi

BACKEND_ENV_VARS_CSV=$(IFS=,; echo "${BACKEND_ENV_VARS[*]}")
BACKEND_DEPLOY_CMD=(
  gcloud run deploy "$BACKEND_SERVICE_NAME"
  --source .
  --region "$REGION"
  --platform managed
  --allow-unauthenticated
  --port 8080
  --memory 256Mi
  --cpu 1
  --min-instances 0
  --max-instances 1
  --set-env-vars "$BACKEND_ENV_VARS_CSV"
)

if [ ${#BACKEND_SECRETS[@]} -gt 0 ]; then
  BACKEND_SECRETS_CSV=$(IFS=,; echo "${BACKEND_SECRETS[*]}")
  BACKEND_DEPLOY_CMD+=(
    --update-secrets
    "$BACKEND_SECRETS_CSV"
  )
fi

  "${BACKEND_DEPLOY_CMD[@]}"
  BACKEND_URL=$(gcloud run services describe "$BACKEND_SERVICE_NAME" --region "$REGION" --format='value(status.url)')
  echo "Backend: $BACKEND_URL"
  cd ..
else
  echo "Skipping Backend deploy. Fetching existing Backend URL..."
  BACKEND_URL=$(gcloud run services describe "$BACKEND_SERVICE_NAME" --region "$REGION" --format='value(status.url)')
  if [ -z "$BACKEND_URL" ]; then
    echo "Error: Could not find existing Backend service. Please deploy 'all' or 'backend' first."
    exit 1
  fi
  echo "Backend (existing): $BACKEND_URL"
fi

if [ "$TARGET" = "all" ] || [ "$TARGET" = "frontend" ]; then
  echo ""
  echo "Deploying Frontend..."
  cd frontend

  FRONTEND_ENV_VARS="BACKEND_UPSTREAM=$BACKEND_URL"

  gcloud run deploy "$FRONTEND_SERVICE_NAME" \
    --source . \
    --region "$REGION" \
    --platform managed \
    --allow-unauthenticated \
    --port 8080 \
    --memory 128Mi \
    --cpu 1 \
    --min-instances 0 \
    --max-instances 5 \
    --set-env-vars "$FRONTEND_ENV_VARS"

  FRONTEND_URL=$(gcloud run services describe "$FRONTEND_SERVICE_NAME" --region "$REGION" --format='value(status.url)')
  echo "Frontend: $FRONTEND_URL"
  cd ..
else
  echo "Skipping Frontend deploy. Fetching existing Frontend URL..."
  FRONTEND_URL=$(gcloud run services describe "$FRONTEND_SERVICE_NAME" --region "$REGION" --format='value(status.url)')
  if [ -z "$FRONTEND_URL" ]; then
    echo "Warning: Could not find existing Frontend service. Backend callback update might fail."
  else
    echo "Frontend (existing): $FRONTEND_URL"
  fi
fi

if [ -n "$FRONTEND_URL" ]; then
  echo ""
  echo "Updating Backend callback and frontend URL..."
  FINAL_BACKEND_ENV_VARS="FRONTEND_URL=$FRONTEND_URL,GOOGLE_REDIRECT_URI=$FRONTEND_URL/auth/callback,COOKIE_SAME_SITE=Lax"

  gcloud run services update "$BACKEND_SERVICE_NAME" \
    --region "$REGION" \
    --update-env-vars "$FINAL_BACKEND_ENV_VARS"

  echo ""
  echo "----------------------------------"
  echo "  Deploy Complete"
  echo "----------------------------------"
  echo ""
  echo "  Frontend URL: $FRONTEND_URL"
  echo "  Backend URL:  $BACKEND_URL"
  echo ""
  echo "  Action required in Google Cloud Console:"
  echo "  1. Authorized JavaScript origins:"
  echo "     $FRONTEND_URL"
  echo ""
  echo "  2. Authorized redirect URIs:"
  echo "     $FRONTEND_URL/auth/callback"
  echo ""
  echo "----------------------------------"
else
  echo ""
  echo "Deploy Complete (frontend callback update skipped; FRONTEND_URL is empty)."
  echo "Backend URL:  $BACKEND_URL"
fi
