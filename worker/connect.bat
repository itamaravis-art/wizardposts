@echo off
title WizardPosts Worker - Connect Facebook
cd /d "%~dp0"

if not exist ".env" (
  echo .env not found. Run install.bat first.
  pause
  exit /b 1
)

echo A Chromium window will open. Log in to Facebook normally,
echo then close the window. Cookies will be saved.
echo.

call npm run connect
pause
