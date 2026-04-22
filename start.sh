#!/bin/bash
set -e

echo "╔════════════════════════════════════╗"
echo "║   Project Genesis - Startup         ║"
echo "╚════════════════════════════════════╝"
echo ""

# Load env
if [ ! -f .env ]; then
  echo "❌ .env not found. Run: cp .env.example .env"
  exit 1
fi
set -a; source .env; set +a

# Check Docker
if ! command -v docker &> /dev/null; then
  echo "❌ Docker not found. Install Docker Desktop from https://docker.com/products/docker-desktop"
  exit 1
fi

# Check Node
if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found. Install Node 20+ from https://nodejs.org"
  exit 1
fi

# Kill any running processes from previous session
echo "🧹 Cleaning up old processes..."
npx kill-port 3000 3001 2>/dev/null || true
taskkill /F /IM node.exe 2>/dev/null || true
sleep 2

# 1. Start Docker services
echo ""
echo "[1/5] 🐳 Starting Docker (PostgreSQL + Redis)..."
docker compose down 2>/dev/null || true
docker compose up -d
echo "  Waiting for services..."
sleep 6

# 2. Install dependencies
echo ""
echo "[2/5] 📦 Installing dependencies..."
npm install --legacy-peer-deps > /dev/null 2>&1 || npm install > /dev/null 2>&1

# 3. Run migrations
echo ""
echo "[3/5] 📊 Running database migrations..."
node db/migrate.js > /dev/null 2>&1

# 4. Seed the world (only if WORLD_ID is empty)
if [ -z "$WORLD_ID" ] || [ "$WORLD_ID" == "" ]; then
  echo ""
  echo "[4/5] 🌍 Seeding world..."
  WORLD_OUTPUT=$(npx tsx packages/simulation/src/seed.ts)
  echo "$WORLD_OUTPUT"

  # Extract WORLD_ID from output
  NEW_WORLD_ID=$(echo "$WORLD_OUTPUT" | grep "WORLD_ID=" | tail -1 | cut -d'=' -f2)

  if [ ! -z "$NEW_WORLD_ID" ]; then
    echo ""
    echo "📝 Updating .env with new WORLD_ID..."
    # Update .env (cross-platform compatible)
    sed -i.bak "s/WORLD_ID=.*/WORLD_ID=$NEW_WORLD_ID/" .env
    sed -i.bak "s/NEXT_PUBLIC_WORLD_ID=.*/NEXT_PUBLIC_WORLD_ID=$NEW_WORLD_ID/" .env

    # Also update web .env.local
    sed -i.bak "s/NEXT_PUBLIC_WORLD_ID=.*/NEXT_PUBLIC_WORLD_ID=$NEW_WORLD_ID/" packages/web/.env.local

    rm -f .env.bak packages/web/.env.local.bak

    echo "✓ .env updated with WORLD_ID=$NEW_WORLD_ID"
  fi
fi

# 5. Start development servers
echo ""
echo "[5/5] 🚀 Starting services..."
echo ""
echo "  🌐 Web Observer:  http://localhost:${WEB_PORT:-3000}"
echo "  📡 API Server:    http://localhost:${API_PORT:-3001}"
echo "  🔌 WebSocket:     ws://localhost:${API_PORT:-3001}/ws"
echo "  🧬 LLM Provider:  $LLM_PROVIDER (Model: $LLM_MODEL)"
echo "  ⚡ Optimization:  $([ "$OPTIMIZE_PROMPTS" == "true" ] && echo "ON (150-250 tokens/decision)" || echo "OFF (600-800 tokens/decision)")"
echo ""
echo "  Press Ctrl+C to stop. Run './kill.sh' to clean up."
echo ""

# Start all services
npx turbo run dev
