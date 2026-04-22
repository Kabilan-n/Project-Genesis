#!/usr/bin/env bash
set -e

echo "=== Project Genesis Startup ==="

# Load env
set -a; source .env; set +a

# 1. Start Docker services
echo "[1/4] Starting PostgreSQL + Redis..."
docker compose up -d
echo "  Waiting for services..."
sleep 5

# 2. Install dependencies
echo "[2/4] Installing dependencies..."
npm install

# 3. Run migrations
echo "[3/4] Running database migrations..."
node db/migrate.js

# 4. Seed the world (only if WORLD_ID is empty)
if [ -z "$WORLD_ID" ]; then
  echo "[4/4] Seeding world..."
  cd packages/simulation
  npx tsx src/seed.ts
  cd ../..
  echo ""
  echo "  *** Copy the WORLD_ID above into your .env file, then re-run this script ***"
  exit 0
fi

echo "[4/4] Starting all services..."
echo "  API:        http://localhost:${API_PORT:-3001}"
echo "  Observer:   http://localhost:${WEB_PORT:-3000}"
echo "  WebSocket:  ws://localhost:${API_PORT:-3001}/ws"
echo ""

# Start all three services in parallel
npx turbo run dev
