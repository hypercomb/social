@echo off
REM The idle drain — what Windows Task Scheduler runs when the machine goes
REM quiet. Deliberately thin: every decision lives in mirror-queue.ts.
REM
REM   --unattended  skip passes that are not safely repeatable (a re-sent
REM                 note lands twice); those wait for a human.
REM
REM Exits 0 when there is no renderer, so an idle fire while the hive is
REM closed is a quiet no-op rather than a scheduler error.
REM
REM Log: %LOCALAPPDATA%\hypercomb\mirror-queue.log

cd /d "%~dp0.."
if not exist "%LOCALAPPDATA%\hypercomb" mkdir "%LOCALAPPDATA%\hypercomb"
echo. >> "%LOCALAPPDATA%\hypercomb\mirror-queue.log"
echo ===== %DATE% %TIME% ===== >> "%LOCALAPPDATA%\hypercomb\mirror-queue.log"
call npm run mirror:queue:run -- --unattended >> "%LOCALAPPDATA%\hypercomb\mirror-queue.log" 2>&1
