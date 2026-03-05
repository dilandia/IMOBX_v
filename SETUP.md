# IMOBX Setup Guide — Passo a Passo

## Pré-requisitos

Antes de começar, certifique-se de ter:

- **Node.js 22+** - [Download aqui](https://nodejs.org/)
- **npm** - Vem com Node.js
- **PostgreSQL 16+** - [Download aqui](https://www.postgresql.org/)
- **Redis 7+** - [Download aqui](https://redis.io/)
- **Evolution API 2.2.3** - Via Docker (veja abaixo)

## 1️⃣ Clonar o Repositório

```bash
git clone https://github.com/dilandia/IMOBX_v.git
cd IMOBX_v
```

## 2️⃣ Instalar Dependências

```bash
npm install
```

Este comando instala todas as dependências para os apps e packages da monorepo.

## 3️⃣ Configurar Variáveis de Ambiente

Copie o arquivo de exemplo:

```bash
cp apps/api/.env.example apps/api/.env
```

Edite `apps/api/.env` com suas credenciais:

```env
# Anthropic API (já preenchido)
ANTHROPIC_API_KEY=***

# Evolution API (deixar como está para teste local)
EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_KEY=imobx_evolution_2026

# Database (se estiver rodando PostgreSQL local)
DATABASE_URL=postgresql://imobx:imobx_secure_2026@localhost:5432/imobx_db

# Redis (deixar como está)
REDIS_URL=redis://:imobx_redis_2026@localhost:6379
```

## 4️⃣ Compilar TypeScript

```bash
npm run build
```

## 5️⃣ Iniciar em Desenvolvimento

### Opção A: Com npm

```bash
npm run dev
```

A API estará disponível em: **http://localhost:3000**

### Opção B: Com PM2 (Produção)

```bash
# Instalar PM2 globalmente (se não tiver)
npm install -g pm2

# Iniciar com PM2
pm2 start apps/api/dist/main.js --name "imobx-api"

# Ver status
pm2 status
pm2 logs imobx-api
```

## 6️⃣ Testar a API

### Verificar Status

```bash
curl http://localhost:3000/health
```

Resultado esperado:
```json
{
  "status": "ok",
  "timestamp": "2026-03-05T10:00:00.000Z"
}
```

### Carregar QR Code

```bash
curl http://localhost:3000/qr-code
```

Resultado esperado:
```json
{
  "status": "ok",
  "qrcode": null,
  "base64": null,
  "instanceStatus": "unknown",
  "timestamp": "2026-03-05T10:00:00.000Z"
}
```

(Nota: Retorna `null` se Evolution API não estiver rodando)

### Interface Web

Acesse: **http://localhost:3000/whatsapp-connect.html**

Você verá:
- ✅ Interface bonita com instruções de setup
- 🔄 Botão "Carregar QR Code"
- 🔁 Botão "Atualizar"
- Status em tempo real

## 7️⃣ Configurar Evolution API (Docker)

Se você quer rodar a Evolution API localmente:

```bash
# Instalar Docker (se não tiver)
# https://www.docker.com/get-started

# Clonar Evolution API
git clone https://github.com/EvolutionAPI/evolution-api.git
cd evolution-api

# Iniciar com Docker
docker-compose up -d

# A API estará em: http://localhost:8080
```

## 8️⃣ Configurar PostgreSQL

Se você quer usar banco de dados local:

```bash
# Criar usuário e banco de dados
createuser -P imobx  # Senha: imobx_secure_2026
createdb -O imobx imobx_db

# Atualizar .env com:
DATABASE_URL=postgresql://imobx:imobx_secure_2026@localhost:5432/imobx_db
```

## 9️⃣ Testar com curl ou Postman

### POST /test/vera (Testar Vera Agent)

```bash
curl -X POST http://localhost:3000/test/vera \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "+5511999999999",
    "text": "Procuro um apartamento de 2 quartos em Leblon",
    "name": "João"
  }'
```

Resposta esperada:
```json
{
  "status": "ok",
  "phoneNumber": "+5511999999999",
  "message": "Olá João! Esta é uma resposta de teste do agente Vera. Recebi sua mensagem: \"Procuro um apartamento de 2 quartos em Leblon\"",
  "latencyMs": 150,
  "timestamp": "2026-03-05T10:00:00.000Z"
}
```

## 🔟 Deploy em Produção

### VPS (Ubuntu)

```bash
# SSH na VPS
ssh user@seu-ip

# Clonar repo
cd /home/takez
git clone https://github.com/dilandia/IMOBX_v.git

# Instalar dependencies
cd IMOBX_v
npm install

# Build
npm run build

# Iniciar com PM2
pm2 start apps/api/dist/main.js --name "imobx-api"

# Salvar lista de processos
pm2 save

# Setup startup (reinicia PM2 após reboot)
pm2 startup
```

### Nginx (Proxy Reverso)

```nginx
server {
    listen 443 ssl http2;
    server_name imobx.example.com;

    ssl_certificate /etc/ssl/certs/cert.crt;
    ssl_certificate_key /etc/ssl/private/key.key;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

## 🐛 Troubleshooting

### "Cannot find module '@fastify/static'"

```bash
npm install @fastify/static
```

### "EADDRINUSE: address already in use :::3000"

Porta 3000 já está em uso. Mude em `.env`:

```env
PORT=3001
```

### "Evolution API connection failed"

Se Evolution API não está rodando, QR code não será gerado. Isso é normal para teste local.

### TypeScript Errors

```bash
npm run build
```

Se tiver erros, verifique:
- `tsconfig.json` está correto
- Todas as dependências foram instaladas

## ✅ Checklist de Sucesso

- [ ] `npm install` rodou sem erros
- [ ] `npm run build` compilou TypeScript com sucesso
- [ ] `npm run dev` iniciou a API
- [ ] `curl http://localhost:3000/health` retorna status ok
- [ ] Acessei `http://localhost:3000/whatsapp-connect.html` e a página carregou
- [ ] Cliquei em "Carregar QR Code" (pode retornar null se Evolution não estiver rodando)

## 🚀 Próximos Passos

1. **Implementar Vera Agent** - Integrar Claude Haiku para respostas automáticas
2. **Configurar Evolution API** - Conectar WhatsApp Business
3. **Implementar Banco de Dados** - Persistência de conversas
4. **Implementar Outros Agentes** - Cat, Cy, Leo, Atlas
5. **Deploy em Produção** - VPS com Nginx

## 📞 Suporte

Se encontrar problemas:

1. Verifique os logs: `npm run dev` (mostra todos os erros)
2. Verifique as variáveis de ambiente em `apps/api/.env`
3. Certifique-se de que Node.js 22+ está instalado: `node --version`

---

**Boa sorte! 🚀**
