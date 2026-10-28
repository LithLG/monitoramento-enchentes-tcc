@echo off
title Iniciar sistema - TCC enchentes
cd /d "%~dp0"

sc query MySQL84 | find "RUNNING" >nul
if errorlevel 1 (
  echo [ATENCAO] O MySQL - servico MySQL84 - nao esta rodando.
  echo Abra "Servicos" no menu Iniciar, inicie o MySQL84 e rode este arquivo de novo.
  pause
  exit /b 1
)

if not exist "classificador\.venv\Scripts\python.exe" (
  echo [ATENCAO] Falta instalar o classificador: pasta classificador\.venv nao encontrada.
  pause
  exit /b 1
)

if not exist "servidor\node_modules" (
  echo [ATENCAO] Falta rodar "npm install" na pasta servidor.
  pause
  exit /b 1
)

echo Ligando o classificador Python na porta 8000...
start "Classificador Python - porta 8000" /d "%~dp0classificador" cmd /k .venv\Scripts\python -m uvicorn app.main:build_app --factory --host 127.0.0.1 --port 8000 --env-file ..\servidor\.env
timeout /t 3 /nobreak >nul

echo Ligando o servidor Node na porta 3000...
start "Servidor Node - porta 3000" /d "%~dp0servidor" cmd /k npm start
timeout /t 5 /nobreak >nul

start "" http://localhost:3000
echo.
echo Sistema ligado. Para desligar, feche as duas janelas pretas.
timeout /t 10 >nul
