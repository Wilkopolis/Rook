@echo off
cd /d "%~dp0"

echo Closing any running Rook instances...
taskkill /IM Rook.exe /F >nul 2>&1
set /a ROOK_WAIT=0
:wait_for_exit
tasklist /FI "IMAGENAME eq Rook.exe" /NH 2>nul | find /I "Rook.exe" >nul
if %ERRORLEVEL% EQU 0 (
    if %ROOK_WAIT% GEQ 10 (
        echo Rook.exe is still running after 10 seconds; build may fail due to locked files.
        goto build
    )
    set /a ROOK_WAIT+=1
    ping -n 2 127.0.0.1 >nul
    goto wait_for_exit
)

:build
echo Building and launching Rook Desktop...
call npm run build:standalone
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Build failed with error code %ERRORLEVEL%.
    pause
    exit /b %ERRORLEVEL%
)
start "" "%~dp0release\Rook.exe"
