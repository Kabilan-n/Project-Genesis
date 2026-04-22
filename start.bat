@echo off
REM Project Genesis Startup
REM Use: .\start.bat OR powershell -NoProfile -ExecutionPolicy Bypass -File start.ps1

if exist "start.ps1" (
  echo Delegating to PowerShell version for better compatibility...
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -File start.ps1
) else (
  echo Error: start.ps1 not found
  exit /b 1
)
