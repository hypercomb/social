@echo off
REM Reconfigure the hypercomb-relay Windows service to the SLIM storage-host
REM profile (port 7777, content + mesh + swarm-temp, NO installer SPA).
REM
REM Under the full-split trust model: installer code is canonical (served
REM ONLY by diamondcoreprocessor.com), and the operator's host serves
REM STORAGE + MESH only. A visitor hitting https://jwize.com/ now sees a
REM small landing page that directs them to the canonical installer; no
REM installer code is served at this domain.
REM
REM HOW TO USE: right-click this file -> "Run as administrator".

set NSSM=C:\Users\Jaime\AppData\Local\Microsoft\WinGet\Links\nssm.exe

echo Stopping hypercomb-relay service...
net stop hypercomb-relay 2>nul

echo Freeing port 7777 (any leftover session relay)...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 7777 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

echo Reconfiguring service: port 7777 + content (NO installer SPA -- slim host)...
"%NSSM%" set hypercomb-relay AppParameters "C:\Projects\hypercomb\social\src\hypercomb-relay\relay.js --port 7777 --content-dir C:\Projects\hypercomb\social\src\hypercomb-relay\content"

echo Starting hypercomb-relay service...
net start hypercomb-relay

echo.
echo Done. The slim relay is now running as a persistent service on port 7777.
echo Wait ~10s, then refresh https://jwize.com -- you should see the storage-host
echo landing page (no installer; canonical installer is at diamondcoreprocessor.com).
pause
