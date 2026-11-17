@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_windows.ps1" -Launch
if errorlevel 1 exit /b %errorlevel%
