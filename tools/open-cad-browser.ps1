param(
    [string]$Url = 'http://lucascad.localhost:4310/',
    [int]$MaxAttempts = 120
)
$ErrorActionPreference = 'Stop'
for ($attempt = 0; $attempt -lt $MaxAttempts; $attempt++) {
    $ready = $false
    try {
        $page = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
        $ready = $page.StatusCode -eq 200 -and $page.Content -match 'LucasCad'
    } catch { } # Compilation/connection failures are normal during startup.
    if ($ready) {
        Start-Process -FilePath $Url
        return
    }
    Start-Sleep -Milliseconds 500
}
throw "LucasCad did not become ready. Review the launcher window, then open $Url manually."
