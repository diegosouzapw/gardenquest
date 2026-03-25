# JWT Secret no Secret Manager

Este projeto tambem pode receber `JWT_SECRET` por Secret Manager no deploy do backend para Cloud Run.

## Variaveis usadas no deploy

- `JWT_SECRET_SECRET_NAME`: nome do segredo no Google Secret Manager.
- `JWT_SECRET_SECRET_VERSION`: versao do segredo que sera exposta ao backend como `JWT_SECRET`.

Exemplo no `.env` local usado so para acionar o deploy:

```env
JWT_SECRET_SECRET_NAME=gardenquest-jwt-secret
JWT_SECRET_SECRET_VERSION=1
```

## Criando o segredo

Linux/macOS:

```bash
openssl rand -base64 48 > jwt-secret.txt
```

PowerShell:

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 })) | Set-Content -Path .\jwt-secret.txt -NoNewline
```

Criacao no Google Cloud:

```bash
gcloud secrets create gardenquest-jwt-secret --replication-policy="automatic" --data-file="jwt-secret.txt"
```

Se quiser rotacionar depois:

```bash
gcloud secrets versions add gardenquest-jwt-secret --data-file="jwt-secret.txt"
```

## Permissao para o Cloud Run

Descubra o numero do projeto:

```bash
gcloud projects describe PROJECT_ID --format="value(projectNumber)"
```

Conceda acesso ao service account que roda o backend:

```bash
gcloud secrets add-iam-policy-binding gardenquest-jwt-secret \
  --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

Se voce usar um service account customizado no Cloud Run, substitua o membro pelo service account correto.

## Configuracao do deploy

No `.env` local:

```env
JWT_SECRET_SECRET_NAME=gardenquest-jwt-secret
JWT_SECRET_SECRET_VERSION=1
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
JWT_SECRET=<secret-name>:<secret-version>
```

e o backend continua lendo `process.env.JWT_SECRET`.

## Impacto da rotacao

Ao trocar `JWT_SECRET`, os tokens anteriores deixam de ser validos.

Na pratica:

- usuarios autenticados precisarao fazer login novamente
- isso e esperado e desejavel quando ha troca de segredo de sessao
