# IMOBX - AI-Powered WhatsApp Platform for Real Estate

Uma plataforma de IA para gerenciar clientes via WhatsApp Business, com agentes autônomos que entendem necessidades imobiliárias.

## 🚀 Quick Start

### Pré-requisitos

- Node.js 22+
- npm ou yarn
- PostgreSQL 16+ com pgvector
- Redis 7+
- Evolution API v2.2.3 (Docker)

### Instalação

```bash
# Clonar repositório
git clone https://github.com/dilandia/IMOBX_v.git
cd IMOBX_v

# Instalar dependências (monorepo)
npm install

# Configurar variáveis de ambiente
cp apps/api/.env.example apps/api/.env
# Editar apps/api/.env com suas credenciais

# Build
npm run build

# Desenvolvimento
npm run dev

# Produção
npm run build && npm start
```

## 📋 Estrutura do Projeto

```
IMOBX_v/
├── docs/
│   ├── PRD.md                  # Especificação de requisitos
│   ├── ARCHITECTURE.md         # Arquitetura técnica completa
│   └── MARKET-RESEARCH.md      # Pesquisa de mercado e TAM
├── apps/
│   └── api/                    # API Gateway (Fastify)
│       ├── src/
│       │   ├── main.ts         # Servidor Fastify
│       │   └── routes/
│       │       ├── qr-code.ts  # QR code endpoints
│       │       ├── webhook.ts  # Webhook receivers
│       │       └── test.ts     # Test endpoints
│       └── public/
│           └── whatsapp-connect.html
└── packages/
    └── db/                     # Database migrations
```

## 🤖 Agentes

- **Vera** (Attendant) - Primeira interação, captura necessidades
- **Cat** (Categorizer) - Classifica leads e propriedades
- **Cy** (Copywriter) - Personaliza respostas
- **Leo** (Analyst) - Análise de dados e learning
- **Atlas** (CEO) - Escalação e decisões críticas

## 🔗 Endpoints

### QR Code (WhatsApp Connection)

```bash
# Carregar QR code
GET /qr-code

# Atualizar QR code
POST /qr-code/refresh
```

### Webhooks (Evolution API)

```bash
# Receber mensagem
POST /webhook/message

# Status de entrega
POST /webhook/status
```

### Testing

```bash
# Testar Vera agent
POST /test/vera
Body: { "phoneNumber": "+55...", "text": "...", "name": "..." }

# Status do sistema
GET /test/status
```

### Health

```bash
GET /health
```

## 📞 WhatsApp Setup

1. Acesse `https://seu-dominio.com/whatsapp-connect.html`
2. Clique em "Carregar QR Code"
3. Escaneie com WhatsApp Business
4. Aprove a autenticação

## 🔐 Segurança

- Rate limiting por tenant
- Validação de webhook signature
- RLS (Row-Level Security) no PostgreSQL
- Isolation de dados por tenant_id

## 📚 Documentação Completa

- **PRD.md** - Especificação de features
- **ARCHITECTURE.md** - Design técnico detalhado
- **MARKET-RESEARCH.md** - Análise de mercado

## 🚢 Deployment

```bash
# Build production
NODE_OPTIONS=--max-old-space-size=1024 npm run build

# Start with PM2
pm2 start infra/pm2.config.js

# Monitorar
pm2 logs imobx-api
```

## 📞 Suporte

Para questões, veja a documentação em `docs/` ou abra uma issue.

---

**Status:** Desenvolvimento MVP
**Versão:** 1.0.0
**Data:** 2026-03-05
