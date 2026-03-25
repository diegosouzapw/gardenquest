# Google Client Secret no Secret Manager

Este projeto tambem pode receber `GOOGLE_CLIENT_SECRET` por Secret Manager no deploy do backend para Cloud Run.

## Variaveis usadas no deploy

- `GOOGLE_CLIENT_SECRET_SECRET_NAME`: nome do segredo no Google Secret Manager.
- `GOOGLE_CLIENT_SECRET_SECRET_VERSION`: versao do segredo que sera exposta ao backend como `GOOGLE_CLIENT_SECRET`.

Exemplo no `.env` local usado so para acionar o deploy:

```env
GOOGLE_CLIENT_SECRET_SECRET_NAME=gardenquest-google-client-secret
GOOGLE_CLIENT_SECRET_SECRET_VERSION=1
```

## Criando o segredo

Crie um arquivo temporario contendo apenas o client secret do OAuth:

PowerShell:

```powershell
Set-Content -Path .\google-client-secret.txt -NoNewline -Value "GOCSPX-..."
```

Linux/macOS:

```bash
printf "%s" "GOCSPX-..." > google-client-secret.txt
```

Crie o segredo:

```bash
gcloud secrets create gardenquest-google-client-secret --replication-policy="automatic" --data-file="google-client-secret.txt"
```

Se quiser rotacionar depois:

```bash
gcloud secrets versions add gardenquest-google-client-secret --data-file="google-client-secret.txt"
```

## Permissao para o Cloud Run

Descubra o numero do projeto:

```bash
gcloud projects describe PROJECT_ID --format="value(projectNumber)"
```

Conceda acesso ao service account que roda o backend:

```bash
gcloud secrets add-iam-policy-binding gardenquest-google-client-secret \
  --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

Se voce usar um service account customizado no Cloud Run, substitua o membro pelo correto.

## Configuracao do deploy

No `.env` local:

```env
GOOGLE_CLIENT_SECRET_SECRET_NAME=gardenquest-google-client-secret
GOOGLE_CLIENT_SECRET_SECRET_VERSION=1
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
GOOGLE_CLIENT_SECRET=<secret-name>:<secret-version>
```

e o backend continua lendo `process.env.GOOGLE_CLIENT_SECRET`.

## Observacoes

- Para desenvolvimento local, voce pode continuar usando `GOOGLE_CLIENT_SECRET` no `.env`.
- Em producao, prefira Secret Manager em vez de enviar o client secret inline no deploy.
- Se voce rotacionar o client secret no Google Cloud, crie uma nova versao do segredo e atualize `GOOGLE_CLIENT_SECRET_SECRET_VERSION`.
