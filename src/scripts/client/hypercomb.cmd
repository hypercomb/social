@echo off
rem Start the Windows client, updating it to the newest green CI build first.
rem Paths hang off this file, so a Desktop or Startup shortcut keeps working
rem wherever the repo lives.
setlocal
node "%~dp0windows-client.mjs" --launch %*
