@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Setup-RobotBand.ps1"
if errorlevel 1 pause
