@echo off
setlocal
cd /d "%~dp0servidor"
if not exist ".env.banca" goto preparo
if not exist "node_modules\mysql2" goto preparo
where node >nul 2>nul || goto preparo
set "PORT=3010"
set "DB_NAME=tcc_banca"
set "DB_USER=banca_leitura"
set "PYTHON_URL="
set "CLASSIFY_INTERVAL_MS=0"
set "DISCOVERY_INTERVAL_MS=0"
start "Painel da banca - feche para encerrar" cmd /k node --env-file=.env.banca src/server.js
powershell -NoProfile -Command "for ($i=0; $i -lt 20; $i++) { try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:3010/api/overview'; if ($r.StatusCode -eq 200) {exit 0} } catch {} Start-Sleep -Seconds 1 }; exit 1"
if errorlevel 1 (
  echo O painel nao respondeu. Confira o MySQL e a mensagem na janela do servidor.
  pause
  exit /b 1
)
start "" "http://localhost:3010/#/local/2?de=2026-11-01T18:19:00-03:00&ate=2026-11-01T18:24:00-03:00"
exit /b 0
:preparo
echo Prepare o notebook seguindo a secao Apresentacao para a banca do README.
pause
exit /b 1
