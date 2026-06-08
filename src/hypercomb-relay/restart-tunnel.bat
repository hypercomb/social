@echo off
REM Restart the cloudflared tunnel so it re-reads config.yml
REM (jwize.com -> http://localhost:7777, the unified relay + installer).
REM
REM HOW TO USE: right-click this file -> "Run as administrator".

echo Restarting cloudflared tunnel...
echo.
net stop cloudflared
net start cloudflared
echo.
echo Done. Wait ~10 seconds for the tunnel to reconnect, then open:
echo    https://jwize.com
echo.
pause
