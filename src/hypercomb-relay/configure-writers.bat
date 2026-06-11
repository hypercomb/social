@echo off
REM Configure the relay's authorized writer pubkey(s) and restart the service.
REM
REM HOW TO USE: right-click -> "Run as administrator". Paste the pubkey when
REM prompted. The exact pubkey is printed in the browser console by host-sync
REM the moment the relay rejects a write:
REM
REM   [host-sync] jwize.com rejected writer auth (401) - drain paused.
REM   Add this browser's pubkey to the relay's --writers list: <64 hex>
REM
REM Multiple pubkeys: comma-separated, no spaces (one per authoring browser
REM profile - the signer key is per-profile, per-origin).
REM
REM This also DROPS the removed --spa-dir flag from the service parameters.
REM relay.js now exits on --spa-dir (slim storage/mesh host - the installer
REM is served separately), so a restart with the old parameters would
REM crash-loop the service.

set /p PUBKEY="Writer pubkey(s) (64-hex, comma-separated): "
if "%PUBKEY%"=="" (
  echo No pubkey entered - nothing changed.
  pause
  exit /b 1
)

nssm set hypercomb-relay AppParameters "C:\Projects\hypercomb\social\src\hypercomb-relay\relay.js --port 7777 --content-dir C:\Projects\hypercomb\social\src\hypercomb-relay\content --writers %PUBKEY%"
nssm restart hypercomb-relay
timeout /t 2 /nobreak >nul
nssm status hypercomb-relay
echo.
echo Done. The relay accepts NIP-98-signed PUTs from the listed pubkey(s),
echo serves the flat heap (GET/PUT /^<sig^>), and jwize.com backup will start
echo draining within 30 seconds (watch for [host-sync] receipts in the
echo browser console).
pause
