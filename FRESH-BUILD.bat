@echo off
REM ====================================================================
REM  MoM_Tracker - fresh build.
REM
REM  This replaces every source file in the app with the current version,
REM  then installs, migrates and builds. Nothing to unzip by hand: the
REM  archive is unpacked straight into the app folder by this script.
REM
REM  What it KEEPS:
REM    .env              your settings
REM    var\pgdata        your database - every meeting, minute and action
REM    node_modules      so the install is quick
REM
REM  What it REPLACES: all the code.
REM
REM  It sits BESIDE the app folder:
REM      Desktop\MoM_Tracker\FRESH-BUILD.bat   <- this
REM      Desktop\MoM_Tracker\app\              <- the application
REM
REM  Double-click it. Do not run it as Administrator.
REM ====================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "SRC=MoM_Tracker-Source.zip"

echo.
echo   MoM_Tracker - fresh build
echo.

REM ---- where things are ------------------------------------------------
set "APP="
if exist "app\.env" set "APP=app"
if not defined APP if exist ".env" if exist "SETUP.bat" set "APP=."

if not defined APP (
  echo   STOPPED: cannot find the application.
  echo.
  echo   This file has to sit beside the app folder - the one containing
  echo   .env, SETUP.bat and RUN.bat. Usually:
  echo       Desktop\MoM_Tracker\app
  echo.
  echo   If the app has never been set up on this machine, run SETUP.bat
  echo   inside the app folder instead.
  goto :fail
)

if not exist "%SRC%" (
  echo   STOPPED: cannot find %SRC% beside this file.
  echo.
  echo   It should be in the same folder as FRESH-BUILD.bat. Do not unzip
  echo   it - this script unpacks it for you.
  goto :fail
)
echo   Application  %CD%\!APP!
echo   Source       %CD%\%SRC%

REM ---- nothing may be running ------------------------------------------
REM A running MoM_Tracker holds Prisma's query engine DLL open and Windows
REM will not let it be replaced. Catch it before anything is unpacked.
echo.
echo == Checking nothing is running
netstat -ano | findstr /r /c:"LISTENING" | findstr /r /c:":3000 " /c:":4000 " >nul 2>&1
if not errorlevel 1 (
  echo.
  echo   STOPPED: MoM_Tracker is still running - something is listening on
  echo   port 3000 or 4000.
  echo.
  echo   Go to the RUN.bat window, press Ctrl+C, close it, and run this again.
  goto :fail
)
echo    OK  nothing on 3000 or 4000

REM ---- not as Administrator, if the bundled database is in use ---------
if exist "!APP!\var\pgdata" (
  set "ELEVATED="
  whoami /groups 2>nul | findstr /c:"S-1-16-12288" >nul 2>&1 && set "ELEVATED=1"
  if defined ELEVATED (
    echo.
    echo   STOPPED: this window is running as Administrator.
    echo   The project-local PostgreSQL refuses to start under an
    echo   administrator account, and nothing here needs those rights.
    echo.
    echo   Close this window and start FRESH-BUILD.bat with an ordinary
    echo   double-click.
    goto :fail
  )
)

REM ---- back the database up before anything else -----------------------
if exist "!APP!\var\pgdata" call :backup
if errorlevel 1 goto :fail

REM ---- unpack ----------------------------------------------------------
echo.
echo == Unpacking the source into !APP!
REM tar.exe ships with Windows 10 1803 and later and reads zip files. It is
REM used rather than asking for a manual "Extract All", because extracting a
REM zip by hand puts it in a subfolder named after the zip - which is exactly
REM how the last two attempts went wrong.
where tar >nul 2>&1
if errorlevel 1 goto :notar
tar -xf "%SRC%" -C "!APP!"
if errorlevel 1 (
  echo.
  echo   STOPPED: could not unpack the archive. Nothing else was changed.
  echo   The usual cause is a file still open in an editor.
  goto :fail
)
goto :unpacked

:notar
echo    tar is not available on this Windows build - using PowerShell instead.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%SRC%' -DestinationPath '!APP!' -Force"
if errorlevel 1 (
  echo.
  echo   STOPPED: could not unpack the archive. Nothing else was changed.
  goto :fail
)

:unpacked
echo    OK  unpacked

REM ---- from here on, work inside the app ------------------------------
pushd "!APP!"

REM pnpm: a real install if there is one, npx if not. Same as SETUP.bat.
set "PM="
where pnpm >nul 2>&1
if not errorlevel 1 set "PM=pnpm"
if not defined PM set "PM=npx --yes pnpm@10"

REM PostgreSQL's bin folder is not on PATH by default; the db:* scripts need psql.
where psql >nul 2>&1
if errorlevel 1 (
  for /f "delims=" %%d in ('dir /b /ad /o-n "C:\Program Files\PostgreSQL" 2^>nul') do (
    if exist "C:\Program Files\PostgreSQL\%%d\bin\psql.exe" (
      set "PATH=C:\Program Files\PostgreSQL\%%d\bin;!PATH!"
      goto :gotpsql
    )
  )
)
:gotpsql

echo.
echo == Dependencies
echo    This build adds a package, so give it a minute or two.
call %PM% install
if errorlevel 1 goto :popfail
call %PM% --filter @mom/shared build
if errorlevel 1 goto :popfail
echo    OK  installed

echo.
echo == Database
REM Migrations only. NOT the seed - the seed empties every table, and by now
REM these tables hold real meetings.
if exist "var\pgdata" (
  call %PM% db:local:run
  if errorlevel 1 goto :migfail
  goto :migrated
)
call %PM% db:deploy
if errorlevel 1 (
  echo.
  echo    Prisma could not apply the migrations - usually its engine download
  echo    being blocked. The migrations are plain SQL, so applying them
  echo    directly instead.
  call %PM% db:apply
  if errorlevel 1 goto :migfail
)
call %PM% assert:schema
if errorlevel 1 goto :migfail

:migrated
echo    OK  migrated, and the schema matches the database

echo.
echo == Building
call %PM% build
if errorlevel 1 goto :popfail
echo    OK  built

popd

echo.
echo   ================================================================
echo    Fresh build in place.
echo.
echo    New in this one:
echo      - The MoM masthead carries the Telangana emblem and the CDMA
echo        roundel, either side of the wording.
echo      - Project Director is now called Project Coordinator, and it is
echo        the designation that approves the MoM.
echo      - Approving asks WHICH officer signs - Additional Mission
echo        Director or Mission Director - and only that officer can.
echo      - Signing happens in the system. The document prints a green
echo        tick with the officer's name, designation and time in IST.
echo      - Documents attach from the Minutes editor and are listed on
echo        the MoM as annexures.
echo      - New dashboard, and a roomier form for adding actions.
echo.
echo    NOTE: a MoM sitting at "Submitted" now waits for the Project
echo    Coordinator instead of the Mission Director. Nothing is stuck -
echo    it is with a different officer, which is the point.
echo.
echo    Web   http://localhost:3000
echo    If anything misbehaves, run DOCTOR.bat inside the app folder.
echo   ================================================================
echo.
set /p "STARTNOW=  Start it now? (Y/n): "
if /i "!STARTNOW!"=="n" goto :done
call "!APP!\RUN.bat"
goto :done

:migfail
popd
echo.
echo   STOPPED: the database migration failed.
echo.
if exist "!APP!\var\backups" (
  echo   Your database was copied before this ran, so nothing is lost. To go
  echo   back: close everything, delete !APP!\var\pgdata, and rename the
  echo   newest !APP!\var\backups\pgdata-... folder to pgdata.
  echo.
)
echo   Run DOCTOR.bat inside the app folder and send on what it prints.
goto :fail

:popfail
popd
goto :fail

:fail
echo.
pause
exit /b 1

:done
echo.
pause
exit /b 0

REM --------------------------------------------------------------------
REM  Copies the bundled database folder before anything touches it.
REM  A subroutine rather than a block: it needs a `for /f`, and brackets
REM  inside a parenthesised if-block break cmd's parser.
REM --------------------------------------------------------------------
:backup
echo.
echo == Backing up the database first
REM No arrow function and no slashes: an escaped ^> does NOT survive a
REM `for /f` command string - cmd passes the caret through and Node then
REM reports a syntax error. Positional arithmetic gives the zero padding.
for /f "delims=" %%t in ('node -e "var d=new Date();console.log(d.getFullYear()*10000000000+(d.getMonth()+1)*100000000+d.getDate()*1000000+d.getHours()*10000+d.getMinutes()*100+d.getSeconds())"') do set "STAMP=%%t"
if not defined STAMP set "STAMP=manual"
if not exist "!APP!\var\backups" mkdir "!APP!\var\backups" >nul 2>&1
where robocopy >nul 2>&1
if errorlevel 1 (
  echo   Cannot find robocopy, which ships with Windows. Copy the
  echo   !APP!\var\pgdata folder somewhere safe yourself, then run this again.
  exit /b 1
)
echo    Copying var\pgdata to var\backups\pgdata-%STAMP%
robocopy "!APP!\var\pgdata" "!APP!\var\backups\pgdata-%STAMP%" /E /NFL /NDL /NJH /NJS /NC /NS >nul
REM robocopy is not like other commands: 0-7 are degrees of success, 8 and
REM above are failures. `if errorlevel 1` would fail every successful copy.
if errorlevel 8 (
  echo.
  echo   The backup copy failed, so nothing was changed.
  exit /b 1
)
echo    OK  backed up to var\backups\pgdata-%STAMP%
exit /b 0
