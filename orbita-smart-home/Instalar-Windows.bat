@echo off
chcp 65001 >nul
title ORBITA — Instalador Desktop (Windows)
echo ========================================================
echo   ORBITA — Casa Inteligente // Setup Desktop Windows
echo ========================================================
echo.
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [!] Node.js nao encontrado. Instale a versao LTS em https://nodejs.org e rode novamente.
  pause
  exit /b 1
)
echo [1/2] Instalando dependencias (Express + Electron)...
call npm install
if %errorlevel% neq 0 (
  echo [!] Falha ao instalar dependencias.
  pause
  exit /b 1
)
echo.
echo Escolha uma opcao:
echo   [1] Abrir o App Desktop agora (modo rapido)
echo   [2] Gerar instalador .EXE na pasta dist\ (ORBITA Setup.exe)
echo.
set /p OPCAO="Digite 1 ou 2 [padrao=1]: "
if "%OPCAO%"=="2" (
  echo Gerando instalador Windows em dist\...
  call npm run build:win
  echo Pronto! Abra a pasta dist\ para executar o instalador .exe
  explorer dist
  pause
) else (
  echo Iniciando ORBITA Desktop...
  call npm run desktop
)
