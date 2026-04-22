#!/bin/bash
# Stop all Genesis processes and services

echo "🛑 Stopping Project Genesis..."

# Kill Node processes
echo "  Killing Node processes..."
npx kill-port 3000 3001 2>/dev/null || true
taskkill /F /IM node.exe 2>/dev/null || true

# Stop Docker containers
echo "  Stopping Docker containers..."
docker compose down 2>/dev/null || true

sleep 2
echo "✓ Project Genesis stopped"
