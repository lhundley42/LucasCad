@echo off
setlocal

cd /d "%~dp0"
title LucasCad

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-cad.ps1"
set "LUCASCAD_EXIT=%ERRORLEVEL%"

if not "%LUCASCAD_EXIT%"=="0" (
    echo.
    echo LucasCad could not start. Review the error above.
    echo.
    pause
)

exit /b %LUCASCAD_EXIT%
