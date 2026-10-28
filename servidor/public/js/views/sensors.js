import { html, $, setHtmlIfChanged } from '../dom.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import {
  CONNECTION_LABEL, formatNumber, formatTime, formatDateTime, formatFullDateTime, formatDuration, formatAgo, isSameDay,
} from '../format.js';
import { zoneChip } from '../components/chips.js';
import { toast } from '../components/alerts.js';

const REFRESH_MS = 30 * 1000;
const GOOD_SHARE = 0.95;
const FAIR_SHARE = 0.8;
const WEEKDAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' });
const SCRIPT_14 = 'source C:/Users/Morae/Downloads/TCC CLAUDE/banco/14_anotacoes_regua.sql';

const percent = (share) => (share === null ? '—' : `${formatNumber(share * 100, share >= 0.995 || share < 0.1 ? 0 : 1)}%`);
const shareClass = (share) => (share === null ? 'none' : share >= GOOD_SHARE ? 'good' : share >= FAIR_SHARE ? 'fair' : 'bad');
const signedMm = (mm) => (mm === null ? '—' : `${mm > 0 ? '+' : mm < 0 ? '−' : ''}${formatNumber(Math.abs(mm))} mm`);
const dayLabel = (ms) => `${WEEKDAY.format(ms).replace('.', '')} ${new Date(ms).getDate()}`;

function coverageBars(days) {
  return html`
    <div class="day-bars" role="img" aria-label="Leituras recebidas por dia">
      ${days.map((day) => html`
        <div class="day-bar ${shareClass(day.share)}" title="${dayLabel(day.dayStartMs)}: ${day.share === null ? 'local ainda não existia'
          : `${formatNumber(day.received, 0)} de ${formatNumber(day.expected, 0)} leituras (${percent(day.share)})`}">
          <div class="track"><span style="height:${day.share === null ? 0 : Math.max(4, day.share * 100)}%"></span></div>
          <small>${dayLabel(day.dayStartMs)}</small>
        </div>`)}
    </div>`;
}

function gapItem(gap) {
  const end = gap.ongoing ? 'agora' : isSameDay(gap.startMs, gap.endMs) ? formatTime(gap.endMs).slice(0, 5) : formatDateTime(gap.endMs);
  const cause = gap.shared ? 'todos os locais juntos (PC ou servidor desligado?)' : 'só este local (ESP32, fonte ou Wi-Fi)';
  return html`<li class="${gap.shared ? 'shared' : 'own'}"><b>${formatDateTime(gap.startMs)} → ${end}</b>
    <span>${formatDuration(gap.endMs - gap.startMs)}${gap.ongoing ? ' · em andamento' : ''} · ${cause}</span></li>`;
}

function rulerLine(ruler) {
  const { summary, last } = ruler;
  if (!summary.checks) return html`<span class="muted">Nenhuma medida ainda</span>`;
  const mean = summary.compared ? html` · erro médio <b>${signedMm(summary.meanErrorMm)}</b>` : '';
  return html`${summary.checks} ${summary.checks === 1 ? 'medida' : 'medidas'}${mean}${last ? html`<small>Última: ${formatDateTime(last.timeMs)} (${last.errorMm === null ? 'fora da faixa do sensor' : `erro ${signedMm(last.errorMm)}`})</small>` : ''}`;
}

function placeCard(place, node, canEdit, nowMs) {
  const connection = node?.connection ?? 'NUNCA_ENVIOU';
  const calibration = place.calibrations.current;
  return html`
    <article class="card sensor-card">
      <header class="sensor-head">
        <div><h2>${place.name}</h2>${zoneChip(place.zone)}</div>
        <span class="pill ${connection}"><span class="dot"></span>${CONNECTION_LABEL[connection]}</span>
      </header>
      <div class="sensor-coverage">
        <div class="big ${shareClass(place.coverage.share)}">${percent(place.coverage.share)}</div>
        <div><b>leituras recebidas</b><small>nos últimos 7 dias · última ${formatAgo(place.lastReadingMs, nowMs)}</small></div>
      </div>
      ${coverageBars(place.coverage.days)}
      <dl class="sensor-facts">
        <div><dt>${icon('noSignal')} Falhas de envio</dt><dd>${place.gaps.count
          ? html`${place.gaps.count} <small>${place.gaps.ownCount} só deste local · ${place.gaps.sharedCount} de todos juntos · maior ${formatDuration(place.gaps.longestMs)}</small>`
          : 'Nenhuma'}</dd></div>
        <div><dt>${icon('sensor')} Sensor de nível</dt><dd>${node?.drift
          ? html`<span class="warn-text">Conferir</span><small>subiu ${formatNumber(node.drift.riseMm)} mm em ${formatNumber(node.drift.hours)} h sem chuva</small>`
          : html`Sem sinal de desvio<small>subida lenta sem chuva nas últimas 3 h</small>`}</dd></div>
        <div><dt>${icon('layers')} Calibração</dt><dd>${calibration
          ? html`nº ${calibration.id}<small>desde ${formatDateTime(calibration.createdMs)} (${formatDuration(nowMs - calibration.createdMs)})</small>`
          : 'Sem calibração'}</dd></div>
        <div><dt>${icon('ruler')} Régua × sensor</dt><dd>${rulerLine(place.ruler)}</dd></div>
      </dl>
      ${place.gaps.recent.length ? html`<details class="gap-list"><summary>Últimas falhas</summary><ul>${place.gaps.recent.map(gapItem)}</ul></details>` : ''}
      <footer class="sensor-actions">
        <a class="btn" href="#/local/${place.id}">${icon('wave')} Histórico</a>
        ${canEdit && calibration ? html`<a class="btn" href="#/local/${place.id}?regua">${icon('ruler')} Medir com a régua</a>` : ''}
      </footer>
    </article>`;
}

function rulerTable(ruler, canEdit) {
  const { summary, checks } = ruler;
  if (!checks.length) {
    return html`<p class="muted">Ainda não há medidas. Na página de cada local, use <b>Medir com a régua</b>: o painel guarda o que a régua marcou
      e o que o sensor mostrava no mesmo momento.</p>`;
  }
  return html`
    <div class="stat-grid ruler-stats">
      <div class="stat"><b>${summary.compared}</b><span>Medidas comparadas</span></div>
      <div class="stat"><b>${signedMm(summary.meanErrorMm)}</b><span>Erro médio (com sinal)</span></div>
      <div class="stat"><b>${summary.meanAbsErrorMm === null ? '—' : `${formatNumber(summary.meanAbsErrorMm)} mm`}</b><span>Erro típico (sem sinal)</span></div>
      <div class="stat"><b>${summary.maxAbsErrorMm === null ? '—' : `${formatNumber(summary.maxAbsErrorMm)} mm`}</b><span>Maior erro</span></div>
    </div>
    <p class="tech-note">Erro = sensor − régua. Positivo: o sensor mostra mais água do que a régua. Medidas com a água fora da faixa do sensor aparecem na lista, mas não entram na conta.</p>
    <div class="table-scroll">
      <table class="tech-table ruler-table">
        <thead><tr><th>Quando</th><th>Local</th><th class="num">Régua</th><th class="num">Sensor</th><th class="num">Erro</th><th>Uso</th>${canEdit ? html`<th></th>` : ''}</tr></thead>
        <tbody>${checks.map((check) => html`
          <tr>
            <td>${formatDateTime(check.timeMs)}</td>
            <td>${check.nodeName}</td>
            <td class="num">${formatNumber(check.rulerCm, 2)} cm</td>
            <td class="num">${check.sensorRange === 'ACIMA' ? 'acima' : `${formatNumber(check.sensorRulerCm, 2)} cm`}</td>
            <td class="num ${check.errorMm !== null && Math.abs(check.errorMm) > 2 ? 'warn-text' : ''}">${signedMm(check.errorMm)}</td>
            <td>${check.adjusted ? html`<span class="pill">ajustou o sensor</span>` : 'só medida'}</td>
            ${canEdit ? html`<td><button class="link danger-link" type="button" data-remove-check="${check.id}">remover</button></td>` : ''}
          </tr>`)}</tbody>
      </table>
    </div>`;
}

function rulerCsv(checks) {
  const decimal = (value, digits) => (value === null || value === undefined ? '' : value.toFixed(digits).replace('.', ','));
  const header = 'data_hora;local;regua_cm;sensor_cm;erro_mm;sensor_faixa;sensor_mv;calibracao;ajustou';
  const lines = checks.map((check) => [
    formatFullDateTime(check.timeMs), check.nodeName, decimal(check.rulerCm, 2), decimal(check.sensorRulerCm, 2),
    decimal(check.errorMm, 1), check.sensorRange, check.sensorMv, check.calibrationId, check.adjusted ? 'sim' : 'nao',
  ].join(';'));
  return `\uFEFF${[header, ...lines].join('\r\n')}`;
}

function downloadText(text, fileName) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function createSensorsView(root) {
  root.innerHTML = String(html`
    <div class="page-head">
      <div><h1>Saúde dos sensores</h1>
        <p>Últimos 7 dias. Cada ESP32 manda uma leitura a cada 15 segundos (5.760 por dia).</p></div>
    </div>
    <div id="sn-notice"></div>
    <section class="sensor-grid" id="sn-places" aria-label="Locais"><div class="card skeleton loading-block"></div></section>
    <p class="tech-note sensor-help">Falha = mais de 2 minutos sem leitura. Quando todos os locais param juntos, o mais provável é o PC desligado ou o
      servidor fechado. Quando só um para, olhe o ESP32, a fonte e o Wi-Fi daquele local.</p>
    <section class="card" aria-labelledby="sn-ruler-title">
      <div class="card-head"><div><h2 id="sn-ruler-title">Régua × sensor</h2><span class="hint">Erro do sensor de nível medido com a régua (para o artigo)</span></div>
        <button class="btn" type="button" data-action="ruler-csv">${icon('download')} Baixar CSV</button></div>
      <div class="card-body" id="sn-ruler"></div>
    </section>`);

  let overview = null;
  let health = null;
  let timer = null;
  const pendingRemoval = new Set();

  function render() {
    if (!health) return;
    const nodesById = new Map((overview?.nodes ?? []).map((node) => [node.id, node]));
    const canEdit = Boolean(overview?.canEdit);
    setHtmlIfChanged($('#sn-places', root), html`${health.places.map((place) => placeCard(place, nodesById.get(place.id), canEdit, health.generatedMs))}`);
    setHtmlIfChanged($('#sn-ruler', root), rulerTable(health.ruler, canEdit));
    setHtmlIfChanged($('#sn-notice', root), health.ruler.ready ? '' : html`
      <div class="banner info">
        <div class="banner-icon">${icon('layers')}</div>
        <div class="banner-text"><strong>Falta um passo para guardar medidas da régua e anotações</strong>
          <span>Rode uma vez no MySQL: <code>${SCRIPT_14}</code> e reinicie o sistema.</span></div>
      </div>`);
  }

  // All views draw in the same page element: when this view closes, remove its listeners and ignore late answers.
  const lifecycle = new AbortController();
  const { signal } = lifecycle;

  async function load() {
    try {
      const nextHealth = await api.sensorHealth();
      if (signal.aborted) return;
      health = nextHealth;
      render();
    } catch (error) {
      if (signal.aborted) return;
      setHtmlIfChanged($('#sn-notice', root), html`<div class="card error-state"><h2>Não consegui carregar</h2><p>${error.message}</p></div>`);
    }
  }

  root.addEventListener('click', async (event) => {
    const remove = event.target.closest('[data-remove-check]');
    if (remove) {
      const checkId = Number(remove.dataset.removeCheck);
      if (!pendingRemoval.has(checkId)) {
        pendingRemoval.add(checkId);
        remove.textContent = 'confirmar?';
        return;
      }
      try {
        await api.removeRulerCheck(checkId);
        toast({ title: 'Medida removida', message: 'Ela não entra mais na conta do erro.' });
        load();
      } catch (error) {
        toast({ title: 'Não deu para remover', message: error.message });
      }
      return;
    }
    if (event.target.closest('[data-action="ruler-csv"]') && health) {
      downloadText(rulerCsv(health.ruler.checks), `regua-x-sensor_${new Date().toISOString().slice(0, 10)}.csv`);
    }
  }, { signal });

  load();
  timer = setInterval(load, REFRESH_MS);

  return {
    update(nextOverview) {
      overview = nextOverview;
      document.title = 'Saúde dos sensores · Monitoramento de Enchentes';
      render();
    },
    destroy() {
      lifecycle.abort();
      clearInterval(timer);
    },
  };
}
