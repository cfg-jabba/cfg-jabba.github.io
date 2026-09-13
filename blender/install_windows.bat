@echo off
rem Marble Allstars Tools - one-click installer for Windows.
rem Put this next to install_addon.py and the marble_allstars_tools-*.zip,
rem close Blender, then double-click this file.
setlocal enabledelayedexpansion
title Marble Allstars Tools installer

set "SCRIPT=%~dp0install_addon.py"
if not exist "%SCRIPT%" (
  echo.
  echo Could not find install_addon.py next to this file.
  echo Keep install_windows.bat, install_addon.py and the zip in the same folder.
  echo.
  pause
  exit /b 1
)

echo Looking for Blender...
set "BLENDER="

rem 1. On PATH
for %%P in (blender.exe) do if not defined BLENDER set "BLENDER=%%~$PATH:P"

rem 2. Standard installs - the loop ends on the highest version number
if not defined BLENDER (
  for /d %%D in ("%ProgramFiles%\Blender Foundation\Blender *") do (
    if exist "%%D\blender.exe" set "BLENDER=%%D\blender.exe"
  )
)
if not defined BLENDER (
  for /d %%D in ("%ProgramFiles(x86)%\Blender Foundation\Blender *") do (
    if exist "%%D\blender.exe" set "BLENDER=%%D\blender.exe"
  )
)

rem 3. Steam
if not defined BLENDER (
  if exist "%ProgramFiles(x86)%\Steam\steamapps\common\Blender\blender.exe" (
    set "BLENDER=%ProgramFiles(x86)%\Steam\steamapps\common\Blender\blender.exe"
  )
)

if not defined BLENDER (
  echo.
  echo Could not find blender.exe automatically.
  echo.
  echo Install it by hand instead - it takes about twenty seconds:
  echo   1. Open Blender
  echo   2. Edit ^> Preferences ^> Add-ons ^> the arrow top right ^> Install from Disk
  echo   3. Pick marble_allstars_tools-*.zip and tick the add-on
  echo.
  pause
  exit /b 1
)

echo Using "!BLENDER!"
echo.
echo Close Blender before continuing, or your preferences may not keep the add-on.
pause

"!BLENDER!" --background --python "%SCRIPT%"

echo.
echo Done. Open Blender, press N in the 3D viewport and click the Marble tab.
echo.
pause
