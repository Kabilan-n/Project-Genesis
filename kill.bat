@echo off
REM Stop all Genesis processes and services

echo.
echo 🛑 Stopping Project Genesis...
echo.

REM Kill Node processes on ports
echo   Killing Node processes on ports 3000 and 3001...
npx kill-port 3000 3001 2>nul || true

REM Kill all Node processes
echo   Killing all Node processes...
taskkill /F /IM node.exe 2>nul || true

REM Stop Docker containers
echo   Stopping Docker containers...
docker compose down 2>nul || true

timeout /t 2 /nobreak

echo.
echo ✓ Project Genesis stopped
echo.
