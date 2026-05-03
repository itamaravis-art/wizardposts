@echo off
setlocal enableextensions enabledelayedexpansion
title WizardPosts Worker - Installer

echo ============================================
echo   WizardPosts Worker - One-click installer
echo ============================================
echo.

cd /d "%~dp0"

REM --- 1. Check Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not on PATH.
  echo Download and install Node 20+ from https://nodejs.org/ then re-run this script.
  pause
  exit /b 1
)

REM --- 2. Prompt for token if .env is missing ---
if not exist ".env" (
  echo No .env file found, let's create one.
  echo.
  set /p WT=Paste your WORKER_TOKEN (starts with wt_):
  if not defined WT (
    echo [ERROR] No token entered.
    pause
    exit /b 1
  )

  set /p AB=API_BASE_URL [press Enter for https://app.wizardposts.com]:
  if not defined AB set AB=https://app.wizardposts.com

  > .env echo WORKER_TOKEN=!WT!
  >> .env echo API_BASE_URL=!AB!
  >> .env echo BROWSER_HEADLESS=false
  >> .env echo BROWSER_LOCALE=he-IL
  >> .env echo BROWSER_TIMEZONE=Asia/Jerusalem
  >> .env echo LOG_LEVEL=info
  echo .env created.
) else (
  echo .env already exists, skipping.
)

echo.
echo Installing npm dependencies...
call npm install
if errorlevel 1 (
  echo [ERROR] npm install failed.
  pause
  exit /b 1
)

echo.
echo Installing Playwright Chromium browser...
call npx playwright install chromium
if errorlevel 1 (
  echo [ERROR] Playwright install failed.
  pause
  exit /b 1
)

echo.
echo ============================================
echo   Install complete.
echo ============================================
echo.
echo Next steps:
echo   1. Run connect.bat to log in to Facebook (one-time, saves cookies).
echo   2. Run start.bat to start the worker.
echo.
pause
endlocal
