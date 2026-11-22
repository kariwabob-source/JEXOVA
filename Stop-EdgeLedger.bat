@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Stop-JEXOVA.ps1"
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
    echo.
    echo JEXOVA shutdown reported a problem. Review the message above.
    pause
)
exit /b %EXIT_CODE%
