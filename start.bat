@echo off
setlocal enabledelayedexpansion

echo.
echo ╔════════════════════════════════════╗
echo ║   Project Genesis - Startup         ║
echo ╚════════════════════════════════════╝
echo.

REM Check for .env file
if not exist ".env" (
  echo ❌ .env not found. Run: copy .env.example .env
  exit /b 1
)

REM Load .env manually (simplified - just read WORLD_ID)
for /f "tokens=2 delims==" %%A in (findstr /B "WORLD_ID=" .env) do set WORLD_ID=%%A
for /f "tokens=2 delims==" %%A in (findstr /B "API_PORT=" .env) do set API_PORT=%%A
for /f "tokens=2 delims==" %%A in (findstr /B "WEB_PORT=" .env) do set WEB_PORT=%%A
for /f "tokens=2 delims==" %%A in (findstr /B "LLM_PROVIDER=" .env) do set LLM_PROVIDER=%%A
for /f "tokens=2 delims==" %%A in (findstr /B "LLM_MODEL=" .env) do set LLM_MODEL=%%A
for /f "tokens=2 delims==" %%A in (findstr /B "OPTIMIZE_PROMPTS=" .env) do set OPTIMIZE_PROMPTS=%%A

if "!API_PORT!"=="" set API_PORT=3001
if "!WEB_PORT!"=="" set WEB_PORT=3000
if "!LLM_PROVIDER!"=="" set LLM_PROVIDER=anthropic

REM Kill any running processes from previous session
echo 🧹 Cleaning up old processes...
npx kill-port 3000 3001 2>nul || true
taskkill /F /IM node.exe 2>nul || true
timeout /t 2 /nobreak

REM 1. Start Docker services
echo.
echo [1/5] 🐳 Starting Docker ^(PostgreSQL + Redis^)...
docker compose down 2>nul || true
docker compose up -d
echo   Waiting for services...
timeout /t 6 /nobreak

REM 2. Install dependencies
echo.
echo [2/5] 📦 Installing dependencies...
call npm install >nul 2>&1 || (echo ERROR: npm install failed & exit /b 1)

REM 3. Run migrations
echo.
echo [3/5] 📊 Running database migrations...
node db/migrate.js >nul 2>&1

REM 4. Seed the world if needed
if "!WORLD_ID!"=="" (
  echo.
  echo [4/5] 🌍 Seeding world...
  for /f "delims=" %%A in ('npx tsx packages/simulation/src/seed.ts 2^>nul') do (
    echo %%A
    if "%%A"=="WORLD_ID=" set "WORLD_ID=%%B"
  )

  if not "!WORLD_ID!"=="" (
    echo.
    echo 📝 Updating .env with new WORLD_ID...
    REM Simple replacement (note: this is basic, use PowerShell for better reliability)
    powershell -Command "(gc .env) -replace 'WORLD_ID=.*', 'WORLD_ID=!WORLD_ID!' | sc .env" 2>nul || true
    powershell -Command "(gc packages/web/.env.local) -replace 'NEXT_PUBLIC_WORLD_ID=.*', 'NEXT_PUBLIC_WORLD_ID=!WORLD_ID!' | sc packages/web/.env.local" 2>nul || true

    echo ✓ .env updated with WORLD_ID=!WORLD_ID!
  )
) else (
  echo [4/5] ⏭️  Skipping seed (world already exists: !WORLD_ID!)
)

REM 5. Start development servers
echo.
echo [5/5] 🚀 Starting services...
echo.
echo   🌐 Web Observer:  http://localhost:!WEB_PORT!
echo   📡 API Server:    http://localhost:!API_PORT!
echo   🔌 WebSocket:     ws://localhost:!API_PORT!/ws
echo   🧬 LLM Provider:  !LLM_PROVIDER! ^(Model: !LLM_MODEL!^)
if "!OPTIMIZE_PROMPTS!"=="true" (
  echo   ⚡ Optimization:  ON ^(150-250 tokens/decision^)
) else (
  echo   ⚡ Optimization:  OFF ^(600-800 tokens/decision^)
)
echo.
echo   Press Ctrl+C to stop. Run 'kill.bat' to clean up.
echo.

REM Start all services
call npm run dev
