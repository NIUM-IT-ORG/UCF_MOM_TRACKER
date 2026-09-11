<#
  MoM_Tracker — local setup for Windows, without Docker.

  Checks what is installed, prepares the database, installs dependencies,
  applies migrations, loads the demo data and proves the two database
  guarantees hold. Safe to run more than once: every step is skipped if it
  has already been done.

  Run it from INSTALL-AND-RUN.bat, or directly:
      powershell -ExecutionPolicy Bypass -File .\scripts\windows\install.ps1
#>

$ErrorActionPreference = 'Stop'

# ── small helpers ─────────────────────────────────────────────────────────
function Say  ($m) { Write-Host $m }
function Step ($m) { Write-Host ''; Write-Host "== $m" -ForegroundColor Cyan }
function Ok   ($m) { Write-Host "   OK  $m" -ForegroundColor Green }
function Warn ($m) { Write-Host "   !   $m" -ForegroundColor Yellow }
function Die  ($m) {
  Write-Host ''
  Write-Host "STOPPED: $m" -ForegroundColor Red
  Write-Host ''
  Write-Host 'Nothing was left half-done. Fix the above and run this again.'
  exit 1
}

function Have ($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

# Runs a command and stops on a non-zero exit code, so a failure is never
# mistaken for success three steps later.
function Run ($exe, $argLine, $workDir) {
  Say "   > $exe $argLine"
  $p = Start-Process -FilePath $exe -ArgumentList $argLine -WorkingDirectory $workDir `
                     -NoNewWindow -Wait -PassThru
  if ($p.ExitCode -ne 0) { Die "``$exe $argLine`` failed with exit code $($p.ExitCode)." }
}

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # repository root
if (-not (Test-Path (Join-Path $root 'package.json'))) {
  # Being run from the delivered folder rather than from inside the repository.
  $root = $PSScriptRoot
}

Write-Host ''
Write-Host '  MoM_Tracker — UCF Meeting & Action Item Tracker' -ForegroundColor White
Write-Host '  Local setup. No Docker required.'
Write-Host ''

# ── 1 · Node ──────────────────────────────────────────────────────────────
Step 'Node.js'
if (-not (Have 'node')) {
  Die "Node.js is not installed. Get the LTS installer from https://nodejs.org and run this again."
}
$nodeVersion = (& node --version).Trim()
$nodeMajor = [int](($nodeVersion -replace '^v', '') -split '\.')[0]
if ($nodeMajor -lt 20) {
  Die "Node $nodeVersion is too old. This needs Node 20 or newer — https://nodejs.org"
}
Ok "Node $nodeVersion"

# ── 2 · pnpm ──────────────────────────────────────────────────────────────
Step 'pnpm'
if (-not (Have 'pnpm')) {
  Warn 'pnpm not found — enabling it through Corepack, which ships with Node.'
  try {
    & corepack enable | Out-Null
    & corepack prepare pnpm@10 --activate | Out-Null
  } catch {
    Die "Could not enable pnpm. Run ``npm install -g pnpm`` in a new terminal, then try again."
  }
}
if (-not (Have 'pnpm')) {
  Die "pnpm still is not on PATH. Close this window, open a new one, and run again."
}
Ok "pnpm $((& pnpm --version).Trim())"

# ── 3 · PostgreSQL ────────────────────────────────────────────────────────
Step 'PostgreSQL'
$psql = $null
if (Have 'psql') {
  $psql = (Get-Command psql).Source
} else {
  # The Windows installer does not add itself to PATH. Look where it lands.
  $candidates = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
                Sort-Object Name -Descending
  foreach ($c in $candidates) {
    $try = Join-Path $c.FullName 'bin\psql.exe'
    if (Test-Path $try) { $psql = $try; break }
  }
}

if (-not $psql) {
  Write-Host ''
  Warn 'PostgreSQL is not installed, or is not where this script looked.'
  Write-Host ''
  Write-Host '   Install it from   https://www.postgresql.org/download/windows/'
  Write-Host '   During setup: keep port 5432, and note the postgres password.'
  if (Have 'winget') {
    Write-Host ''
    $answer = Read-Host '   Install PostgreSQL 16 now with winget? (y/N)'
    if ($answer -eq 'y' -or $answer -eq 'Y') {
      Run 'winget' 'install --id PostgreSQL.PostgreSQL.16 -e --accept-package-agreements --accept-source-agreements' $root
      Write-Host ''
      Die 'PostgreSQL installed. Close this window, open a new one, and run this script again so it picks up the new PATH.'
    }
  }
  Die 'Install PostgreSQL, then run this again.'
}
Ok "psql at $psql"

$pgBin = Split-Path -Parent $psql
$env:Path = "$pgBin;$env:Path"

# ── 4 · database and role ─────────────────────────────────────────────────
Step 'Database'
$dbName   = 'mom_tracker'
$appUser  = 'ucf'
$appPass  = 'ucf_dev_only'

Say '   The postgres superuser password is the one you set when installing PostgreSQL.'
$secure = Read-Host '   postgres password' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

$probe = & psql -U postgres -h localhost -p 5432 -d postgres -tAc 'SELECT 1' 2>&1
if ($LASTEXITCODE -ne 0) {
  Die "Could not connect to PostgreSQL as ``postgres``. It said: $probe"
}
Ok 'connected as postgres'

$roleExists = (& psql -U postgres -h localhost -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$appUser'").Trim()
if ($roleExists -ne '1') {
  & psql -U postgres -h localhost -d postgres -c "CREATE ROLE $appUser LOGIN PASSWORD '$appPass'" | Out-Null
  Ok "created role $appUser"
} else {
  Ok "role $appUser already exists"
}

$dbExists = (& psql -U postgres -h localhost -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$dbName'").Trim()
if ($dbExists -ne '1') {
  & psql -U postgres -h localhost -d postgres -c "CREATE DATABASE $dbName OWNER $appUser" | Out-Null
  Ok "created database $dbName"
} else {
  Ok "database $dbName already exists"
}
Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue

# ── 5 · .env ──────────────────────────────────────────────────────────────
Step 'Configuration'
$envPath = Join-Path $root '.env'
if (Test-Path $envPath) {
  Ok '.env already exists — leaving it exactly as it is'
} else {
  $example = Get-Content (Join-Path $root '.env.example') -Raw
  # Real random secrets, not the placeholders. Generated with Node so there is
  # no dependency on which .NET crypto APIs this machine has.
  $s1 = (& node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))").Trim()
  $s2 = (& node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))").Trim()
  $example = $example -replace 'replace_me_with_a_long_random_string', $s1
  $example = $example -replace 'replace_me_with_a_different_long_random_string', $s2
  Set-Content -Path $envPath -Value $example -Encoding UTF8
  Ok '.env written, with freshly generated secrets'
}

# ── 6 · dependencies ──────────────────────────────────────────────────────
Step 'Dependencies'
Say '   First run downloads a few hundred packages. Give it a minute or two.'
Run 'pnpm' 'install' $root
Run 'pnpm' '--filter @mom/shared build' $root
Ok 'installed'

# ── 7 · schema and data ───────────────────────────────────────────────────
Step 'Database schema and demo data'
Run 'pnpm' 'db:deploy' $root
Run 'pnpm' 'db:seed' $root
Ok 'migrated and seeded'

# ── 8 · prove it ──────────────────────────────────────────────────────────
Step 'Verification'
Run 'pnpm' 'assert:invariants' $root
Run 'pnpm' 'assert:seed' $root
Ok 'the database guarantees hold, and the data matches the prototype'

# ── done ──────────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '  Setup complete.' -ForegroundColor Green
Write-Host ''
Write-Host '  Start it with:   .\RUN.bat        (or: pnpm dev)'
Write-Host '  Web              http://localhost:3000'
Write-Host '  API              http://localhost:4000/api/v1/health'
Write-Host ''

$start = Read-Host '  Start it now? (Y/n)'
if ($start -ne 'n' -and $start -ne 'N') {
  & (Join-Path $PSScriptRoot 'run.ps1')
}
