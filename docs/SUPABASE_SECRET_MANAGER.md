# Supabase DB URL no Secret Manager

Este projeto tambem pode receber `SUPABASE_DB_URL` por Secret Manager no deploy do backend para Cloud Run.

## Variaveis usadas no deploy

- `SUPABASE_DB_URL_SECRET_NAME`: nome do segredo no Google Secret Manager.
- `SUPABASE_DB_URL_SECRET_VERSION`: versao do segredo que sera exposta ao backend como `SUPABASE_DB_URL`.

Exemplo no `.env` local usado so para acionar o deploy:

```env
SUPABASE_DB_URL_SECRET_NAME=gardenquest-supabase-db-url
SUPABASE_DB_URL_SECRET_VERSION=1
```

## Criando o segredo

Crie um arquivo temporario contendo a connection string completa:

PowerShell:

```powershell
Set-Content -Path .\supabase-db-url.txt -NoNewline -Value "postgresql://<db-user>:<db-password>@aws-1-sa-east-1.pooler.supabase.com:5432/postgres"
```

Linux/macOS:

```bash
printf "%s" "postgresql://<db-user>:<db-password>@aws-1-sa-east-1.pooler.supabase.com:5432/postgres" > supabase-db-url.txt
```

Crie o segredo:

```bash
gcloud secrets create gardenquest-supabase-db-url --replication-policy="automatic" --data-file="supabase-db-url.txt"
```

Se quiser rotacionar depois:

```bash
gcloud secrets versions add gardenquest-supabase-db-url --data-file="supabase-db-url.txt"
```

## Permissao para o Cloud Run

Descubra o numero do projeto:

```bash
gcloud projects describe PROJECT_ID --format="value(projectNumber)"
```

Conceda acesso ao service account que roda o backend:

```bash
gcloud secrets add-iam-policy-binding gardenquest-supabase-db-url \
  --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

Se voce usar um service account customizado no Cloud Run, substitua o membro pelo correto.

## Configuracao do deploy

No `.env` local:

```env
SUPABASE_DB_URL_SECRET_NAME=gardenquest-supabase-db-url
SUPABASE_DB_URL_SECRET_VERSION=1
```

Depois rode:

```powershell
.\deploy.ps1
```

ou:

```bash
./deploy.sh
```

Os scripts vao vincular:

```text
SUPABASE_DB_URL=<secret-name>:<secret-version>
```

e o backend continua lendo `process.env.SUPABASE_DB_URL`.

## Observacoes

- Para desenvolvimento local, voce pode continuar usando `SUPABASE_DB_URL` no `.env`.
- Em producao, prefira Secret Manager em vez de enviar a connection string inline no deploy.
- Se voce rotacionar a senha do banco, crie uma nova versao do segredo e atualize `SUPABASE_DB_URL_SECRET_VERSION`.
