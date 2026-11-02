@echo off
cd /d "%~dp0"
echo Building and launching Rook Desktop...
call npm run build:standalone
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Build failed with error code %ERRORLEVEL%.
    pause
    exit /b %ERRORLEVEL%
)
start "" "%~dp0release\Rook.exe"
