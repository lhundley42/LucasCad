$ErrorActionPreference = 'Stop'
$helper = Join-Path (Split-Path -Parent $PSScriptRoot) 'tools\open-cad-browser.ps1'
$state = @{ requests = 0; opened = @() }
function Invoke-WebRequest {
    param($Uri, [switch]$UseBasicParsing, $TimeoutSec)
    $state.requests++
    if ($state.requests -eq 1) { throw 'Not listening yet' }
    if ($state.requests -eq 2) { return @{StatusCode=200; Content='Unrelated application'} }
    return @{StatusCode=200; Content='<title>LucasCad</title>'}
}
function Start-Process { param($FilePath) $state.opened += $FilePath }
function Start-Sleep { param($Milliseconds) }
& $helper -MaxAttempts 3
if ($state.requests -ne 3 -or $state.opened.Count -ne 1 -or $state.opened[0] -ne 'http://lucascad.localhost:4310/') {
    throw 'Browser must open exactly once, only after LucasCad responds.'
}
$state.requests = 0
$state.opened = @()
$timedOut = $false
try { & $helper -MaxAttempts 2 } catch { $timedOut = $_.Exception.Message -match 'did not become ready' }
if (-not $timedOut -or $state.opened.Count -ne 0) { throw 'Failed startup must not open a browser.' }
Write-Output 'PASS: delayed startup, unrelated page, single browser launch, and timeout.'
