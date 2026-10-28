@echo off
setlocal
title Station Upload Tool

cd /d "%~dp0app"

echo Starting Station Upload Tool...
echo Microsoft Edge must be installed on this computer.
echo Keep this window open until processing finishes.
echo.

"%~dp0node\node.exe" server.js

echo.
echo Station Upload Tool stopped.
pause
endlocal