# Playbook Nuvem - Deploy Cloud Run (GCP)

Este playbook cobre deploy em nuvem usando `deploy.sh` e Cloud Run.

## 1. Objetivo

Publicar em ambiente cloud com:

- Backend em Cloud Run
- Frontend em Cloud Run
- Variaveis e segredos configurados com seguranca

## 2. Pre-requisitos

- Projeto GCP ativo
- `gcloud` instalado e autenticado
- Permissoes:
  - Cloud Run Admin
  - Service Account User
  - Secret Manager Secret Accessor
  - Artifact Registry Writer (quando aplicavel)
- APIs habilitadas:
  - Cloud Run API
  - Cloud Build API
  - Secret Manager API

Validacao rapida:

```bash
gcloud auth list
gcloud config list project
```

## 3. Preparar arquivo de ambiente

Crie (ou revise) um arquivo de deploy, por exemplo `.env.production`.

Campos minimos:

```env
APP_ENV=production
PROJECT_ID=seu-projeto
REGION=southamerica-east1
BACKEND_SERVICE_NAME=gardenquest-api
FRONTEND_SERVICE_NAME=gardenquest-web
GOOGLE_CLIENT_ID=...
ADMIN_GOOGLE_EMAILS=admin@dominio.com
```

Campos obrigatorios sem Secret Manager:

```env
GOOGLE_CLIENT_SECRET=...
JWT_SECRET=...
SUPABASE_DB_URL=postgresql://...
```

## 4. Segredos (recomendado)

Use Secret Manager para os segredos sensiveis:

- `GOOGLE_CLIENT_SECRET`
- `JWT_SECRET`
- `SUPABASE_DB_URL`
- `OPENAI_API_KEY` (opcional)

Exemplo de criacao:

```bash
printf "%s" "$JWT_SECRET" | gcloud secrets create JWT_SECRET --data-file=-
printf "%s" "$GOOGLE_CLIENT_SECRET" | gcloud secrets create GOOGLE_CLIENT_SECRET --data-file=-
printf "%s" "$SUPABASE_DB_URL" | gcloud secrets create SUPABASE_DB_URL --data-file=-
```

Exemplo de versao nova:

```bash
printf "%s" "$JWT_SECRET_NOVO" | gcloud secrets versions add JWT_SECRET --data-file=-
```

Configurar no `.env.production`:

```env
JWT_SECRET_SECRET_NAME=JWT_SECRET
JWT_SECRET_SECRET_VERSION=latest
GOOGLE_CLIENT_SECRET_SECRET_NAME=GOOGLE_CLIENT_SECRET
GOOGLE_CLIENT_SECRET_SECRET_VERSION=latest
SUPABASE_DB_URL_SECRET_NAME=SUPABASE_DB_URL
SUPABASE_DB_URL_SECRET_VERSION=latest
OPENAI_API_KEY_SECRET_NAME=OPENAI_API_KEY
OPENAI_API_KEY_SECRET_VERSION=latest
```

### IA em producao

O backend suporta OpenAI diretamente ou qualquer provedor compativel via `OPENAI_BASE_URL`.

Se usar OmniRoute:

```env
OPENAI_BASE_URL=https://cloud.omniroute.online/sua-key/v1
OPENAI_MODEL=kr/claude-sonnet-4.5
OPENAI_API_TIMEOUT_MS=60000
```

Se `OPENAI_BASE_URL` estiver vazio, o backend usa a API nativa da OpenAI.

## 5. Executar deploy

Deploy completo (backend + frontend):

```bash
./deploy.sh .env.production all seu-projeto southamerica-east1
```

Deploy somente backend:

```bash
./deploy.sh .env.production backend seu-projeto southamerica-east1
```

Deploy somente frontend:

```bash
./deploy.sh .env.production frontend seu-projeto southamerica-east1
```

## 6. Pos-deploy obrigatorio

1. Confirmar URLs geradas no output do script
2. Atualizar OAuth no Google Cloud:
   - Authorized JavaScript origins: URL do frontend
   - Authorized redirect URIs: `https://SEU_FRONTEND/auth/callback`
3. Validar endpoint de health:

```bash
curl -s https://SEU_BACKEND/health
```

## 7. Smoke test em producao/staging

> **Importante:** Em producao, o login dev nao esta disponivel.
> Apenas o Google OAuth aparece na tela de login.

1. Abrir frontend cloud
2. Login Google (obrigatorio em producao)
3. Fluxo `index -> hub -> game`
4. Dashboard admin com usuario allowlist
5. Validar stream/eventos no jogo
6. Se IA configurada, verificar NPC ativo no leaderboard

## 8. Checklist de seguranca

- `COOKIE_SECURE=true` em nuvem
- `SUPABASE_DB_SSL=true`
- Sem segredo hardcoded em arquivo versionado
- Preferir segredos via Secret Manager
- Revisar `ADMIN_GOOGLE_EMAILS` antes de abrir acesso

## 9. Rollback

Listar revisoes:

```bash
gcloud run revisions list --service=gardenquest-api --region=southamerica-east1
gcloud run revisions list --service=gardenquest-web --region=southamerica-east1
```

Redirecionar trafego para revisao anterior:

```bash
gcloud run services update-traffic gardenquest-api \
  --region=southamerica-east1 \
  --to-revisions REVISAO_ESTAVEL=100
```

Repita para frontend quando necessario.

## 10. Observacoes operacionais

- O `deploy.sh` publica backend e frontend via `gcloud run deploy --source`.
- O script atualiza `FRONTEND_URL` e `GOOGLE_REDIRECT_URI` no backend ao final.
- Se `OPENAI_API_KEY` nao for configurada, o backend permanece com fallback deterministico para IA.
