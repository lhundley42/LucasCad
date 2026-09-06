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

if (-not (Test-Path -LiteralPath $python)) { throw "Python environment not found. Create .venv and install backend/requirements.txt first." }

$api = Start-Process -FilePath $python -ArgumentList "-m", "uvicorn", "backend.server:app", "--host", "127.0.0.1", "--port", $apiPort, "--reload", "--reload-dir", "backend" -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
try {
    Start-Sleep -Milliseconds 900
    Write-Host "LucasCad: http://lucascad.localhost:$webPort/"
    & $pnpm exec vinext dev --host 127.0.0.1 --port $webPort
} finally {
    if (-not $api.HasExited) { Stop-Process -Id $api.Id }
}
