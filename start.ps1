# Project Genesis Startup - PowerShell Version

Write-Host ""
Write-Host "╔════════════════════════════════════╗"
Write-Host "║   Project Genesis - Startup        ║"
Write-Host "╚════════════════════════════════════╝"
Write-Host ""

# Check .env exists
if (-not (Test-Path ".env")) {
  Write-Host "❌ Error: .env not found. Run: copy .env.example .env"
  exit 1
}

# Kill old processes
Write-Host "🧹 Cleaning up old processes..."
npx kill-port 3000 3001 2>$null | Out-Null
taskkill /F /IM node.exe 2>$null | Out-Null
Start-Sleep -Seconds 2

# 1. Docker
Write-Host ""
Write-Host "[1/5] 🐳 Starting Docker (PostgreSQL + Redis)..."
docker compose down 2>$null | Out-Null
docker compose up -d
Write-Host "  Waiting for services..."
Start-Sleep -Seconds 6

# 2. Install
Write-Host ""
Write-Host "[2/5] 📦 Installing dependencies..."
npm install | Out-Null

# 3. Migrate
Write-Host ""
Write-Host "[3/5] 📊 Running migrations..."
node db/migrate.js 2>$null | Out-Null

# 4. Seed
Write-Host ""
Write-Host "[4/5] 🌍 Checking world..."
$env_content = Get-Content ".env"
$world_id = ($env_content | Where-Object {$_ -match '^WORLD_ID='}) -replace 'WORLD_ID=', ''

if ([string]::IsNullOrWhiteSpace($world_id)) {
  Write-Host "No WORLD_ID found. Seeding new world..."
  Write-Host ""

  $seed_output = npx tsx packages/simulation/src/seed.ts
  Write-Host $seed_output

  # Extract WORLD_ID
  $new_id = ($seed_output | Where-Object {$_ -match 'WORLD_ID='} | Select-Object -Last 1) -replace '.*WORLD_ID=', ''

  if ($new_id -and $new_id.Length -eq 36) {
    Write-Host ""
    Write-Host "📝 Updating .env..."

    $content = Get-Content ".env"
    $content = $content -replace 'WORLD_ID=.*', "WORLD_ID=$new_id"
    $content = $content -replace 'NEXT_PUBLIC_WORLD_ID=.*', "NEXT_PUBLIC_WORLD_ID=$new_id"
    Set-Content ".env" $content

    $web_content = Get-Content "packages/web/.env.local"
    $web_content = $web_content -replace 'NEXT_PUBLIC_WORLD_ID=.*', "NEXT_PUBLIC_WORLD_ID=$new_id"
    Set-Content "packages/web/.env.local" $web_content

    Write-Host "✓ World created: $new_id"
  }
} else {
  Write-Host "✓ World exists: $world_id"
}

# 5. Start
Write-Host ""
Write-Host "[5/5] 🚀 Starting services..."
Write-Host ""
Write-Host "  🌐 Web Observer:  http://localhost:3000"
Write-Host "  📡 API Server:    http://localhost:3001"
Write-Host "  🔌 WebSocket:     ws://localhost:3001/ws"
Write-Host ""
Write-Host "  Press Ctrl+C to stop. Run 'kill.bat' to clean up."
Write-Host ""

npm run dev
