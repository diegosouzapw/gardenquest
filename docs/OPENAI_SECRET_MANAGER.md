# OpenAI no Secret Manager

Este projeto ja aceita `OPENAI_API_KEY` por Secret Manager no deploy do backend para Cloud Run.

## Variaveis usadas no deploy

- `OPENAI_API_KEY_SECRET_NAME`: nome do segredo no Google Secret Manager.
- `OPENAI_API_KEY_SECRET_VERSION`: versao do segredo que sera exposta ao backend como `OPENAI_API_KEY`.

Exemplo no `.env` local usado so para acionar o deploy:

```env
OPENAI_API_KEY_SECRET_NAME=gardenquest-openai-api-key
OPENAI_API_KEY_SECRET_VERSION=1
```

## Fluxo recomendado

1. Habilite a API do Secret Manager no projeto:

```bash
gcloud services enable secretmanager.googleapis.com
```

2. Crie um arquivo temporario contendo apenas a chave OpenAI.

Linux/macOS:

```bash
printf "%s" "<your-openai-api-key>" > openai-api-key.txt
```

PowerShell:

```powershell
Set-Content -Path .\openai-api-key.txt -NoNewline -Value "<your-openai-api-key>"
```

3. Crie o segredo no Google Cloud.

```bash
gcloud secrets create gardenquest-openai-api-key --replication-policy="automatic" --data-file="openai-api-key.txt"
```

Se o segredo ja existir e voce quiser rotacionar a chave:

```bash
gcloud secrets versions add gardenquest-openai-api-key --data-file="openai-api-key.txt"
```

4. Descubra o numero do projeto e conceda acesso ao service account que roda o backend.

```bash
gcloud projects describe PROJECT_ID --format="value(projectNumber)"
```

Se voce estiver usando o service account padrao do Cloud Run neste projeto, normalmente ele sera:

```text
PROJECT_NUMBER-compute@developer.gserviceaccount.com
```

Conceda acesso ao segredo:

```bash
gcloud secrets add-iam-policy-binding gardenquest-openai-api-key \
  --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

Se voce usar um service account customizado no Cloud Run, conceda o acesso a ele em vez do padrao.

5. Configure no `.env` local apenas o nome e a versao do segredo:

```env
OPENAI_API_KEY_SECRET_NAME=gardenquest-openai-api-key
OPENAI_API_KEY_SECRET_VERSION=1
```

6. Rode o deploy normalmente:

PowerShell:

```powershell
.\deploy.ps1
```

Bash:

```bash
./deploy.sh
```

Os scripts vao enviar ao Cloud Run:

```text
OPENAI_API_KEY=<secret-name>:<secret-version>
```

e o backend vai continuar lendo `process.env.OPENAI_API_KEY` sem nenhuma mudanca adicional no codigo.

## Observacoes

- Para desenvolvimento local, voce pode continuar usando `OPENAI_API_KEY` no `.env`.
- Para producao, prefira Secret Manager em vez de passar a chave inline em comando ou script.
- Em rotacao, crie uma nova versao do segredo e atualize `OPENAI_API_KEY_SECRET_VERSION` no deploy.
