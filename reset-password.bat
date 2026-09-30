@echo off
rem Clears a player's password so they can choose a new one at their next login.
title Math Quest - Reset a password
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Math Quest needs Node.js. Download it from https://nodejs.org and run this again.
  pause
  exit /b 1
)
set /p PLAYER=Which player forgot their password? Type their name:
node server.js --reset-password "%PLAYER%"
pause
