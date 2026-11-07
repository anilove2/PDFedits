@echo off
setlocal
cd /d "%~dp0"

rem Prefer Node on PATH, fall back to the runtime bundled with the harness.
where node >nul 2>nul
if errorlevel 1 (
  set "NODE=C:\Users\MUKESH\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
) else (
  set "NODE=node"
)

if /i not "%NODE%"=="node" if not exist "%NODE%" (
  echo.
  echo   Node.js was not found.
  echo   Install Node 18+ ^(https://nodejs.org^) and run this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo   PDFEdits
echo   ---------------------------------------------
echo   Landing   http://127.0.0.1:4321/
echo   Editor    http://127.0.0.1:4321/app/
echo.
echo   Keep this window open. Close it to stop.
echo.

if not "%PDFEDITS_NO_BROWSER%"=="1" (
  start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:4321/app/'"
)

"%NODE%" scripts\serve.js
pause

