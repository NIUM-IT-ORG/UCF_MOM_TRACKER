@echo off
REM Starts the API and the web application together.
REM Double-click this file.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\run.ps1"
echo.
pause
