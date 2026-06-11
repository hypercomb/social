@echo off
REM Recover the hypercomb-relay service from a wedged PAUSED state.
REM A paused service rejects both STOP and START controls, so this kills the
REM NSSM wrapper process tree directly (SCM then marks the service stopped)
REM and starts it fresh with the already-saved parameters (--writers is in).
REM
REM HOW TO USE: right-click -> "Run as administrator".
REM All output is left visible on purpose - if something fails, the error
REM will be on screen.

echo --- locating the service wrapper process ---
for /f %%i in ('powershell -NoProfile -Command "(Get-CimInstance Win32_Service -Filter \"Name='hypercomb-relay'\").ProcessId"') do set NSSMPID=%%i
echo NSSM wrapper PID: %NSSMPID%

echo.
echo --- killing wrapper tree (nssm + its node child) ---
if defined NSSMPID if not "%NSSMPID%"=="0" taskkill /F /T /PID %NSSMPID%

echo.
echo --- killing anything still holding port 7777 ---
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":7777 " ^| findstr "LISTENING"') do taskkill /F /PID %%a

timeout /t 2 /nobreak >nul

echo.
echo --- starting the service ---
net start hypercomb-relay

timeout /t 3 /nobreak >nul
echo.
echo --- final status (want: SERVICE_RUNNING) ---
nssm status hypercomb-relay
echo.
echo If it says SERVICE_RUNNING: in the browser tab run
echo   window.ioc.get('@diamondcoreprocessor.com/HostSyncService').enable()
pause
