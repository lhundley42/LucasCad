$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $projectRoot ".venv\Scripts\python.exe"
$pnpm = "C:\Users\PRC X-FORCE S.E. PC\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd"
$nodeBin = "C:\Users\PRC X-FORCE S.E. PC\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
$webPort = 4310
$apiPort = 4311

if (-not (Test-Path -LiteralPath $python)) { throw "Python environment not found. Create .venv and install backend/requirements.txt first." }
$env:Path = "$nodeBin;$env:Path"

$api = Start-Process -FilePath $python -ArgumentList "-m", "uvicorn", "backend.server:app", "--host", "127.0.0.1", "--port", $apiPort, "--reload", "--reload-dir", "backend" -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
try {
    Start-Sleep -Milliseconds 900
    Write-Host "LucasCad: http://lucascad.localhost:$webPort/"
    & $pnpm exec vinext dev --host 127.0.0.1 --port $webPort
} finally {
    if (-not $api.HasExited) { Stop-Process -Id $api.Id }
}
