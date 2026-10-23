@echo off
title CHATURANGA - AI Electronic Chessboard Launcher
echo =======================================================
echo         CHĀTURANGA AI Electronic Chessboard
echo =======================================================
echo [1/3] Starting Backend API (Flask + Stockfish Engine)...
start "CHATURANGA Backend (Port 5000)" cmd /k "cd /d \"%~dp0\" && python backend/run.py"

echo [2/3] Starting Frontend Simulator (HTTP Server)...
start "CHATURANGA Simulator (Port 3000)" cmd /k "cd /d \"%~dp0\" && npm start"

echo [3/3] Launching web simulator in your browser...
timeout /t 2 /nobreak >nul
start http://localhost:3000

echo.
echo =======================================================
echo Both servers are running!
echo Frontend: http://localhost:3000
echo Backend:  http://localhost:5000
echo =======================================================
