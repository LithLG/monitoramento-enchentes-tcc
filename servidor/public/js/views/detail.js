import { html, $, $$, setHtmlIfChanged, readStorage, writeStorage } from '../dom.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import {
  STATUS_LABEL, RULE_LABEL, RULE_HELP, CONNECTION_LABEL, TREND_LABEL, WARNING_RULES,
  formatAgo, formatNumber, formatLimitCm, formatTime, formatDateTime, formatFullDateTime, formatDuration,
  levelText, soilText, isSameDay, formatDay, toLocalInputValue,
} from '../format.js';
import { createGauge } from '../components/gauge.js';
import { createHistoryChart } from '../components/historyChart.js';
import { showChartError } from '../components/chartKit.js';
import { zoneChip } from '../components/chips.js';
import { ZONE_LABEL } from '../components/zoneScene.js';
import { toast } from '../components/alerts.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const RANGES = [
  { key: '15m', label: '15 min', spanMs: 15 * MINUTE },
  { key: '1h', label: '1 h', spanMs: HOUR },
  { key: '6h', label: '6 h', spanMs: 6 * HOUR },
  { key: '24h', label: '24 h', spanMs: 24 * HOUR },
  { key: '7d', label: '7 dias', spanMs: 7 * 24 * HOUR },
  { key: 'custom', label: 'Escolher…', spanMs: null },
];
const LIVE_REFRESH_MS = 15 * 1000;
const REPLAY_TICK_MS = 100;
const REPLAY_SPEEDS = [10, 30, 60, 120];
const REPLAY_BEFORE_MS = 8 * MINUTE;
const REPLAY_AFTER_MS = 7 * MINUTE;
const STATUS_RANK = { NORMAL: 0, ATENCAO: 1, RISCO: 2 };
const TREND_ICON = { SUBINDO: 'up', BAIXANDO: 'down', ESTAVEL: 'flat', TRANSBORDANDO: 'overflow', INDEFINIDA: 'clock' };
const SERIES_KEY = 'painel-series';
const DEFAULT_SERIES = { band: true, rain: true, soil: false };

function readSeries() {
  try {
    return { ...DEFAULT_SERIES, ...JSON.parse(readStorage(SERIES_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_SERIES };
  }
}

function trendSub(trend) {
  if (trend.direction === 'TRANSBORDANDO') return 'Água acima do topo do sensor: a subida não pode ser medida';
  if (trend.mmPerMinute === null) return 'Precisa de 3 minutos de leituras seguidas';
  return `Variação de ${formatSignedCm((trend.mmPerMinute * 3) / 10)} nos últimos 3 minutos`;
}

const formatSignedCm = (cm) => {
  const rounded = Math.round(cm * 100) / 100;
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${formatNumber(Math.abs(rounded), 2)} cm`;
};


function headSection(node, overview) {
  const status = node.classification?.status;
  const rule = node.classification?.rule;
  const since = node.classification?.sinceMs;
  return html`
    <div class="title">
      <h1>${node.name} <span class="node-id">Nó ${node.id}</span> ${zoneChip(node.zone)}</h1>
      <p>${node.description || 'Sem descrição'}</p>
      <div class="meta">
        ${status ? html`<span class="chip lg ${status}">${STATUS_LABEL[status]}</span>` : html`<span class="chip lg">Sem classe</span>`}
        <span class="pill ${node.connection}"><span class="dot"></span>${CONNECTION_LABEL[node.connection]}</span>
        ${rule && WARNING_RULES.has(rule) ? html`<span class="pill warning ${rule}">${icon('alert')}${RULE_LABEL[rule]}</span>` : ''}
        ${since ? html`<span class="pill">${icon('clock')}Nesta classe desde ${isSameDay(since, overview.generatedMs) ? formatTime(since) : formatDateTime(since)} (${formatDuration(overview.generatedMs - since)})</span>` : ''}
        ${node.latest ? html`<span class="pill">Última leitura ${formatAgo(node.latest.timeMs, overview.generatedMs)}</span>` : ''}
      </div>
      ${rule ? html`<p class="status-explain"><strong>${RULE_LABEL[rule] ?? rule}.</strong> ${RULE_HELP[rule] ?? ''}</p>` : ''}
      ${node.drift ? html`<p class="drift-note">${icon('sensor')} O nível subiu ${formatNumber(node.drift.riseMm)} mm em ${formatNumber(node.drift.hours)} h
        sem chuva. Se ninguém colocou água, pode ser desvio do sensor: use "Medir com a régua".</p>` : ''}
    </div>
    <div class="actions">
      ${overview.canEdit ? html`<button class="btn" type="button" data-action="edit">${icon('edit')} Editar</button>` : ''}
      ${overview.canEdit && node.calibration ? html`<button class="btn" type="button" data-action="ruler">${icon('ruler')} Medir com a régua</button>` : ''}
      <a class="btn" data-action="csv" href="#" download>${icon('download')} Baixar dados (CSV)</a>
    </div>`;
}

function levelProgress(node) {
  const limits = node.limits;
  const level = node.latest?.level;
  if (!limits || !level || level.kind === 'SEM_CALIBRACAO') return '';
  const span = limits.overflow.depthMm;
  const share = (mm) => Math.max(0, Math.min(100, (mm / span) * 100));
  const levelMm = level.kind === 'ACIMA' ? span : level.depthMm ?? 0;
  const steps = [['o limite de Atenção', limits.attention], ['o limite de Risco', limits.risk], ['transbordar', limits.overflow]];
  const next = level.kind === 'DENTRO' ? steps.find(([, limit]) => level.depthMm < limit.depthMm) : null;
  const note = next
    ? `Faltam ${formatNumber((next[1].depthMm - level.depthMm) / 10, 2)} cm para ${next[0]}`
    : level.kind === 'ACIMA' || (level.depthMm ?? 0) >= span ? 'A água passou da margem' : '';
  return html`
    <div class="level-track" role="img" aria-label="Posição do nível entre o leito e a margem">
      <span class="zone normal" style="width:${share(limits.attention.depthMm)}%"></span>
      <span class="zone attention" style="width:${share(limits.risk.depthMm) - share(limits.attention.depthMm)}%"></span>
      <span class="zone risk" style="width:${100 - share(limits.risk.depthMm)}%"></span>
      <i style="left:${share(levelMm)}%"></i>
    </div>
    <div class="level-track-labels"><span>leito</span><span>margem</span></div>
    ${note ? html`<div class="indicator-note">${note}</div>` : ''}`;
}

function indicators(node, overview) {
  const rule = node.classification?.rule;
  const level = levelText(node.latest?.level, rule);
  const soil = soilText(node.latest?.soilIndex, node.latest?.soilSaturated);
  const trend = node.trend;
  const trendClass = trend.direction === 'SUBINDO' || trend.direction === 'TRANSBORDANDO' ? 'rising' : trend.direction === 'BAIXANDO' ? 'falling' : '';
  const trendValue = trend.mmPerMinute !== null && trend.direction !== 'ESTAVEL'
    ? html`${TREND_LABEL[trend.direction]} <small>${formatNumber(Math.abs(trend.mmPerMinute) / 10, 2)} cm/min</small>`
    : TREND_LABEL[trend.direction];
  const forecastParts = [];
  if (trend.minutesToRisk) forecastParts.push(`Risco em ~${trend.minutesToRisk} min`);
  if (trend.minutesToOverflow) forecastParts.push(`transborda em ~${trend.minutesToOverflow} min`);
  const saturatedAt = node.calibration ? Math.round((overview.thresholds?.soilSaturatedIndex ?? 0.8) * 100) : null;
  const soilWidth = Math.min(100, Math.max(0, (node.latest?.soilIndex ?? 0) * 100));
  const raining = node.latest?.raining;
  const uncertaintyCm = (node.geometry?.uncertaintyMm ?? 2) / 10;

  return html`
    <div class="card indicator">
      <div class="indicator-top"><span class="i-icon">${icon('ruler')}</span>Nível na régua</div>
      <div class="indicator-value">${level.value}${level.unit ? html`<small>${level.unit}</small>` : ''}</div>
      <div class="indicator-sub">${level.unit && node.latest?.level?.kind === 'DENTRO' ? `± ${formatNumber(uncertaintyCm, 1)} cm · ` : ''}${level.sub}</div>
      ${levelProgress(node)}
    </div>
    <div class="card indicator ${trendClass}">
      <div class="indicator-top"><span class="i-icon">${icon(TREND_ICON[trend.direction] ?? 'flat')}</span>Tendência</div>
      <div class="indicator-value">${trendValue}</div>
      <div class="indicator-sub">${trendSub(trend)}</div>
      ${forecastParts.length
        ? html`<div class="forecast">${icon('clock')} Previsão: ${forecastParts.join(', ')}</div>`
        : html`<div class="indicator-note muted">${trend.direction === 'TRANSBORDANDO' ? 'A água já passou da margem' : 'Sem previsão de alerta no ritmo atual'}</div>`}
    </div>
    <div class="card indicator ${raining ? 'raining' : ''}">
      <div class="indicator-top"><span class="i-icon">${icon(raining ? 'rain' : 'sun')}</span>Chuva</div>
      <div class="indicator-value">${raining ? 'Chovendo' : 'Sem chuva'}</div>
      <div class="indicator-sub">${raining ? 'Placa de chuva molhada agora' : node.lastRainMs ? `Última chuva ${formatAgo(node.lastRainMs, Date.now())}` : 'Sem chuva nas últimas 24 h'}</div>
      ${node.latest && node.calibration ? html`<div class="indicator-note muted">Placa em ${node.latest.rainMv} mV · molhada abaixo de ${node.calibration.rainWetBelowMv} mV</div>` : ''}
    </div>
    <div class="card indicator ${node.latest?.soilSaturated ? 'saturated' : ''}">
      <div class="indicator-top"><span class="i-icon">${icon('soil')}</span>Umidade do solo</div>
      <div class="indicator-value">${soil.value}</div>
      <div class="soil-bar" title="Linha: limite de solo encharcado"><span style="width:${soilWidth}%"></span>${saturatedAt ? html`<i style="left:${saturatedAt}%"></i>` : ''}</div>
      <div class="indicator-sub">${soil.sub}</div>
    </div>`;
}

const signedMm = (mm) => `${mm > 0 ? '+' : mm < 0 ? '−' : ''}${formatNumber(Math.abs(mm))} mm`;

function eventItem(event, canEdit) {
  const when = html`<time datetime="${new Date(event.timeMs).toISOString()}"><b>${formatTime(event.timeMs)}</b>${formatDay(event.timeMs)}</time>`;
  if (event.type === 'NOTA') {
    return html`<li class="note-event"><span class="t-icon note">${icon('edit')}</span>
      <div><div class="t-title">${event.text}</div>
      <div class="t-sub">Anotação${event.nodeId === null ? ' · todos os locais' : ''}${canEdit ? html` · <button class="link danger-link" type="button" data-remove-note="${event.id}">remover</button>` : ''}</div></div>${when}</li>`;
  }
  if (event.type === 'REGUA') {
    const sensor = event.sensorRange === 'ACIMA' ? 'acima do topo' : `${formatNumber(event.sensorRulerCm, 2)} cm`;
    return html`<li><span class="t-icon ruler">${icon('ruler')}</span>
      <div><div class="t-title">Régua: ${formatNumber(event.rulerCm, 2)} cm${event.adjusted ? ' (sensor ajustado)' : ''}</div>
      <div class="t-sub">Sensor mostrava ${sensor}${event.errorMm === null ? '' : ` · diferença ${signedMm(event.errorMm)}`}</div></div>${when}</li>`;
  }
  const levelNote = event.level ? (event.level.above ? ' · água acima do sensor' : ` · nível ${formatNumber(event.level.rulerCm)} cm`) : '';
  if (event.type === 'CLASSE') {
    const worse = { NORMAL: 0, ATENCAO: 1, RISCO: 2 }[event.to] > { NORMAL: 0, ATENCAO: 1, RISCO: 2 }[event.from];
    return html`<li><span class="t-icon ${event.to}">${icon(worse ? 'up' : 'down')}</span>
      <div><div class="t-title">${worse ? 'Entrou em' : 'Voltou para'} ${STATUS_LABEL[event.to]}</div>
      <div class="t-sub">${RULE_LABEL[event.rule] ?? event.rule}${levelNote}</div>
      <button class="link replay-link" type="button" data-replay-at="${event.timeMs}">${icon('play')} Repetir este momento</button></div>${when}</li>`;
  }
  if (event.type === 'AVISO_INICIO') {
    return html`<li><span class="t-icon info">${icon('alert')}</span>
      <div><div class="t-title">Aviso: ${RULE_LABEL[event.rule] ?? event.rule}</div><div class="t-sub">${RULE_HELP[event.rule] ?? ''}</div></div>${when}</li>`;
  }
  if (event.type === 'AVISO_FIM') {
    return html`<li><span class="t-icon">${icon('check')}</span>
      <div><div class="t-title">Fim do aviso: ${RULE_LABEL[event.rule] ?? event.rule}</div><div class="t-sub">${levelNote.replace(' · ', '')}</div></div>${when}</li>`;
  }
  return html`<li><span class="t-icon">${icon('noSignal')}</span>
    <div><div class="t-title">Sem sinal por ${formatDuration(event.untilMs - event.timeMs)}</div>
    <div class="t-sub">Nenhuma leitura entre ${formatTime(event.timeMs)} e ${formatTime(event.untilMs)}</div></div>${when}</li>`;
}

// Class changes and warnings from the classifier, plus the notes and ruler measurements of the authors, newest first.
function timelineOf(history) {
  const notes = (history.annotations ?? []).map((note) => ({ ...note, type: 'NOTA' }));
  const checks = (history.rulerChecks ?? []).map((check) => ({ ...check, type: 'REGUA' }));
  return [...history.events, ...notes, ...checks].sort((a, b) => b.timeMs - a.timeMs);
}

function leadTimeSection(leadTimes) {
  if (!leadTimes) return '';
  const { episodes, summary } = leadTimes;
  const describe = (episode) => {
    const start = `${formatDateTime(episode.attentionMs ?? episode.startMs)}`;
    if (episode.startedBeforePeriod) return html`<li><b>${start}</b> já estava em alerta no começo do período</li>`;
    if (episode.overflowed) {
      return html`<li><b>${start}</b> transbordou: Atenção avisou <strong>${formatDuration(episode.attentionLeadMs)}</strong> antes${
        episode.riskLeadMs !== null ? html` e Risco <strong>${formatDuration(episode.riskLeadMs)}</strong> antes` : ''}</li>`;
    }
    const peak = episode.riskMs ? 'chegou a Risco' : 'ficou em Atenção';
    return html`<li><b>${start}</b> ${peak} e ${episode.ongoing ? 'continua em alerta' : `voltou ao normal em ${formatDuration(episode.endMs - episode.startMs)}`}, sem transbordar</li>`;
  };
  return html`
    <div class="lead-box">
      <div class="lead-head">${icon('clock')}<strong>Antecedência dos alertas</strong></div>
      ${summary.measured
        ? html`<p class="lead-main">Em média, o primeiro alerta veio <strong>${formatDuration(summary.averageAttentionLeadMs)}</strong> antes de transbordar${
          summary.averageRiskLeadMs !== null ? html` e o Risco <strong>${formatDuration(summary.averageRiskLeadMs)}</strong> antes` : ''} (${summary.measured} ${summary.measured === 1 ? 'subida' : 'subidas'}).</p>`
        : html`<p class="lead-main muted">Nenhuma subida até transbordar neste período. Faça um teste de subida até passar da margem para medir a antecedência.</p>`}
      ${episodes.length ? html`<ul class="lead-list">${episodes.slice(-5).reverse().map(describe)}</ul>` : ''}
    </div>`;
}

function statsSection(history) {
  const { stats } = history;
  const share = stats.statusShare;
  const percent = (value) => `${Math.round(value * 100)}%`;
  const alerts = history.events.filter((e) => e.type === 'CLASSE' && e.to !== 'NORMAL').length;
  return html`
    <div>
      <div class="share-bar" role="img" aria-label="Tempo em cada classe">
        <span style="width:${share.NORMAL * 100}%;background:var(--normal-line)"></span>
        <span style="width:${share.ATENCAO * 100}%;background:var(--attention-line)"></span>
        <span style="width:${share.RISCO * 100}%;background:var(--risk-line)"></span>
      </div>
      <div class="share-legend">
        <span><i style="background:var(--normal-line)"></i>Normal ${percent(share.NORMAL)}</span>
        <span><i style="background:var(--attention-line)"></i>Atenção ${percent(share.ATENCAO)}</span>
        <span><i style="background:var(--risk-line)"></i>Risco ${percent(share.RISCO)}</span>
      </div>
    </div>
    <div class="stat-grid">
      <div class="stat"><b>${stats.maxRulerCm === null ? '—' : `${stats.maxIsAboveSensor ? '≥ ' : ''}${formatNumber(stats.maxRulerCm)} cm`}</b><span>Nível máximo</span></div>
      <div class="stat"><b>${stats.minRulerCm === null ? '—' : `${stats.minIsAboveSensor ? '≥ ' : ''}${formatNumber(stats.minRulerCm)} cm`}</b><span>Nível mínimo</span></div>
      <div class="stat"><b>${stats.rainMinutes} min</b><span>Com chuva</span></div>
      <div class="stat"><b>${alerts}</b><span>Entradas em alerta</span></div>
      <div class="stat"><b>${formatNumber(stats.readings, 0)}</b><span>Leituras recebidas</span></div>
      <div class="stat"><b>${history.bucketSeconds < 60 ? `${history.bucketSeconds} s` : `${history.bucketSeconds / 60} min`}</b><span>Cada ponto do gráfico</span></div>
    </div>
    ${leadTimeSection(history.leadTimes)}`;
}

function calibrationHistorySection(calibrations) {
  if (!calibrations?.length) return '';
  return html`
    <div>
      <table class="tech-table">
        <thead><tr><th>Versões da calibração</th><th>Quando</th><th>Observação</th></tr></thead>
        <tbody>${calibrations.map((item) => html`
          <tr><td>nº ${item.id}${item.active ? html` <span class="pill ONLINE"><span class="dot"></span>ativa</span>` : ''}</td>
            <td class="num">${formatDateTime(item.createdMs)}</td><td>${item.notes ?? ''}</td></tr>`)}</tbody>
      </table>
      <p class="tech-note">Cada ajuste cria uma versão nova; as leituras antigas continuam ligadas à versão usada na hora.</p>
    </div>`;
}

function techSection(node, overview) {
  const limits = node.limits;
  const calibration = node.calibration;
  const bedCm = node.geometry?.bedHeightMm ? node.geometry.bedHeightMm / 10 : 1;
  return html`
    ${limits ? html`
      <div>
        <table class="tech-table">
          <thead><tr><th>Limite</th><th class="num">Régua</th><th class="num">Lâmina</th><th class="num">Sai abaixo de</th></tr></thead>
          <tbody>
            <tr><td>Atenção</td><td class="num">${formatLimitCm(limits.attention.rulerCm)}</td><td class="num">${formatNumber(limits.attention.depthMm)} mm</td><td class="num">${formatLimitCm(limits.attentionExit.rulerCm)}</td></tr>
            <tr><td>Risco</td><td class="num">${formatLimitCm(limits.risk.rulerCm)}</td><td class="num">${formatNumber(limits.risk.depthMm)} mm</td><td class="num">${formatLimitCm(limits.riskExit.rulerCm)}</td></tr>
            <tr><td>Transborda</td><td class="num">${formatLimitCm(limits.overflow.rulerCm)}</td><td class="num">${formatNumber(limits.overflow.depthMm)} mm</td><td class="num">—</td></tr>
            <tr><td>Rio seco</td><td class="num">${formatLimitCm(limits.dry.rulerCm)}</td><td class="num">${formatNumber(limits.dry.depthMm)} mm</td><td class="num">—</td></tr>
          </tbody>
        </table>
        <p class="tech-note">Régua medida do fundo da caixa; o leito fica a ${formatNumber(bedCm)} cm. Lâmina = altura da água sobre o leito.</p>
      </div>` : ''}
    ${calibration ? html`
      <div>
        <table class="tech-table">
          <thead><tr><th>Curva do sensor de nível</th><th class="num">mV</th><th class="num">Lâmina</th><th class="num">Régua</th></tr></thead>
          <tbody>${calibration.curve.map(([mv, mm], index) => html`
            <tr><td>Ponto ${index + 1}</td><td class="num">${mv}</td><td class="num">${mm} mm</td><td class="num">${formatNumber(bedCm + mm / 10)} cm</td></tr>`)}</tbody>
        </table>
        <p class="tech-note">Solo: seco ${calibration.soilDryMv} mV, encharcado ${calibration.soilSaturatedMv} mV · Chuva: molhou abaixo de ${calibration.rainWetBelowMv} mV
          · Calibração nº ${calibration.id} de ${formatFullDateTime(calibration.createdMs)}${calibration.notes ? html` · <em>${calibration.notes}</em>` : ''}</p>
      </div>` : html`<p class="tech-note">Este local ainda não tem calibração: o painel mostra só os valores em mV.</p>`}
    ${node.latest ? html`
      <p class="tech-note">Última leitura bruta: nível ${node.latest.levelMv} mV · chuva ${node.latest.rainMv} mV · solo ${node.latest.soilMv} mV
        (${formatFullDateTime(node.latest.timeMs)})</p>` : ''}
    ${overview.thresholds ? html`<p class="tech-note">Limiares ativos: <strong>${overview.thresholds.name}</strong>. ${overview.thresholds.rationale}</p>` : ''}`;
}

function reasonFact(events, simMs) {
  const lastChange = events.find((event) => event.type === 'CLASSE' && event.timeMs <= simMs);
  if (!lastChange) return html`<div class="wide"><span>Motivo</span><b>Mesma classe desde o começo deste período</b></div>`;
  return html`<div class="wide"><span>Motivo · desde ${formatTime(lastChange.timeMs)}</span>
    <b>${RULE_LABEL[lastChange.rule] ?? lastChange.rule}</b><small>${RULE_HELP[lastChange.rule] ?? ''}</small></div>`;
}

function replayPanel(point, history, simMs, speed) {
  if (!point) return html`<div class="card indicator replay-panel"><div class="indicator-sub">Sem leituras neste momento.</div></div>`;
  const bedCm = history.limits?.bed.rulerCm ?? 1;
  const isDry = !point.above && point.rulerCm !== null && point.rulerCm <= bedCm + 0.1;
  const level = point.above ? `≥ ${formatNumber(point.rulerCm)} cm` : isDry ? 'Seco' : `${formatNumber(point.rulerCm)} cm`;
  return html`
    <div class="card indicator replay-panel">
      <div class="indicator-top"><span class="i-icon">${icon('play')}</span>Replay de dados gravados · ×${speed}</div>
      <div class="indicator-value">${formatTime(simMs)} <small>${formatDay(simMs)}</small></div>
      <div class="replay-facts">
        <div><span>Classe</span>${point.status ? html`<span class="chip lg ${point.status}">${STATUS_LABEL[point.status]}</span>` : '—'}</div>
        <div><span>Nível na régua</span><b>${level}</b></div>
        <div><span>Chuva</span><b>${point.rainShare > 0 ? 'Chovendo' : 'Sem chuva'}</b></div>
        <div><span>Solo</span><b>${point.soilIndex === null ? '—' : `${Math.min(100, Math.max(0, Math.round(point.soilIndex * 100)))}%`}</b></div>
        ${reasonFact(history.events, simMs)}
      </div>
      <div class="indicator-sub">O desenho da caixa e o gráfico mostram este momento. Os dados são reais, gravados pelo sensor.</div>
    </div>`;
}

export function createDetailView(root, { nodeId, openEditNode, openExplain, openRulerAdjust, openAnnotation }) {
  root.innerHTML = String(html`
    <a class="back-link" href="#/">${icon('back')} Todos os locais</a>
    <section class="card detail-head" id="dt-head"><div class="skeleton loading-block" style="flex:1"></div></section>
    <div class="grid grid-detail">
      <section class="card gauge-card">
        <div class="card-head"><h2>Nível agora</h2><span class="hint">Corte da caixa com a régua</span></div>
        <div class="card-body"><div class="gauge" id="dt-gauge"></div></div>
      </section>
      <div class="indicators" id="dt-indicators"></div>
    </div>
    <section class="card" aria-labelledby="history-title">
      <div class="card-head">
        <h2 id="history-title">Histórico</h2>
        <div class="head-actions">
          <div class="range-tabs" role="group" aria-label="Período">
            ${RANGES.map((range) => html`<button type="button" data-range="${range.key}" aria-pressed="false">${range.label}</button>`)}
          </div>
          <button class="btn" type="button" data-action="note" title="Marcar no gráfico o que vocês fizeram" hidden>${icon('edit')} Anotar</button>
          <button class="btn" type="button" data-action="replay" title="Repetir o período do gráfico, acelerado">${icon('play')} Replay</button>
          <button class="btn" type="button" data-action="png" title="Salvar o gráfico como imagem PNG para o artigo">${icon('download')} Imagem</button>
        </div>
      </div>
      <div class="replay-bar" id="dt-replay" hidden>
        <span class="replay-badge">REPLAY</span>
        <button class="icon-button" type="button" data-replay="toggle" aria-label="Pausar ou continuar">${icon('pause')}</button>
        <input type="range" id="dt-replay-pos" min="0" max="1000" value="0" aria-label="Posição do replay">
        <span class="replay-time" id="dt-replay-time"></span>
        <div class="range-tabs" role="group" aria-label="Velocidade">
          ${REPLAY_SPEEDS.map((speed) => html`<button type="button" data-speed="${speed}" aria-pressed="${speed === 30}">×${speed}</button>`)}
        </div>
        <button class="btn" type="button" data-replay="exit">Sair do replay</button>
      </div>
      <div class="custom-range" id="dt-custom">
        <label>De <input type="datetime-local" id="dt-from"></label>
        <label>Até <input type="datetime-local" id="dt-to"></label>
        <button class="btn" type="button" id="dt-apply">Aplicar</button>
      </div>
      <div class="card-body">
        <div class="series-toggles" style="margin-bottom:12px">
          <button class="series-toggle" type="button" aria-pressed="true" disabled><i style="background:var(--water)"></i>Nível (cor = classe)</button>
          <button class="series-toggle" type="button" data-series="band"><i style="background:color-mix(in srgb, var(--water) 30%, transparent)"></i>Faixa mín–máx</button>
          <button class="series-toggle" type="button" data-series="rain"><i style="background:#38bdf8"></i>Chuva</button>
          <button class="series-toggle" type="button" data-series="soil"><i style="background:#a16207"></i>Solo</button>
        </div>
        <div class="chart-wrap"><canvas id="dt-chart" aria-label="Gráfico do nível ao longo do tempo"></canvas>
          <div class="chart-empty" id="dt-empty">Sem leituras neste período.</div></div>
        <div class="status-legend">
          <span><i style="background:var(--normal-line)"></i>Normal</span>
          <span><i style="background:var(--attention-line)"></i>Atenção</span>
          <span><i style="background:var(--risk-line)"></i>Risco</span>
          <span>Faixas coloridas: zonas de atenção, risco e transbordamento · <button class="link" type="button" data-action="explain" style="border:0;background:none;color:var(--brand);font-weight:600;cursor:pointer;padding:0">como é calculado?</button></span>
        </div>
      </div>
    </section>
    <div class="grid grid-bottom">
      <section class="card">
        <div class="card-head"><h2>O que aconteceu</h2><span class="hint" id="dt-period"></span></div>
        <div class="card-body"><ol class="timeline" id="dt-events"><li class="empty">Carregando…</li></ol></div>
      </section>
      <section class="card">
        <div class="card-head"><h2>Resumo do período</h2></div>
        <div class="card-body stats" id="dt-stats"></div>
        <details class="tech"><summary>Dados técnicos</summary><div class="tech-body" id="dt-tech"></div></details>
      </section>
    </div>`);

  // All views draw in the same page element: when this view closes, remove its listeners and ignore late answers.
  const lifecycle = new AbortController();
  const { signal } = lifecycle;
  const gauge = createGauge($('#dt-gauge', root));
  const chart = createHistoryChart($('#dt-chart', root));
  const series = readSeries();
  let rangeKey = readStorage('painel-periodo') ?? '1h';
  let customRange = null;
  let node = null;
  let overview = null;
  let historyTimer = null;
  let historyRequest = 0;
  let latestHistory = null;
  let rulerDialogOffered = false;
  const replay = { active: false, playing: false, simMs: 0, speed: 30, timer: null, lastStatus: null, lastFrameMs: null };
  const notesToRemove = new Set();

  function currentRange() {
    if (rangeKey === 'custom' && customRange) return customRange;
    const preset = RANGES.find((range) => range.key === rangeKey && range.spanMs) ?? RANGES[1];
    const toMs = Date.now();
    return { fromMs: toMs - preset.spanMs, toMs };
  }

  function renderRangeButtons() {
    $$('[data-range]', root).forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.range === rangeKey)));
    $('#dt-custom', root).classList.toggle('open', rangeKey === 'custom');
    $$('[data-series]', root).forEach((button) => button.setAttribute('aria-pressed', String(series[button.dataset.series])));
  }

  async function loadHistory() {
    const range = currentRange();
    const request = ++historyRequest;
    const csvLink = $('[data-action="csv"]', root);
    if (csvLink) csvLink.href = api.csvUrl(nodeId, range);
    try {
      const history = await api.history(nodeId, range);
      if (signal.aborted || request !== historyRequest) return;
      latestHistory = history;
      $('#dt-empty', root).textContent = 'Sem leituras neste período.';
      $('#dt-empty', root).classList.toggle('show', history.points.length === 0);
      chart.update(history, series);
      $('#dt-period', root).textContent = isSameDay(range.fromMs, range.toMs)
        ? `${formatTime(range.fromMs).slice(0, 5)} – ${formatTime(range.toMs).slice(0, 5)}`
        : `${formatDateTime(range.fromMs)} – ${formatDateTime(range.toMs)}`;
      const timeline = timelineOf(history);
      setHtmlIfChanged($('#dt-events', root), timeline.length
        ? html`${timeline.map((event) => eventItem(event, Boolean(overview?.canEdit)))}`
        : html`<li class="empty">Nenhuma mudança neste período: a classe ficou igual o tempo todo.</li>`);
      setHtmlIfChanged($('#dt-stats', root), statsSection(history));
      if (node) setHtmlIfChanged($('#dt-tech', root), html`${techSection(node, overview)}${calibrationHistorySection(history.calibrations)}`);
    } catch (error) {
      if (signal.aborted || request !== historyRequest) return;
      showChartError($('#dt-empty', root), error);
    }
  }

  function scheduleLiveRefresh() {
    clearInterval(historyTimer);
    if (rangeKey !== 'custom' && !replay.active) historyTimer = setInterval(loadHistory, LIVE_REFRESH_MS);
  }

  function pointAt(timeMs) {
    const points = latestHistory?.points ?? [];
    let found = null;
    for (const point of points) {
      if (point.timeMs > timeMs) break;
      found = point;
    }
    return found;
  }

  function replayNode(point) {
    const bedCm = latestHistory.limits?.bed.rulerCm ?? 1;
    const isDry = point && !point.above && point.rulerCm !== null && point.rulerCm <= bedCm + 0.1;
    let kind = 'DENTRO';
    if (!point || point.rulerCm === null) kind = 'SEM_CALIBRACAO';
    else if (point.above) kind = 'ACIMA';
    else if (isDry) kind = 'ABAIXO';
    return {
      limits: latestHistory.limits,
      latest: point ? { level: { kind, rulerCm: point.rulerCm, depthMm: null } } : null,
      classification: point?.status ? { status: point.status, rule: isDry ? 'RIO_SECO' : null } : null,
    };
  }

  function showReplayFrame() {
    const { fromMs, toMs } = latestHistory.range;
    const point = pointAt(replay.simMs);
    gauge.update(replayNode(point));
    chart.setReplayTime(replay.simMs);
    setHtmlIfChanged($('#dt-indicators', root), replayPanel(point, latestHistory, replay.simMs, replay.speed));
    $('#dt-replay-pos', root).value = String(Math.round(((replay.simMs - fromMs) / (toMs - fromMs)) * 1000));
    $('#dt-replay-time', root).textContent = formatFullDateTime(replay.simMs);

    const status = point?.status ?? null;
    const changed = replay.playing && status && replay.lastStatus && status !== replay.lastStatus;
    if (changed) {
      const worse = STATUS_RANK[status] > STATUS_RANK[replay.lastStatus];
      toast({
        title: `Replay ${formatTime(replay.simMs)}: ${worse ? 'entrou em' : 'voltou para'} ${STATUS_LABEL[status]}`,
        message: `${node?.name ?? ''} · nível ${point.above ? 'acima do sensor' : `${formatNumber(point.rulerCm)} cm`}`,
        status,
      });
    }
    if (status) replay.lastStatus = status;

    const passedNotes = replay.playing && replay.lastFrameMs !== null
      ? (latestHistory.annotations ?? []).filter((note) => note.timeMs > replay.lastFrameMs && note.timeMs <= replay.simMs)
      : [];
    passedNotes.forEach((note) => toast({ title: `Anotação ${formatTime(note.timeMs)}`, message: note.text }));
    replay.lastFrameMs = replay.simMs;
  }

  function setPlaying(playing) {
    replay.playing = playing;
    clearInterval(replay.timer);
    $('[data-replay="toggle"]', root).innerHTML = String(icon(playing ? 'pause' : 'play'));
    if (!playing) return;
    replay.timer = setInterval(() => {
      replay.simMs += replay.speed * REPLAY_TICK_MS;
      if (replay.simMs >= latestHistory.range.toMs) {
        replay.simMs = latestHistory.range.toMs;
        showReplayFrame();
        setPlaying(false);
        return;
      }
      showReplayFrame();
    }, REPLAY_TICK_MS);
  }

  function startReplay(fromMs = null) {
    if (!latestHistory?.points.length) {
      toast({ title: 'Nada para repetir', message: 'Escolha um período com leituras.' });
      return;
    }
    replay.active = true;
    replay.lastStatus = null;
    replay.lastFrameMs = null;
    replay.simMs = fromMs ?? latestHistory.range.fromMs;
    clearInterval(historyTimer);
    $('#dt-replay', root).hidden = false;
    root.classList.add('replaying');
    document.body.classList.add('is-replaying');
    showReplayFrame();
    setPlaying(true);
  }

  function exitReplay() {
    setPlaying(false);
    replay.active = false;
    $('#dt-replay', root).hidden = true;
    root.classList.remove('replaying');
    document.body.classList.remove('is-replaying');
    chart.setReplayTime(null);
    $('#dt-indicators', root).dataset.rendered = '';
    if (overview) update(overview);
    scheduleLiveRefresh();
  }

  async function replayAround(timeMs) {
    rangeKey = 'custom';
    customRange = { fromMs: timeMs - REPLAY_BEFORE_MS, toMs: Math.min(Date.now(), timeMs + REPLAY_AFTER_MS) };
    $('#dt-from', root).value = toLocalInputValue(customRange.fromMs);
    $('#dt-to', root).value = toLocalInputValue(customRange.toMs);
    renderRangeButtons();
    await loadHistory();
    if (signal.aborted) return;
    window.scrollTo({ top: $('.gauge-card', root).getBoundingClientRect().top + window.scrollY - 90, behavior: 'smooth' });
    startReplay();
  }

  async function removeAnnotation(button) {
    const annotationId = Number(button.dataset.removeNote);
    if (!notesToRemove.has(annotationId)) {
      notesToRemove.add(annotationId);
      button.textContent = 'confirmar?';
      return;
    }
    try {
      await api.removeAnnotation(annotationId);
      if (signal.aborted) return;
      toast({ title: 'Anotação removida', message: 'Ela some do gráfico e da lista.' });
      loadHistory();
    } catch (error) {
      toast({ title: 'Não deu para remover', message: error.message });
    }
  }

  function exportImage() {
    if (!latestHistory || !node) return;
    const { fromMs, toMs } = latestHistory.range;
    const zone = node.zone ? ` · ${ZONE_LABEL[node.zone]}` : '';
    chart.exportPng({
      title: `${node.name} — nível do rio`,
      subtitle: `${formatDateTime(fromMs)} a ${formatDateTime(toMs)}${zone} · régua medida do fundo da caixa`,
      fileName: `${node.name.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}_${new Date(toMs).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.png`,
    });
  }

  root.addEventListener('click', (event) => {
    const rangeButton = event.target.closest('[data-range]');
    if (rangeButton) {
      if (replay.active) exitReplay();
      rangeKey = rangeButton.dataset.range;
      if (rangeKey === 'custom') {
        const range = customRange ?? currentRangeForInputs();
        $('#dt-from', root).value = toLocalInputValue(range.fromMs);
        $('#dt-to', root).value = toLocalInputValue(range.toMs);
      } else {
        writeStorage('painel-periodo', rangeKey);
        loadHistory();
      }
      renderRangeButtons();
      scheduleLiveRefresh();
      return;
    }
    const seriesButton = event.target.closest('[data-series]');
    if (seriesButton) {
      const key = seriesButton.dataset.series;
      series[key] = !series[key];
      writeStorage(SERIES_KEY, JSON.stringify(series));
      renderRangeButtons();
      loadHistory();
      return;
    }
    if (event.target.closest('#dt-apply')) {
      const fromMs = new Date($('#dt-from', root).value).getTime();
      const toMs = new Date($('#dt-to', root).value).getTime();
      if (Number.isFinite(fromMs) && Number.isFinite(toMs) && fromMs < toMs) {
        customRange = { fromMs, toMs };
        loadHistory();
      }
      return;
    }
    const removeNote = event.target.closest('[data-remove-note]');
    if (removeNote) {
      removeAnnotation(removeNote);
      return;
    }
    const replayAt = event.target.closest('[data-replay-at]');
    if (replayAt) {
      replayAround(Number(replayAt.dataset.replayAt));
      return;
    }
    const speedButton = event.target.closest('[data-speed]');
    if (speedButton) {
      replay.speed = Number(speedButton.dataset.speed);
      $$('[data-speed]', root).forEach((button) => button.setAttribute('aria-pressed', String(button === speedButton)));
      return;
    }
    const replayControl = event.target.closest('[data-replay]')?.dataset.replay;
    if (replayControl === 'toggle') {
      const atEnd = replay.simMs >= (latestHistory?.range.toMs ?? 0);
      if (atEnd) replay.simMs = latestHistory.range.fromMs;
      setPlaying(!replay.playing);
      return;
    }
    if (replayControl === 'exit') {
      exitReplay();
      return;
    }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'edit' && node) openEditNode(node, overview);
    if (action === 'ruler' && node) openRulerAdjust(node, { onDone: loadHistory });
    if (action === 'note' && node) openAnnotation({ node, timeMs: replay.active ? replay.simMs : Date.now(), onSaved: loadHistory });
    if (action === 'explain' && overview) openExplain(overview);
    if (action === 'replay') startReplay();
    if (action === 'png') exportImage();
  }, { signal });

  root.addEventListener('input', (event) => {
    if (event.target.id !== 'dt-replay-pos' || !latestHistory) return;
    const { fromMs, toMs } = latestHistory.range;
    replay.simMs = fromMs + (Number(event.target.value) / 1000) * (toMs - fromMs);
    replay.lastStatus = null;
    replay.lastFrameMs = null;
    showReplayFrame();
  }, { signal });

  function currentRangeForInputs() {
    const toMs = Date.now();
    return { fromMs: toMs - 6 * HOUR, toMs };
  }

  function update(nextOverview) {
    overview = nextOverview;
    node = overview.nodes.find((item) => item.id === nodeId) ?? null;
    if (!node) {
      root.innerHTML = String(html`<div class="card error-state"><h2>Local não encontrado</h2>
        <p>O nó ${nodeId} não está cadastrado.</p><p style="margin-top:14px"><a class="btn" href="#/">Voltar</a></p></div>`);
      clearInterval(historyTimer);
      return;
    }
    document.title = `${node.name} · Monitoramento de Enchentes`;
    const headChanged = setHtmlIfChanged($('#dt-head', root), headSection(node, overview));
    if (headChanged) {
      const csvLink = $('[data-action="csv"]', root);
      if (csvLink) csvLink.href = api.csvUrl(nodeId, currentRange());
    }
    if (!replay.active) {
      setHtmlIfChanged($('#dt-indicators', root), indicators(node, overview));
      gauge.update(node);
    }
    setHtmlIfChanged($('#dt-tech', root), html`${techSection(node, overview)}${calibrationHistorySection(latestHistory?.calibrations)}`);
    const asksForRuler = location.hash.includes('?ajuste') || location.hash.includes('?regua');
    const wantsRulerDialog = asksForRuler && !rulerDialogOffered && overview.canEdit && node.calibration;
    if (wantsRulerDialog) {
      rulerDialogOffered = true;
      openRulerAdjust(node, { onDone: loadHistory });
    }
    $('[data-action="note"]', root).hidden = !(overview.canEdit && overview.fieldNotesReady);
  }

  renderRangeButtons();
  loadHistory();
  scheduleLiveRefresh();

  return {
    update,
    destroy() {
      lifecycle.abort();
      clearInterval(historyTimer);
      clearInterval(replay.timer);
      document.body.classList.remove('is-replaying');
      chart.destroy();
    },
  };
}
