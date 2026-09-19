@echo off
REM ====================================================================
REM  MoM_Tracker - clear a stale database lock, then start.
REM
REM  Symptom this fixes: the app loads but every screen says
REM  "Request failed (500)."
REM
REM  That message is the one the web app shows when it cannot reach the
REM  API *at all* - the API returns a proper explanation for its own
REM  errors, so a bare 500 means the process is not there. The usual
REM  reason on this setup is the bundled PostgreSQL: it writes a lock
REM  file, var\pgdata\postmaster.pid, and deletes it on a clean shutdown.
REM  If it was stopped any other way the file is left behind, PostgreSQL
REM  then refuses to start, the API cannot connect, and it exits.
REM
REM  This checks whether PostgreSQL is genuinely running before touching
REM  anything - deleting that file while the server IS running is how a
REM  database gets corrupted, so it is never done blind.
REM
REM  Double-click it. Do not run it as Administrator.
REM ====================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "APP="
if exist "app\.env" set "APP=app"
if not defined APP if exist ".env" if exist "SETUP.bat" set "APP=."
if not defined APP (
  echo.
  echo   STOPPED: cannot find the application. This file has to sit either
  echo   beside the app folder or inside it.
  goto :fail
)

echo.
echo   MoM_Tracker - checking the database
echo.

set "PGDATA=!APP!\var\pgdata"
if not exist "!PGDATA!" (
  echo   This machine uses an installed PostgreSQL, not the bundled one, so
  echo   there is no lock file to clear. Check that the PostgreSQL service is
  echo   running, then run DOCTOR.bat inside the app folder.
  goto :fail
)

REM ---- is anything actually listening on the database port? ------------
REM 5433, not 5432: the bundled PostgreSQL uses 5433 so it can never collide
REM with an installed one.
set "PGUP="
netstat -ano | findstr /r /c:"LISTENING" | findstr /c:":5433 " >nul 2>&1
if not errorlevel 1 set "PGUP=1"

set "APPUP="
netstat -ano | findstr /r /c:"LISTENING" | findstr /r /c:":3000 " /c:":4000 " >nul 2>&1
if not errorlevel 1 set "APPUP=1"

if defined APPUP (
  echo   STOPPED: MoM_Tracker is still running - something is listening on
  echo   port 3000 or 4000.
  echo.
  echo   Go to the RUN.bat window, press Ctrl+C, wait for it to close, and
  echo   run this again. Nothing was changed.
  goto :fail
)

if defined PGUP (
  echo   PostgreSQL is still running on port 5433, left over from an earlier
  echo   step. Its lock file is genuine, so it must NOT be deleted.
  echo.
  echo   Close any other MoM_Tracker windows. If there are none, open Task
  echo   Manager, find postgres.exe, and end it - then run this again.
  echo.
  echo   Nothing was changed.
  goto :fail
)

REM ---- nothing is listening, so any lock file is stale -----------------
if not exist "!PGDATA!\postmaster.pid" (
  echo   No stale lock file - the database is clean.
  echo.
  echo   So the 500 is something else. Start the app with RUN.bat, let it
  echo   fail, and send on what the RUN.bat window prints - the first red
  echo   lines are the ones that matter. DOCTOR.bat inside the app folder
  echo   will also name the cause.
  goto :fail
)

echo   Found a stale lock file, and nothing is listening on 5433.
echo   That combination means PostgreSQL is not running and the file is
echo   left over. Removing it.
del /f /q "!PGDATA!\postmaster.pid"
if exist "!PGDATA!\postmaster.pid" (
  echo.
  echo   STOPPED: could not delete !PGDATA!\postmaster.pid
  echo   Something still has it open. Close every MoM_Tracker window and
  echo   try again.
  goto :fail
)
echo   OK  removed
if exist "!PGDATA!\postmaster.opts" del /f /q "!PGDATA!\postmaster.opts" >nul 2>&1

echo.
echo   ================================================================
echo    The lock is cleared. Starting MoM_Tracker.
echo.
echo    If it still says "Request failed (500)", leave the window open and
echo    send me what it prints - that output names the real cause.
echo   ================================================================
echo.
call "!APP!\RUN.bat"
goto :done

:fail
echo.
pause
exit /b 1

:done
echo.
pause
exit /b 0
