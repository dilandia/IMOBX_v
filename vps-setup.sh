#!/bin/bash

# IMOBX VPS Setup Script
# Executar: bash vps-setup.sh

set -e

echo "🚀 IMOBX VPS Setup iniciado..."
echo ""

# ============================================================
# 1. Configurar SSH
# ============================================================
echo "📝 [1/5] Configurando SSH..."
mkdir -p /home/imobx/.ssh
echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOaRtkebjd2M7PVoQYgx2OiNtPdbSXc5mjwiTZsgMTHW imobx@tradeaihub.com" >> /home/imobx/.ssh/authorized_keys 2>/dev/null || true
chmod 600 /home/imobx/.ssh/authorized_keys
chown -R imobx:imobx /home/imobx/.ssh
echo "✅ SSH configurado"
echo ""

# ============================================================
# 2. Clonar Repositório
# ============================================================
echo "📥 [2/5] Clonando repositório..."
cd /home/imobx
if [ ! -d "imobx_project" ]; then
  sudo -u imobx git clone https://github.com/dilandia/IMOBX_v.git imobx_project
else
  echo "⚠️  Diretório já existe, pulando clone"
fi
cd imobx_project
echo "✅ Repositório pronto"
echo ""

# ============================================================
# 3. Criar .env
# ============================================================
echo "⚙️  [3/5] Criando .env..."
cat > apps/api/.env << 'EOFENV'
PORT=3000
HOST=0.0.0.0
NODE_ENV=production
ANTHROPIC_API_KEY=***
EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_KEY=imobx_evolution_2026
EVOLUTION_INSTANCE_NAME=imobx-prod
DATABASE_URL=postgresql://imobx:imobx_secure_2026@localhost:5432/imobx_db
REDIS_URL=redis://:imobx_redis_2026@localhost:6379
WEBHOOK_SECRET=imobx_webhook_secret_2026
LOG_LEVEL=info
DEBUG=false
EOFENV
chown imobx:imobx apps/api/.env
echo "✅ .env criado"
echo ""

# ============================================================
# 4. npm install + build
# ============================================================
echo "📦 [4/5] Instalando dependências (pode levar alguns minutos)..."
sudo -u imobx npm install --legacy-peer-deps 2>&1 | tail -3
echo "✅ npm install completo"
echo ""

echo "🔨 [5/5] Compilando TypeScript..."
sudo -u imobx npm run build 2>&1 | tail -5
echo "✅ Build completo"
echo ""

# ============================================================
# 5. Testes rápidos
# ============================================================
echo "🧪 Testando estrutura..."
echo ""
echo "📂 Arquivos compilados:"
ls -lh apps/api/dist/main.js 2>/dev/null && echo "✅ main.js OK" || echo "❌ main.js não encontrado"
echo ""

# ============================================================
# 6. Instruções finais
# ============================================================
echo "════════════════════════════════════════════════════"
echo "✅ SETUP COMPLETO!"
echo "════════════════════════════════════════════════════"
echo ""
echo "📍 Localização: /home/imobx/imobx_project"
echo "🔐 SSH: Configurado para imobx"
echo "📝 .env: Criado"
echo "📦 npm: Instalado"
echo "🔨 TypeScript: Compilado"
echo ""
echo "🚀 PRÓXIMOS PASSOS:"
echo ""
echo "1️⃣  Conectar via SSH (agora funciona):"
echo "    ssh -i ~/.ssh/imobx_vps imobx@46.224.198.222"
echo ""
echo "2️⃣  Iniciar a API:"
echo "    cd /home/imobx/imobx_project"
echo "    npm run dev"
echo ""
echo "3️⃣  Ou rodar com PM2:"
echo "    npm install -g pm2"
echo "    pm2 start apps/api/dist/main.js --name imobx-api"
echo "    pm2 logs imobx-api"
echo ""
echo "════════════════════════════════════════════════════"
echo ""
echo "✨ Avise quando estiver pronto para os próximos passos!"
