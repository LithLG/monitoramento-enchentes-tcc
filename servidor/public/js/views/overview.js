import { html, $, $$, setHtmlIfChanged, readStorage, writeStorage } from '../dom.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { showChartError } from '../components/chartKit.js';
import {
  STATUS_LABEL, RULE_LABEL, CONNECTION_LABEL, TREND_LABEL, WARNING_RULES,
  formatAgo, formatNumber, formatDuration, formatDateTime, formatTime, isSameDay, levelText, soilText,
} from '../format.js';
import { createRiverMap } from '../components/riverMap.js';
import { createLevelColumns } from '../components/levelColumns.js';
import { createCompareChart, PLACE_COLORS } from '../components/compareChart.js';
import { ZONE_LABEL } from '../components/zoneScene.js';
import { zoneChip } from '../components/chips.js';

const HOUR = 60 * 60 * 1000;
const COMPARE_RANGES = [
  { key: '1h', label: '1 h', spanMs: HOUR },
  { key: '6h', label: '6 h', spanMs: 6 * HOUR },
  { key: '24h', label: '24 h', spanMs: 24 * HOUR },
  { key: '7d', label: '7 dias', spanMs: 7 * 24 * HOUR },
];
const COMPARE_REFRESH_MS = 30 * 1000;


const TREND_ICON = { SUBINDO: 'up', BAIXANDO: 'down', ESTAVEL: 'flat', TRANSBORDANDO: 'overflow', INDEFINIDA: 'flat' };
const TREND_CLASS = { SUBINDO: 'up', BAIXANDO: 'down', TRANSBORDANDO: 'up' };

function miniGauge(node) {
  const limits = node.limits;
  const level = node.latest?.level;
  const topCm = 4.2;
  const y = (cm) => 70 - (66 * Math.min(cm, topCm)) / topCm;
  if (!limits) return html`<svg class="mini-gauge" viewBox="0 0 46 74" aria-hidden="true"><rect x="12" y="4" width="22" height="66" rx="7" fill="var(--surface-3)"/></svg>`;
  const levelCm = !level || level.kind === 'SEM_CALIBRACAO' ? limits.bed.rulerCm : level.rulerCm;
  const status = node.classification?.status;
  const waterColor = status === 'RISCO' ? 'var(--risk-line)' : status === 'ATENCAO' ? 'var(--attention-line)' : 'var(--water)';
  return html`
    <svg class="mini-gauge" viewBox="0 0 46 74" aria-hidden="true">
      <rect x="12" y="4" width="22" height="66" rx="7" style="fill:var(--surface-3);stroke:var(--border-strong)"/>
      <rect x="14" y="${y(levelCm)}" width="18" height="${Math.max(0, 68 - y(levelCm))}" rx="5" style="fill:${waterColor};opacity:.85"/>
      <line x1="6" x2="40" y1="${y(limits.attention.rulerCm)}" y2="${y(limits.attention.rulerCm)}" style="stroke:var(--attention-line);stroke-width:1.6;stroke-dasharray:3 2"/>
      <line x1="6" x2="40" y1="${y(limits.risk.rulerCm)}" y2="${y(limits.risk.rulerCm)}" style="stroke:var(--risk-line);stroke-width:1.6;stroke-dasharray:3 2"/>
      <line x1="6" x2="40" y1="${y(limits.overflow.rulerCm)}" y2="${y(limits.overflow.rulerCm)}" style="stroke:var(--text-2);stroke-width:1.4;stroke-dasharray:1 2"/>
    </svg>`;
}

function factRow(iconName, label, value, valueClass = '') {
  return html`<div class="fact-row"><span class="fact-label">${icon(iconName)}${label}</span>
    <span class="fact-value ${valueClass}">${value}</span></div>`;
}

function trendValue(trend) {
  const label = TREND_LABEL[trend.direction];
  const isMoving = trend.direction === 'SUBINDO' || trend.direction === 'BAIXANDO';
  return isMoving && trend.mmPerMinute ? `${label} · ${formatNumber(Math.abs(trend.mmPerMinute) / 10, 2)} cm/min` : label;
}

function locationCard(node, nowMs) {
  const status = node.classification?.status ?? 'SEM_CLASSE';
  const rule = node.classification?.rule;
  const level = levelText(node.latest?.level, rule);
  const soil = soilText(node.latest?.soilIndex, node.latest?.soilSaturated);
  const raining = node.latest?.raining;
  const showsWarning = rule && WARNING_RULES.has(rule);
  const forecast = node.trend.minutesToRisk ?? node.trend.minutesToOverflow;

  return html`
    <div class="location-head">
      <div><h3>${node.name}</h3>${zoneChip(node.zone)}<p>${node.description || `Nó ${node.id}`}</p></div>
      ${node.classification ? html`<span class="chip ${status}">${STATUS_LABEL[status]}</span>` : html`<span class="chip">Sem classe</span>`}
    </div>
    <div class="location-level">
      <div>
        <div class="level-big">${level.value}${level.unit ? html`<small>${level.unit}</small>` : ''}</div>
        <div class="level-sub">${level.unit && node.latest?.level?.kind === 'DENTRO' ? `± ${formatNumber((node.geometry?.uncertaintyMm ?? 2) / 10, 1)} cm na régua` : level.sub}</div>
      </div>
      ${miniGauge(node)}
    </div>
    <div class="location-facts">
      ${factRow(TREND_ICON[node.trend.direction], 'Tendência', trendValue(node.trend), TREND_CLASS[node.trend.direction] ?? '')}
      ${factRow(raining ? 'rain' : 'sun', 'Chuva', raining ? 'Chovendo' : 'Sem chuva', raining ? 'rain' : '')}
      ${factRow('soil', 'Solo', node.latest?.soilIndex === null || node.latest?.soilIndex === undefined ? '—' : `${soil.value} · ${node.latest.soilSaturated ? 'encharcado' : 'absorve água'}`, node.latest?.soilSaturated ? 'wet' : '')}
    </div>
    <div class="location-foot">
      <span class="warnings">
        <span class="pill ${node.connection}"><span class="dot"></span>${CONNECTION_LABEL[node.connection]}</span>
        ${showsWarning ? html`<span class="pill warning ${rule}">${icon('alert')}${RULE_LABEL[rule]}</span>` : ''}
        ${forecast ? html`<span class="pill warning TRANSBORDOU">${icon('clock')}${node.trend.minutesToRisk ? 'Risco' : 'Transborda'} em ~${forecast} min</span>` : ''}
        ${node.drift ? html`<span class="pill warning AVISO_SOLO_CHUVA">${icon('sensor')}Conferir sensor</span>` : ''}
      </span>
      <span>${node.latest ? formatAgo(node.latest.timeMs, nowMs) : 'sem leituras'}</span>
    </div>`;
}

function banners(overview) {
  const items = [];
  const ranked = [...overview.nodes].sort((a, b) => (b.classification?.status === 'RISCO') - (a.classification?.status === 'RISCO'));
  for (const node of ranked) {
    const status = node.classification?.status;
    if (status !== 'RISCO' && status !== 'ATENCAO') continue;
    const since = node.classification.sinceMs ? ` há ${formatDuration(overview.generatedMs - node.classification.sinceMs)}` : '';
    items.push(html`
      <div class="banner ${status === 'RISCO' ? 'risk' : 'attention'}">
        <div class="banner-icon">${icon('alert')}</div>
        <div class="banner-text">
          <strong>${node.name}: ${status === 'RISCO' ? 'risco de enchente' : 'atenção'}</strong>
          <span>${RULE_LABEL[node.classification.rule] ?? node.classification.rule} · nesta classe${since}</span>
        </div>
        <a class="btn" href="#/local/${node.id}">Ver local</a>
      </div>`);
  }
  for (const node of overview.nodes.filter((item) => item.drift)) {
    items.push(html`
      <div class="banner attention">
        <div class="banner-icon">${icon('sensor')}</div>
        <div class="banner-text">
          <strong>${node.name}: confira o sensor de nível</strong>
          <span>O nível subiu ${formatNumber(node.drift.riseMm)} mm em ${formatNumber(node.drift.hours)} h sem chuva e sem ninguém mexer?
            Pode ser desvio do sensor. Meça com a régua: o painel compara e, se precisar, ajusta.</span>
        </div>
        <a class="btn" href="#/local/${node.id}?regua">Medir com a régua</a>
      </div>`);
  }
  if (overview.zonesReady === false) {
    items.push(html`
      <div class="banner info">
        <div class="banner-icon">${icon('layers')}</div>
        <div class="banner-text">
          <strong>Falta um passo para mostrar as zonas no mapa</strong>
          <span>Rode uma vez no MySQL: <code>source C:/Users/Morae/Downloads/TCC CLAUDE/banco/13_zonas.sql</code> e reinicie o sistema.</span>
        </div>
      </div>`);
  }
  if (overview.fieldNotesReady === false && overview.canEdit) {
    items.push(html`
      <div class="banner info">
        <div class="banner-icon">${icon('edit')}</div>
        <div class="banner-text">
          <strong>Falta um passo para guardar anotações e medidas da régua</strong>
          <span>Rode uma vez no MySQL: <code>source C:/Users/Morae/Downloads/TCC CLAUDE/banco/14_anotacoes_regua.sql</code> e reinicie o sistema.</span>
        </div>
      </div>`);
  }
  for (const unknown of overview.unknownNodes) {
    items.push(html`
      <div class="banner info">
        <div class="banner-icon">${icon('sensor')}</div>
        <div class="banner-text">
          <strong>Sensor novo detectado: nó ${unknown.nodeId}</strong>
          <span>Está enviando leituras${unknown.sourceIp ? ` de ${unknown.sourceIp.replace('::ffff:', '')}` : ''}, mas não está cadastrado. As leituras são recusadas até o cadastro.</span>
        </div>
        ${overview.canEdit ? html`<button class="btn btn-primary" type="button" data-register="${unknown.nodeId}">${icon('plus')} Cadastrar</button>` : ''}
      </div>`);
  }
  return items;
}

function kpis(overview) {
  const byStatus = overview.summary.byStatus;
  const tile = (kind, iconName, value, label, href = null) => {
    const content = html`<div class="kpi-icon">${icon(iconName)}</div>
      <div><div class="kpi-value">${value}</div><div class="kpi-label">${label}</div></div>`;
    return href ? html`<a class="card kpi ${kind} kpi-link" href="${href}">${content}</a>` : html`<div class="card kpi ${kind}">${content}</div>`;
  };
  return [
    tile('', 'pin', overview.summary.total, 'Locais monitorados'),
    tile('risk', 'alert', byStatus.RISCO ?? 0, 'Em risco'),
    tile('attention', 'info', byStatus.ATENCAO ?? 0, 'Em atenção'),
    tile('normal', 'signal', `${overview.summary.online}/${overview.summary.total}`, 'Sensores online · ver saúde', '#/sensores'),
  ];
}

export function createOverviewView(root, { navigate, openAddNode }) {
  root.innerHTML = String(html`
    <div class="page-head">
      <div><h1>Visão geral</h1><p>Situação de cada ponto crítico do rio, atualizada a cada 5 segundos.</p></div>
    </div>
    <div id="ov-banners" class="grid" style="gap:12px"></div>
    <section class="kpis" id="ov-kpis" aria-label="Resumo"></section>
    <div class="grid grid-overview">
      <section class="card" aria-labelledby="map-title">
        <div class="card-head"><h2 id="map-title">Mapa do rio</h2><span class="hint">Clique em um ponto para ver o histórico</span></div>
        <div class="card-body"><div class="river-map" id="ov-map"></div><p class="map-swipe">Arraste o mapa para o lado para ver todos os locais.</p></div>
        <div class="map-legend">
          <span><b class="zone-swatch" style="background:var(--zone-rural)"></b>Zona Rural</span>
          <span><b class="zone-swatch" style="background:var(--zone-peri)"></b>Zona Periurbana</span>
          <span><b class="zone-swatch" style="background:var(--zone-urban)"></b>Zona Urbana</span>
          <span style="margin-left:auto"><i style="background:var(--normal-line)"></i>Normal</span>
          <span><i style="background:var(--attention-line)"></i>Atenção</span>
          <span><i style="background:var(--risk-line)"></i>Risco</span>
          <span><i style="background:var(--offline)"></i>Sem sinal</span>
        </div>
      </section>
      <section class="card" aria-labelledby="columns-title">
        <div class="card-head"><h2 id="columns-title">Comparativo de nível</h2><span class="hint">Altura da água na régua de cada caixa</span></div>
        <div class="card-body columns-chart" id="ov-columns"></div>
      </section>
    </div>
    <section class="card" aria-labelledby="compare-title">
      <div class="card-head">
        <div><h2 id="compare-title">Todos os locais no tempo</h2><span class="hint" id="cmp-period"></span></div>
        <div class="head-actions">
          <div class="range-tabs" role="group" aria-label="Período">
            ${COMPARE_RANGES.map((range) => html`<button type="button" data-cmp-range="${range.key}" aria-pressed="false">${range.label}</button>`)}
          </div>
          <button class="btn" type="button" data-action="cmp-png" title="Salvar o gráfico como imagem PNG">${icon('download')} Imagem</button>
        </div>
      </div>
      <div class="card-body">
        <div class="series-toggles" id="cmp-toggles" style="margin-bottom:12px"></div>
        <div class="chart-wrap"><canvas id="cmp-chart" aria-label="Nível de todos os locais ao longo do tempo"></canvas>
          <div class="chart-empty" id="cmp-empty">Carregando…</div></div>
      </div>
    </section>
    <div class="page-head"><div><h2>Locais</h2><p>Cada local é um nó (ESP32) instalado em um ponto do rio, da zona rural à urbana.</p></div></div>
    <section class="locations" id="ov-locations" aria-label="Locais monitorados"></section>`);

  const map = createRiverMap($('#ov-map', root), { onSelect: (id) => navigate(`#/local/${id}`) });
  const columns = createLevelColumns($('#ov-columns', root), { onSelect: (id) => navigate(`#/local/${id}`) });
  const bannerBox = $('#ov-banners', root);
  const list = $('#ov-locations', root);
  // All views draw in the same page element: when this view closes, remove its listeners and ignore late answers.
  const lifecycle = new AbortController();
  const { signal } = lifecycle;
  const compare = createCompareChart($('#cmp-chart', root));
  let latest = null;
  let compareKey = readStorage('painel-comparar') ?? '6h';
  let compareTimer = null;
  let compareRequest = 0;
  let compareHistories = [];
  const hiddenPlaces = new Set();

  function compareRange() {
    const preset = COMPARE_RANGES.find((range) => range.key === compareKey) ?? COMPARE_RANGES[1];
    const toMs = Date.now();
    return { fromMs: toMs - preset.spanMs, toMs };
  }

  function renderCompareToggles() {
    $$('[data-cmp-range]', root).forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.cmpRange === compareKey)));
    setHtmlIfChanged($('#cmp-toggles', root), html`${compareHistories.map((history, index) => html`
      <button class="series-toggle" type="button" data-place="${history.node.id}" aria-pressed="${!hiddenPlaces.has(history.node.id)}">
        <i style="background:${PLACE_COLORS[index % PLACE_COLORS.length]}"></i>${history.node.name}${history.node.zone ? ` · ${ZONE_LABEL[history.node.zone].replace('Zona ', '')}` : ''}
      </button>`)}`);
  }

  async function loadCompare() {
    if (!latest) return;
    const range = compareRange();
    const request = ++compareRequest;
    try {
      const histories = await Promise.all(latest.nodes.map((node) => api.history(node.id, range)));
      if (signal.aborted || request !== compareRequest) return;
      compareHistories = histories;
      const hasData = histories.some((history) => history.points.length);
      $('#cmp-empty', root).textContent = 'Sem leituras neste período.';
      $('#cmp-empty', root).classList.toggle('show', !hasData);
      compare.update(histories, hiddenPlaces);
      renderCompareToggles();
      $('#cmp-period', root).textContent = isSameDay(range.fromMs, range.toMs)
        ? `${formatTime(range.fromMs).slice(0, 5)} – ${formatTime(range.toMs).slice(0, 5)}`
        : `${formatDateTime(range.fromMs)} – ${formatDateTime(range.toMs)}`;
    } catch (error) {
      if (signal.aborted || request !== compareRequest) return;
      showChartError($('#cmp-empty', root), error);
    }
  }

  root.addEventListener('click', (event) => {
    const rangeButton = event.target.closest('[data-cmp-range]');
    if (rangeButton) {
      compareKey = rangeButton.dataset.cmpRange;
      writeStorage('painel-comparar', compareKey);
      renderCompareToggles();
      loadCompare();
      return;
    }
    const placeButton = event.target.closest('[data-place]');
    if (placeButton) {
      const id = Number(placeButton.dataset.place);
      if (hiddenPlaces.has(id)) hiddenPlaces.delete(id);
      else hiddenPlaces.add(id);
      compare.update(compareHistories, hiddenPlaces);
      renderCompareToggles();
      return;
    }
    if (event.target.closest('[data-action="cmp-png"]')) {
      const range = compareRange();
      compare.exportPng({
        title: 'Nível do rio em cada local',
        subtitle: `${formatDateTime(range.fromMs)} a ${formatDateTime(range.toMs)} · régua medida do fundo da caixa`,
        fileName: `comparativo_${new Date(range.toMs).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.png`,
      });
    }
  }, { signal });

  bannerBox.addEventListener('click', (event) => {
    const button = event.target.closest('[data-register]');
    if (button && latest) openAddNode(latest, Number(button.dataset.register));
  });

  function addLocationCard(overview) {
    let addCard = list.querySelector('.add');
    if (!addCard) {
      addCard = document.createElement('button');
      addCard.type = 'button';
      list.prepend(addCard);
      addCard.addEventListener('click', () => {
        if (latest?.canEdit) openAddNode(latest, null);
      });
    }
    addCard.className = `card location add${overview.canEdit ? '' : ' locked'}`;
    setHtmlIfChanged(addCard, overview.canEdit
      ? html`<div class="plus">${icon('plus')}</div><strong>Adicionar local</strong><span>Cadastre um novo ponto do rio com um sensor ESP32.</span>`
      : html`<div class="plus">${icon('lock')}</div><strong>Adicionar local</strong><span>O cadastro só pode ser feito no computador que roda o servidor.</span>`);
    return addCard;
  }

  // The "add" card comes first; the places follow in river order. A card moves only when it is out of place.
  function renderLocations(overview) {
    let previous = addLocationCard(overview);
    const seen = new Set();
    for (const node of overview.nodes) {
      const key = String(node.id);
      seen.add(key);
      let card = list.querySelector(`[data-node-id="${key}"]`);
      if (!card) {
        card = document.createElement('a');
        card.dataset.nodeId = key;
        card.href = `#/local/${key}`;
      }
      card.className = `card location ${node.classification?.status ?? ''}`;
      setHtmlIfChanged(card, locationCard(node, overview.generatedMs));
      const isInPlace = previous.nextElementSibling === card;
      if (!isInPlace) previous.after(card);
      previous = card;
    }
    list.querySelectorAll('[data-node-id]').forEach((card) => {
      if (!seen.has(card.dataset.nodeId)) card.remove();
    });
  }

  function update(overview) {
    const isFirstUpdate = latest === null;
    const placesChanged = latest && latest.nodes.map((n) => n.id).join() !== overview.nodes.map((n) => n.id).join();
    latest = overview;
    if (isFirstUpdate || placesChanged) {
      loadCompare();
      clearInterval(compareTimer);
      compareTimer = setInterval(loadCompare, COMPARE_REFRESH_MS);
    }
    setHtmlIfChanged(bannerBox, html`${banners(overview)}`);
    bannerBox.style.display = bannerBox.children.length ? '' : 'none';
    setHtmlIfChanged($('#ov-kpis', root), html`${kpis(overview)}`);
    map.update(overview.nodes);
    columns.update(overview.nodes);
    renderLocations(overview);
  }

  return {
    update,
    destroy() {
      lifecycle.abort();
      clearInterval(compareTimer);
      compare.destroy();
    },
  };
}
