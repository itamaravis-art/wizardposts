@echo off
title WizardPosts Worker
cd /d "%~dp0"

if not exist ".env" (
  echo .env not found. Run install.bat first.
  pause
  exit /b 1
)

call npm start
pause
