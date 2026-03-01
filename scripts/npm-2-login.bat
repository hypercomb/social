@echo off
echo ============================================
echo  Step 2: npm Login
echo ============================================
echo.
echo This will open a browser to authenticate.
echo Make sure you are logged into npmjs.com
echo with the hypercomb.io@gmail.com account.
echo.

call npm login --scope=@hypercomb

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: npm login failed. Please try again.
    pause
    exit /b 1
)

echo.
echo Login successful! Verifying...
call npm whoami
echo.
echo Now run: npm-3-publish.bat
pause
