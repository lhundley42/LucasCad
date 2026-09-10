$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $projectRoot ".venv\Scripts\python.exe"
# Prefer ordinary user-installed tools; retain a portable local Codex fallback.
$pnpmCommand = Get-Command pnpm.cmd,pnpm -ErrorAction SilentlyContinue | Select-Object -First 1
$pnpm = if ($pnpmCommand) { $pnpmCommand.Source } else { $null }
$runtime = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.cache\codex-runtimes\codex-primary-runtime\dependencies'
$nodeBin = Join-Path $runtime 'node\bin'
if (-not (Get-Command node -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath $nodeBin)) { $env:Path = "$nodeBin;$env:Path" }
if (-not $pnpm) {
    $fallback = Join-Path $runtime 'bin\fallback\pnpm.cmd'
    if (Test-Path -LiteralPath $fallback) { $pnpm = $fallback }
}
if (-not $pnpm -or -not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Install Node.js 22.13+ and pnpm, then reopen this launcher." }
$webPort = 4310
$apiPort = 4311
$webUrl = "http://lucascad.localhost:$webPort/"

# Double-clicking again should reopen the existing application, not launch
# competing servers or close a backend owned by another launcher.
$alreadyRunning = $false
try {
    $page = Invoke-WebRequest -Uri $webUrl -UseBasicParsing -TimeoutSec 2
    $health = Invoke-WebRequest -Uri "http://127.0.0.1:$apiPort/api/health" -UseBasicParsing -TimeoutSec 2
    $alreadyRunning = $page.StatusCode -eq 200 -and $page.Content -match 'LucasCad' -and $health.StatusCode -eq 200
} catch { }
if ($alreadyRunning) {
    Start-Process -FilePath $webUrl
    return
}

if (-not (Test-Path -LiteralPath $python)) { throw "Python environment not found. Create .venv and install backend/requirements.txt first." }

$api = Start-Process -FilePath $python -ArgumentList "-m", "uvicorn", "backend.server:app", "--host", "127.0.0.1", "--port", $apiPort, "--reload", "--reload-dir", "backend" -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
$browserJob = $null
$webExitCode = 1
try {
    $browserJob = Start-Job -FilePath (Join-Path $projectRoot 'tools\open-cad-browser.ps1') -ArgumentList $webUrl
    Write-Host "LucasCad: $webUrl (your browser will open when ready)"
    & $pnpm exec vinext dev --host 127.0.0.1 --port $webPort
    $webExitCode = $LASTEXITCODE
} finally {
    if ($browserJob) {
        Stop-Job -Job $browserJob
        Receive-Job -Job $browserJob -ErrorAction Continue
        Remove-Job -Job $browserJob
    }
    if (-not $api.HasExited) { Stop-Process -Id $api.Id }
}
exit $webExitCode
