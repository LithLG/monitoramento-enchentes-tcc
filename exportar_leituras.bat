@echo off
title Exportar leituras - TCC enchentes
cd /d "%~dp0"

set "MYSQL=C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
if not exist "%MYSQL%" (
  echo [ATENCAO] Nao achei o mysql.exe em "%MYSQL%".
  pause
  exit /b 1
)

for /f "usebackq tokens=1,* delims==" %%A in ("servidor\.env") do (
  if "%%A"=="DB_USER" set "DB_USER=%%B"
  if "%%A"=="DB_PASSWORD" set "DB_PASSWORD=%%B"
)

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set "STAMP=%%i"
if not exist "calibracao_dados" mkdir "calibracao_dados"
set "SAIDA=calibracao_dados\leituras_%STAMP%.tsv"

"%MYSQL%" -h 127.0.0.1 -u %DB_USER% --password=%DB_PASSWORD% tcc_enchentes --batch -e "SELECT r.id, r.node_id, r.seq, r.uptime_ms, r.recorded_at, r.level_mv, r.rain_mv, r.soil_mv, r.level_range, r.level_depth_mm, r.rain_class, r.soil_index, c.status, c.rule FROM reading r LEFT JOIN classification c ON c.reading_id = r.id WHERE r.recorded_at >= NOW() - INTERVAL 1 DAY ORDER BY r.id" > "%SAIDA%" 2>nul

if errorlevel 1 (
  echo [ATENCAO] O MySQL recusou a consulta. Ele esta ligado?
  pause
  exit /b 1
)
echo Leituras das ultimas 24 h salvas em %SAIDA%
timeout /t 5 >nul
