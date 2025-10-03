@echo off
setlocal enabledelayedexpansion

REM Ensure we are running from the repository root
cd /d "%~dp0.."

if not exist node_modules ( 
  echo Installing project dependencies...
  call npm install
  if errorlevel 1 (
    echo.
    echo Failed to install dependencies. Please check the error above.
    exit /b 1
  )
) else (
  echo Dependencies are already installed.
)

echo.
echo Starting RAM usage monitor in a separate window...
start "RAM Monitor" powershell -NoExit -Command "while ($true) { $os = Get-CimInstance Win32_OperatingSystem; $total = [math]::Round($os.TotalVisibleMemorySize / 1KB, 2); $free = [math]::Round($os.FreePhysicalMemory / 1KB, 2); $used = $total - $free; $percent = if ($total -eq 0) { 0 } else { ($used / $total) * 100 }; Write-Host ('RAM Used: {0:N2} GB / {1:N2} GB ({2:N1}%%)' -f ($used / 1024), ($total / 1024), $percent); Start-Sleep -Seconds 1 }"

echo.
echo Launching the Discord bot and dashboard services...
call npm run start:all

set EXIT_CODE=%ERRORLEVEL%

echo.
echo Shutting down RAM monitor window...
taskkill /fi "WINDOWTITLE eq RAM Monitor" >nul 2>&1

echo Done.
exit /b %EXIT_CODE%
