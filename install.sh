#!/bin/bash

# IMOBX Installation Script
set -e

echo "🚀 IMOBX - Installation Started"
echo "================================"

# Check Node.js
echo "✓ Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 22+ from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v)
echo "  Node.js version: $NODE_VERSION"

# Check npm
echo "✓ Checking npm..."
NPM_VERSION=$(npm -v)
echo "  npm version: $NPM_VERSION"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# Copy .env if doesn't exist
if [ ! -f "apps/api/.env" ]; then
    echo ""
    echo "📝 Creating apps/api/.env..."
    cp apps/api/.env.example apps/api/.env
    echo "  ✓ Created (please edit with your credentials)"
else
    echo "  ✓ apps/api/.env already exists"
fi

# Build TypeScript
echo ""
echo "🏗️  Building TypeScript..."
npm run build

echo ""
echo "✅ Installation Complete!"
echo ""
echo "Next steps:"
echo "1. Edit apps/api/.env with your credentials"
echo "2. Run: npm run dev"
echo "3. Visit: http://localhost:3000/whatsapp-connect.html"
echo ""
echo "📖 Read SETUP.md for detailed instructions"
