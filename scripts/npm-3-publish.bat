@echo off
setlocal

echo ============================================
echo  Step 3: Build and Publish Packages
echo ============================================
echo.

REM Resolve paths relative to this script
set "REPO_ROOT=%~dp0.."
set "CORE_DIR=%REPO_ROOT%\src\hypercomb-core"
set "ESSENTIALS_DIR=%REPO_ROOT%\src\hypercomb-essentials"

echo Verifying npm login...
call npm whoami
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Not logged in. Run npm-2-login.bat first.
    pause
    exit /b 1
)

echo.
echo ============================================
echo  Building @hypercomb/core ...
echo ============================================
cd /d "%CORE_DIR%"
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: @hypercomb/core build failed.
    pause
    exit /b 1
)

echo.
echo Dry-run pack for @hypercomb/core:
call npm pack --dry-run
echo.
set /p CONFIRM_CORE="Publish @hypercomb/core@0.1.0? (y/n): "
if /i not "%CONFIRM_CORE%"=="y" (
    echo Skipping @hypercomb/core publish.
    goto essentials
)

call npm publish --access public
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: @hypercomb/core publish failed.
    pause
    exit /b 1
)
echo @hypercomb/core published successfully!

:essentials
echo.
echo ============================================
echo  Building @hypercomb/essentials ...
echo ============================================
cd /d "%ESSENTIALS_DIR%"
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: @hypercomb/essentials build failed.
    pause
    exit /b 1
)

echo.
echo Dry-run pack for @hypercomb/essentials:
call npm pack --dry-run
echo.
set /p CONFIRM_ESS="Publish @hypercomb/essentials@0.1.0? (y/n): "
if /i not "%CONFIRM_ESS%"=="y" (
    echo Skipping @hypercomb/essentials publish.
    goto done
)

call npm publish --access public
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: @hypercomb/essentials publish failed.
    pause
    exit /b 1
)
echo @hypercomb/essentials published successfully!

:done
echo.
echo ============================================
echo  Done!
echo ============================================
echo.
echo Verify your packages at:
echo   https://www.npmjs.com/package/@hypercomb/core
echo   https://www.npmjs.com/package/@hypercomb/essentials
echo.
pause
