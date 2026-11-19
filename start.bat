@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Офис

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Не найден Node.js.
  echo   Установите версию LTS с сайта https://nodejs.org и запустите этот файл снова.
  echo.
  pause
  exit /b 1
)

:loop
node server\main.js
rem after a crash the office starts again by itself
if errorlevel 1 (
  echo   Офис остановился с ошибкой, перезапуск через 10 секунд...
  timeout /t 10 /nobreak >nul
  goto loop
)
