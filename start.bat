@echo off
title Crypto Intraday Algo Bot & Dashboard Terminal
echo ====================================================================
echo           CRYPTO INTRADAY ALGO BOT & DASHBOARD TERMINAL
echo ====================================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in system PATH!
    echo Please install Node.js (v18 or higher) from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo [SYSTEM] Node.js found. Verifying dependencies...
call npm install
if %errorlevel% neq 0 (
    echo [WARNING] Dependency installation returned some warnings. Continuing...
)

echo.
echo [SYSTEM] Starting Local Web Server...
echo [SYSTEM] Automatic self-healing and recovery active...
echo [SYSTEM] Dashboard will open in your default browser at http://localhost:3000
echo.

start "" "http://localhost:3000"

call npm start

pause
