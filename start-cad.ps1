# The .bat uses a process-local policy bypass; no system policy changes.
[CmdletBinding()]
param([switch]$SetupOnly, [switch]$NoOpen, [switch]$Dev)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$candidates = @()
if ($env:LUCASCAD_PYTHON) { $candidates += $env:LUCASCAD_PYTHON }
else {
    $candidates += (Join-Path $projectRoot '.venv\Scripts\python.exe')
    if (Get-Command py -ErrorAction SilentlyContinue) {
        $previous = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            foreach ($version in @('3.13','3.12','3.11','3.14')) {
                $found = & py "-$version" -c 'import sys; print(sys.executable)' 2>$null
                if ($LASTEXITCODE -eq 0) { $candidates += $found }
            }
        } finally { $ErrorActionPreference = $previous }
    }
    foreach ($name in @('python3','python')) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($command -and $command.Source -notlike '*\WindowsApps\*') { $candidates += $command.Source }
    }
    $candidates += (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe')
}
foreach ($candidate in $candidates) {
    if (-not (Test-Path -LiteralPath $candidate)) { continue }
    & $candidate -c 'import sys; sys.exit(0 if (3,11) <= sys.version_info < (3,15) else 1)'
    if ($LASTEXITCODE -ne 0) { continue }
    $launcherArgs = @((Join-Path $projectRoot 'tools\launch_cad.py'))
    if ($SetupOnly) { $launcherArgs += '--setup-only' }
    if ($NoOpen) { $launcherArgs += '--no-open' }
    if ($Dev) { $launcherArgs += '--dev' }
    & $candidate @launcherArgs
    exit $LASTEXITCODE
}
throw 'Install Python 3.11-3.14 from python.org (or winget install Python.Python.3.12), then run Start LucasCad.bat again. LUCASCAD_PYTHON may specify a full interpreter path.'
