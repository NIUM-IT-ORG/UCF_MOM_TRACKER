@echo off
REM ====================================================================
REM  MoM_Tracker - apply an update, on Windows. No Docker, no PowerShell.
REM
REM  Run this after unzipping a patch over the app folder. It installs any
REM  new dependencies, applies any new database migrations, rebuilds, and
REM  checks that the schema on disk matches the database.
REM
REM  It does NOT seed. Your recorded meetings, minutes and actions are left
REM  alone - seeding would empty them. SETUP.bat is for a fresh machine;
REM  this is for a machine that is already working.
REM
REM  Safe to run again. Every step is skipped if it is already done.
REM ====================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo   MoM_Tracker - applying an update
echo.

REM Two different situations end up here, and they need opposite answers.
REM Getting this wrong is dangerous: Windows extracts a zip into a subfolder
REM named after it, so running this from the extracted patch is the likely
REM mistake - and "run SETUP.bat instead" would then seed, which truncates
REM every table. The app folder has SETUP.bat in it; the patch folder does not.
if not exist ".env" (
  if not exist "SETUP.bat" goto :wrongfolder
  echo   STOPPED: no .env found, so this machine has never been set up.
  echo   Run SETUP.bat instead - it does everything this does, and more.
  goto :fail
)
if not exist "package.json" goto :wrongfolder
if not exist "SETUP.bat" goto :wrongfolder

REM ---- 1 - nothing may be running ------------------------------------
REM A running MoM_Tracker holds Prisma's query engine DLL open, and Windows
REM will not let it be replaced. The install then fails with EPERM and the
REM message says nothing about the real cause.
echo == Checking nothing is running
netstat -ano | findstr /r /c:"LISTENING" | findstr /r /c:":3000 " /c:":4000 " >nul 2>&1
if not errorlevel 1 (
  echo.
  echo   STOPPED: MoM_Tracker is still running - something is listening on
  echo   port 3000 or 4000.
  echo.
  echo   Go to the RUN.bat window, press Ctrl+C, close it, and run this again.
  echo   Windows will not let Prisma replace its engine file while the
  echo   application has it open.
  goto :fail
)
echo    OK  nothing on 3000 or 4000

REM ---- 2 - not as Administrator, if the bundled database is in use ----
if exist "var\pgdata" (
  set "ELEVATED="
  whoami /groups 2>nul | findstr /c:"S-1-16-12288" >nul 2>&1 && set "ELEVATED=1"
  if defined ELEVATED (
    echo.
    echo   STOPPED: this window is running as Administrator.
    echo.
    echo   The project-local PostgreSQL refuses to start under an
    echo   administrator account, and nothing here needs those rights.
    echo.
    echo   Close this window and start UPDATE.bat with an ordinary
    echo   double-click.
    goto :fail
  )
)

REM ---- 3 - pnpm ------------------------------------------------------
REM Same resolution as SETUP.bat: a real install if there is one, npx if not.
set "PM="
where pnpm >nul 2>&1
if not errorlevel 1 set "PM=pnpm"
if not defined PM set "PM=npx --yes pnpm@10"

REM PostgreSQL's bin folder is not on PATH by default, and the db:* scripts
REM need psql.
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

REM ---- 4 - a backup, before touching the database --------------------
REM This update changes the database. Taking a copy first costs seconds and
REM is the difference between a bad afternoon and a lost month. The bundled
REM PostgreSQL keeps everything under var\pgdata, so a folder copy is a
REM complete backup of it.
REM The backup is a subroutine rather than a block, on purpose: it needs a
REM `for /f` running a node one-liner, and unescaped brackets inside a
REM parenthesised if-block break cmd's parser in ways that are miserable to
REM debug.
if exist "var\pgdata" (
  call :backup
  if errorlevel 1 goto :fail
) else (
  echo.
  echo == Database backup
  echo    This machine uses an installed PostgreSQL, so take your own copy
  echo    if you want one:
  echo        pg_dump -U ucf -h localhost mom_tracker -Fc -f mom_backup.dump
  echo    The update below only adds columns; it removes nothing.
)

REM ---- 5 - dependencies ----------------------------------------------
echo.
echo == Dependencies
echo    An update may bring new packages. This can take a minute.
call %PM% install
if errorlevel 1 goto :fail
call %PM% --filter @mom/shared build
if errorlevel 1 goto :fail
echo    OK  installed

REM ---- 6 - database migrations ---------------------------------------
REM `db:deploy` only applies what is pending and never resets. If Prisma's
REM engine download is blocked by a proxy - which it often is here - the
REM migrations are plain SQL and db:apply runs them directly instead.
echo.
echo == Database migrations
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
  echo.
  call %PM% db:apply
  if errorlevel 1 goto :migfail
)
call %PM% assert:schema
if errorlevel 1 goto :migfail

:migrated
echo    OK  migrated, and the schema matches the database

REM ---- 7 - build -----------------------------------------------------
echo.
echo == Building
call %PM% build
if errorlevel 1 goto :fail
echo    OK  built

echo.
echo   ================================================================
echo    Update applied.
echo.
echo    What changed in this one:
echo      - The MoM masthead carries the Telangana emblem and the CDMA
echo        roundel, either side of the wording.
echo      - Project Director is now called Project Coordinator, and it is
echo        the designation that approves the MoM.
echo      - Approving now asks WHICH officer signs - the Additional Mission
echo        Director or the Mission Director - and only that officer can.
echo      - Signing happens in the system. The document prints a green tick
echo        with the officer's name, designation and the time in IST.
echo      - Documents can be attached from the Minutes editor and are listed
echo        on the MoM as annexures.
echo      - New dashboard, and a roomier form for adding actions.
echo.
echo    NOTE: a MoM sitting at "Submitted" now waits for the Project
echo    Coordinator instead of the Mission Director. Nothing is stuck - it
echo    is with a different officer, which is the point of the change.
echo.
echo    Start it with:  RUN.bat
echo    Web             http://localhost:3000
echo.
echo    If anything misbehaves, run DOCTOR.bat and send on what it prints.
echo   ================================================================
echo.
set /p "STARTNOW=  Start it now? (Y/n): "
if /i "!STARTNOW!"=="n" goto :done
call "%~dp0RUN.bat"
goto :done

:migfail
echo.
echo   STOPPED: the database migration failed.
echo.
if exist "var\backups" (
  echo   Your database was copied to var\backups before this ran, so nothing
  echo   is lost. To go back: close everything, delete var\pgdata, and rename
  echo   the newest var\backups\pgdata-... folder to var\pgdata.
  echo.
)
echo   Run DOCTOR.bat and send on what it prints - it names the cause.
goto :fail

:wrongfolder
echo   STOPPED: this is not the app folder.
echo.
echo   Windows extracts a zip into a folder named after it, so UPDATE.bat is
echo   most likely sitting in the extracted patch rather than in the app.
echo.
echo   The app folder is the one containing SETUP.bat, RUN.bat and .env -
echo   usually  Desktop\MoM_Tracker\app
echo.
echo   Copy everything from this folder into the app folder, replacing what
echo   is there, then run UPDATE.bat from the app folder.
echo.
echo   APPLY-UPDATE.bat does both steps for you if you have it.
echo.
echo   Do NOT run SETUP.bat to get past this - it seeds the database, which
echo   would empty the meetings you have recorded.
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
REM
REM  The bundled PostgreSQL keeps everything under var\pgdata, so a folder
REM  copy is a complete backup of it. It costs seconds, and it is the
REM  difference between a bad afternoon and a lost month.
REM --------------------------------------------------------------------
:backup
echo.
echo == Backing up the database first
REM Not wmic, which recent Windows 11 builds no longer ship, and not %DATE%,
REM which is locale-dependent. Node is a hard requirement here and is present.
REM No arrow function, and no slashes. An escaped `^>` does NOT survive a
REM `for /f` command string - cmd passes the caret straight through, and
REM Node then sees `d=^>` and reports a syntax error. `var` plus semicolons
REM arrives intact. Positional arithmetic gives the zero padding for free.
for /f "delims=" %%t in ('node -e "var d=new Date();console.log(d.getFullYear()*10000000000+(d.getMonth()+1)*100000000+d.getDate()*1000000+d.getHours()*10000+d.getMinutes()*100+d.getSeconds())"') do set "STAMP=%%t"
if not defined STAMP set "STAMP=manual"
if not exist "var\backups" mkdir "var\backups" >nul 2>&1
where robocopy >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Cannot find robocopy, which ships with Windows. Copy the var\pgdata
  echo   folder somewhere safe yourself, then run this again.
  exit /b 1
)
echo    Copying var\pgdata to var\backups\pgdata-%STAMP%
robocopy "var\pgdata" "var\backups\pgdata-%STAMP%" /E /NFL /NDL /NJH /NJS /NC /NS >nul
REM robocopy is not like other commands: 0-7 are degrees of success, 8 and
REM above are failures. `if errorlevel 8` is the correct test, not `if
REM errorlevel 1`.
if errorlevel 8 (
  echo.
  echo   The backup copy failed, so nothing was changed.
  exit /b 1
)
echo    OK  backed up to var\backups\pgdata-%STAMP%
exit /b 0
