@echo off
setlocal enabledelayedexpansion

REM Ensure we are running from the repository root
cd /d "%~dp0.."

set "NODE_VERSION=v18.19.0"
set "NODE_DIST_BASE=https://nodejs.org/dist/%NODE_VERSION%"
set "NODE_INSTALLER=node-%NODE_VERSION%-x64.msi"
set "NODE_INSTALLER_URL=%NODE_DIST_BASE%/%NODE_INSTALLER%"
set "NODE_PORTABLE_ARCHIVE=node-%NODE_VERSION%-win-x64.zip"
set "NODE_PORTABLE_FOLDER=node-%NODE_VERSION%-win-x64"

REM ---------------------------------------------------------------------------
REM Ensure npm (and therefore Node.js) is available
REM ---------------------------------------------------------------------------
where npm >nul 2>&1
if errorlevel 1 (
  echo npm was not detected. Attempting to download and install Node.js LTS...

  powershell -Command "try { Invoke-WebRequest -Uri '!NODE_INSTALLER_URL!' -OutFile '!NODE_INSTALLER!' -UseBasicParsing; exit 0 } catch { Write-Error $_; exit 1 }"
  if errorlevel 1 (
    echo.
    echo Failed to download Node.js installer. Please install Node.js manually and retry.
    exit /b 1
  )

  echo Running Node.js installer silently. This may take a minute...
  start /wait msiexec /i "!NODE_INSTALLER!" /qn /norestart
  set "INSTALL_EXIT=!ERRORLEVEL!"
  del "!NODE_INSTALLER!" >nul 2>&1
  if "!INSTALL_EXIT!"=="0" (
    call :add_node_msi_path
    set "NODE_READY_MESSAGE=Node.js and npm are now installed."
  ) else (
    echo.
    echo Node.js installer exited with code !INSTALL_EXIT!. Attempting portable fallback...
    call :install_portable_node
    if errorlevel 1 (
      echo Portable Node.js setup failed. Please install Node.js manually and retry.
      exit /b !INSTALL_EXIT!
    )
    set "NODE_READY_MESSAGE=Using portable Node.js runtime for this session."
  )

  where npm >nul 2>&1
  if errorlevel 1 (
    echo.
    echo npm could not be located even after attempting installation. You may need to restart the terminal.
    exit /b 1
  )
  echo !NODE_READY_MESSAGE!
) else (
  echo npm detected on PATH. Skipping Node.js installation.
)

REM ---------------------------------------------------------------------------
REM Install project dependencies
REM ---------------------------------------------------------------------------
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

echo.
if "%EXIT_CODE%"=="0" (
  echo Services finished successfully.
) else (
  echo The launcher exited with code %EXIT_CODE%.
  echo Review the logs above for details.
)

echo.
echo Press any key to close this window...
pause >nul

exit /b %EXIT_CODE%

:install_portable_node
set "NODE_PORTABLE_ROOT=%cd%\vendor\node"
set "NODE_PORTABLE_ARCHIVE_PATH=%TEMP%\doodlebot-!NODE_PORTABLE_ARCHIVE!"
set "NODE_PORTABLE_BIN=!NODE_PORTABLE_ROOT!\!NODE_PORTABLE_FOLDER!"
set "NODE_PORTABLE_NPM=!NODE_PORTABLE_BIN!\node_modules\npm\bin"

echo Attempting portable Node.js installation...
powershell -Command "try { Invoke-WebRequest -Uri '!NODE_DIST_BASE!/!NODE_PORTABLE_ARCHIVE!' -OutFile '!NODE_PORTABLE_ARCHIVE_PATH!' -UseBasicParsing; exit 0 } catch { Write-Error $_; exit 1 }"
if errorlevel 1 (
  echo.
  echo Failed to download portable Node.js archive.
  exit /b 1
)

if exist "!NODE_PORTABLE_ROOT!" rd /s /q "!NODE_PORTABLE_ROOT!" >nul 2>&1
mkdir "!NODE_PORTABLE_ROOT!" >nul 2>&1

powershell -Command "Expand-Archive -LiteralPath '!NODE_PORTABLE_ARCHIVE_PATH!' -DestinationPath '!NODE_PORTABLE_ROOT!' -Force"
set "EXPAND_EXIT=!ERRORLEVEL!"
del "!NODE_PORTABLE_ARCHIVE_PATH!" >nul 2>&1
if not "!EXPAND_EXIT!"=="0" (
  echo.
  echo Failed to extract portable Node.js archive.
  exit /b 1
)

if not exist "!NODE_PORTABLE_BIN!\node.exe" (
  echo.
  echo Portable Node.js archive did not contain node.exe as expected.
  exit /b 1
)

set "PATH=!NODE_PORTABLE_BIN!;!NODE_PORTABLE_NPM!;!PATH!"
exit /b 0

:add_node_msi_path
if exist "%ProgramFiles%\nodejs\npm.cmd" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%ProgramFiles(x86)%\nodejs\npm.cmd" set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"
exit /b 0
