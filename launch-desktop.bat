@echo off
cd /d "%~dp0"
if not exist "%~dp0release\Rook.exe" (
    echo Executable not found. Building first...
    call npm run build:standalone
    if %ERRORLEVEL% NEQ 0 (
        pause
        exit /b %ERRORLEVEL%
    )
)
start "" "%~dp0release\Rook.exe"
