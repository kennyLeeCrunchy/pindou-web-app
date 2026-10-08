@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-lan.ps1" -OneClick
if errorlevel 1 pause
