# Starts the API on :4000 and the web application on :3000, together.
#
# Both run in this one window. Ctrl+C stops both.
# If setup has not been done yet, run scripts\windows\install.ps1 first.
#
# Keep this file ASCII-only and saved as UTF-8 with a BOM - see the note at
# the top of install.ps1 for why.

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $root 'package.json'))) {
    $root = $PSScriptRoot
}

if (-not (Test-Path (Join-Path $root '.env'))) {
    Write-Host ''
    Write-Host 'No .env found. Run SETUP.bat first.' -ForegroundColor Red
    exit 1
}
if (-not (Test-Path (Join-Path $root 'node_modules'))) {
    Write-Host ''
    Write-Host 'Dependencies are not installed. Run SETUP.bat first.' -ForegroundColor Red
    exit 1
}

# PostgreSQL's bin folder is not on PATH by default on Windows. The app does
# not need psql, but the pnpm db:* scripts do, so make it available anyway.
if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
    $pg = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
          Sort-Object Name -Descending | Select-Object -First 1
    if ($pg) {
        $env:Path = $pg.FullName + '\bin;' + $env:Path
    }
}

Write-Host ''
Write-Host '  Starting MoM_Tracker' -ForegroundColor White
Write-Host '  Web  http://localhost:3000'
Write-Host '  API  http://localhost:4000/api/v1/health'
Write-Host '  Ctrl+C stops both.'
Write-Host ''

# Open the browser once the web server has had a moment to come up. Fire and
# forget, so it cannot hold up or interfere with the servers themselves.
Start-Job -ScriptBlock {
    Start-Sleep -Seconds 12
    Start-Process 'http://localhost:3000'
} | Out-Null

Set-Location $root
& pnpm dev
