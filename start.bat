@echo off
rem Starts the Math Quest server and opens the site in your web browser.
rem Keep this window open while playing. Close it (or press Ctrl+C) to stop.
title Math Quest
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Math Quest needs Node.js. Download it from https://nodejs.org and run this again.
  pause
  exit /b 1
)
node server.js --open
pause
