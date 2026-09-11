@echo off
REM Sets up MoM_Tracker on this machine, then offers to start it.
REM Double-click this file.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\install.ps1"
echo.
pause
