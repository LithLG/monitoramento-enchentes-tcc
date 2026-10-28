'use strict';

const REFRESH_SECONDS = 5;

const escapeHtml = (value) => String(value ?? '—')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const formatTime = (date) => (date ? new Date(date).toLocaleTimeString('pt-BR', { hour12: false }) : '—');

function renderConvertedCells(node) {
  const hasCalibration = node.level_range !== null;
  if (!hasCalibration) return '<td colspan="3" class="muted">sem calibração</td>';

  const depth = node.level_depth_mm === null ? '' : ` · ${escapeHtml(node.level_depth_mm)} mm`;
  return `<td>${escapeHtml(node.level_range)}${depth}</td>`
    + `<td>${escapeHtml(node.rain_class)}</td><td>${escapeHtml(node.soil_index)}</td>`;
}

function renderStatusCell(node) {
  if (!node.status) return '<span class="muted">não classificada</span>';
  return `<b class="${escapeHtml(node.status)}">${escapeHtml(node.status)}</b><br><small>${escapeHtml(node.rule)}</small>`;
}

function renderRow(node) {
  return `<tr><td>${escapeHtml(node.name)}</td><td>${formatTime(node.recorded_at)}</td>`
    + `<td>${escapeHtml(node.level_mv)}</td><td>${escapeHtml(node.rain_mv)}</td><td>${escapeHtml(node.soil_mv)}</td>`
    + `${renderConvertedCells(node)}<td>${renderStatusCell(node)}</td>`
    + `<td>${escapeHtml(node.total_readings)}</td><td>${escapeHtml(node.unclassified)}</td></tr>`;
}

function renderStatusPage(overview) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="${REFRESH_SECONDS}"><title>Monitoramento de enchentes</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;color:#222}table{border-collapse:collapse}
th,td{border:1px solid #ccc;padding:4px 8px;text-align:center}th{background:#f2f2f2}.muted{color:#888}
.NORMAL{color:#1a7f37}.ATENCAO{color:#b7791f}.RISCO{color:#c62828}</style></head><body>
<h1>Monitoramento de enchentes</h1>
<p>Última leitura de cada nó (atualiza a cada ${REFRESH_SECONDS} s). Dados completos no MySQL, banco <code>tcc_enchentes</code>.</p>
<table><tr><th rowspan="2">Nó</th><th rowspan="2">Hora</th><th colspan="3">Bruto (mV)</th>
<th colspan="3">Convertido</th><th rowspan="2">Classe</th><th rowspan="2">Leituras</th><th rowspan="2">Não classificadas</th></tr>
<tr><th>nível</th><th>chuva</th><th>solo</th><th>nível</th><th>chuva</th><th>solo (S)</th></tr>
${overview.map(renderRow).join('\n')}</table></body></html>`;
}

module.exports = { renderStatusPage, escapeHtml };
