import { html, $, $$, setHtmlIfChanged, readStorage, writeStorage } from '../dom.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { STATUS_LABEL, RULE_LABEL, RULE_HELP, formatTime, formatNumber, formatLimitCm, formatDay } from '../format.js';
import { decisionFlow } from '../components/decisionFlow.js';
import { createGauge } from '../components/gauge.js';
import { zoneChip } from '../components/chips.js';

const MODE_KEY = 'painel-decisao-modo';
const PLACE_KEY = 'painel-decisao-local';
const LIVE_REFRESH_MS = 15 * 1000;
const SIMULATE_DELAY_MS = 150;
const RULER_MIN_CM = 1;
const RULER_MAX_CM = 3.7;
const MODE = Object.freeze({ LIVE: 'agora', SIMULATE: 'simular' });

const EXAMPLES = [
  { label: 'Rio normal', values: { rulerCm: 2.2, raining: false, soilPercent: 20, previousStatus: 'NORMAL' } },
  { label: 'Subiu até a atenção', values: { rulerCm: 2.7, raining: false, soilPercent: 20, previousStatus: 'NORMAL' } },
  { label: 'Atenção + chuva com solo encharcado', values: { rulerCm: 2.7, raining: true, soilPercent: 90, previousStatus: 'ATENCAO' } },
  { label: 'Só chuva, rio normal', values: { rulerCm: 2.2, raining: true, soilPercent: 90, previousStatus: 'NORMAL' } },
  { label: 'Baixando depois do risco', values: { rulerCm: 3.0, raining: false, soilPercent: 20, previousStatus: 'RISCO' } },
  { label: 'Transbordou', values: { rulerCm: 3.7, raining: false, soilPercent: 20, previousStatus: 'RISCO' } },
];

const PREVIOUS_OPTIONS = [['', 'Nenhuma'], ['NORMAL', 'Normal'], ['ATENCAO', 'Atenção'], ['RISCO', 'Risco']];

const rulerShare = (cm) => Math.max(0, Math.min(100, ((cm - RULER_MIN_CM) / (RULER_MAX_CM - RULER_MIN_CM)) * 100));

function simLevelText(rulerCm, limits) {
  if (limits && rulerCm > limits.sensorTop.rulerCm) return html`acima do sensor <small>(≥ ${formatNumber(limits.sensorTop.rulerCm)} cm)</small>`;
  return html`${formatNumber(rulerCm, 2)} cm`;
}

function scaleBar(limits) {
  if (!limits) return '';
  const marks = [
    ['attention', 'Atenção', limits.attention.rulerCm],
    ['risk', 'Risco', limits.risk.rulerCm],
    ['overflow', 'Transborda', limits.overflow.rulerCm],
  ];
  return html`
    <div class="sim-track">
      <span class="normal" style="width:${rulerShare(limits.attention.rulerCm)}%"></span>
      <span class="attention" style="width:${rulerShare(limits.risk.rulerCm) - rulerShare(limits.attention.rulerCm)}%"></span>
      <span class="risk" style="width:${rulerShare(limits.overflow.rulerCm) - rulerShare(limits.risk.rulerCm)}%"></span>
      <span class="overflow" style="width:${100 - rulerShare(limits.overflow.rulerCm)}%"></span>
    </div>
    <div class="sim-marks">${marks.map(([key, label, cm]) => html`
      <span class="${key}" style="left:${rulerShare(cm)}%">${label}<b>${formatLimitCm(cm)}</b></span>`)}</div>`;
}

function finalBox(result) {
  const { final } = result.steps;
  return html`
    <div class="sim-final ${final.status}">
      <span class="flow-final-label">O sistema decidiria</span>
      <span class="chip lg ${final.status}">${STATUS_LABEL[final.status]}</span>
      <strong>${RULE_LABEL[final.rule] ?? final.rule}</strong>
      <p>${RULE_HELP[final.rule] ?? ''}</p>
    </div>`;
}

function sourcesSection(overview, limits) {
  const thresholds = overview?.thresholds;
  if (!thresholds) return html`<p class="muted">Sem limiares ativos no banco.</p>`;
  return html`
    ${limits ? html`
      <table class="tech-table">
        <thead><tr><th>Limite</th><th class="num">Entra em</th><th class="num">Sai abaixo de</th><th>Por quê</th></tr></thead>
        <tbody>
          <tr><td>${html`<span class="chip ATENCAO">Atenção</span>`}</td><td class="num">${formatLimitCm(limits.attention.rulerCm)}</td>
            <td class="num">${formatLimitCm(limits.attentionExit.rulerCm)}</td><td>1º terço da folga até a margem: possibilidade moderada de enchente</td></tr>
          <tr><td>${html`<span class="chip RISCO">Risco</span>`}</td><td class="num">${formatLimitCm(limits.risk.rulerCm)}</td>
            <td class="num">${formatLimitCm(limits.riskExit.rulerCm)}</td><td>2º terço: possibilidade elevada, antes de a água chegar na margem</td></tr>
          <tr><td>Transborda</td><td class="num">${formatLimitCm(limits.overflow.rulerCm)}</td><td class="num">—</td><td>Margem da caixa: a enchente começa aqui</td></tr>
          <tr><td>Rio seco</td><td class="num">abaixo de ${formatLimitCm(limits.dry.rulerCm)}</td><td class="num">—</td><td>Quase sem água no leito (aviso, classe Normal)</td></tr>
          <tr><td>Solo encharcado</td><td class="num">${Math.round(thresholds.soilSaturatedIndex * 100)}%</td><td class="num">—</td><td>Solo que não absorve mais água</td></tr>
        </tbody>
      </table>` : ''}
    <p class="tech-note">Limiares ativos: <strong>${thresholds.name}</strong>. ${thresholds.rationale}</p>
    <p class="tech-note">A folga de ${formatNumber(thresholds.hysteresisMm)} mm (histerese) evita que o alerta fique ligando e desligando quando a água oscila perto de um limite.</p>`;
}

export function createDecisionView(root) {
  root.innerHTML = String(html`
    <div class="page-head">
      <div><h1>Como o alerta é decidido</h1>
        <p>O sistema especialista (árvore de decisão) roda no Python e segue 3 passos. Veja o caminho de cada local agora ou teste outras situações.</p></div>
      <div class="range-tabs" role="group" aria-label="Modo">
        <button type="button" data-mode="${MODE.LIVE}">${icon('signal')} Agora</button>
        <button type="button" data-mode="${MODE.SIMULATE}">${icon('calc')} Simular "e se?"</button>
      </div>
    </div>
    <div class="place-picker" id="dc-places" role="group" aria-label="Local"></div>
    <div id="dc-notice"></div>
    <section class="card" id="dc-live-card" aria-labelledby="dc-live-title">
      <div class="card-head"><div><h2 id="dc-live-title">Caminho que o sistema seguiu agora</h2><span class="hint" id="dc-live-meta">Carregando…</span></div></div>
      <div class="card-body" id="dc-live"></div>
    </section>
    <section class="card" id="dc-sim-card" aria-labelledby="dc-sim-title" hidden>
      <div class="card-head"><div><h2 id="dc-sim-title">Simulador "e se?"</h2>
        <span class="hint">Mude os valores e veja o que o sistema decidiria. Usa as mesmas regras do Python e nada é gravado.</span></div>
        <button class="btn" type="button" data-action="from-live">${icon('copy')} Usar os valores de agora</button></div>
      <div class="card-body sim-grid">
        <div class="sim-controls">
          <div class="sim-field">
            <label for="sim-level">Nível na régua <output id="sim-level-out"></output></label>
            <input type="range" id="sim-level" min="${RULER_MIN_CM}" max="${RULER_MAX_CM}" step="0.05">
            <div id="sim-scale"></div>
          </div>
          <div class="sim-field">
            <span class="sim-label">Chuva</span>
            <div class="range-tabs" data-group="raining" role="group" aria-label="Chuva">
              <button type="button" data-value="false">${icon('sun')} Sem chuva</button>
              <button type="button" data-value="true">${icon('rain')} Chovendo</button>
            </div>
          </div>
          <div class="sim-field">
            <label for="sim-soil">Umidade do solo <output id="sim-soil-out"></output></label>
            <input type="range" id="sim-soil" min="0" max="100" step="5">
          </div>
          <div class="sim-field">
            <span class="sim-label">Classe da leitura anterior <small>usada na folga para descer</small></span>
            <div class="range-tabs" data-group="previous" role="group" aria-label="Classe anterior">
              ${PREVIOUS_OPTIONS.map(([value, label]) => html`<button type="button" data-value="${value}">${label}</button>`)}
            </div>
          </div>
          <div class="sim-examples"><span class="sim-label">Exemplos prontos</span>
            <div>${EXAMPLES.map((example, index) => html`<button class="btn btn-small" type="button" data-example="${index}">${example.label}</button>`)}</div>
          </div>
        </div>
        <div class="sim-result">
          <div class="gauge" id="dc-gauge"></div>
          <div id="dc-sim-final" aria-live="polite"></div>
        </div>
      </div>
      <div class="card-body" id="dc-sim-flow"></div>
    </section>
    <section class="card" aria-labelledby="dc-sources-title">
      <div class="card-head"><h2 id="dc-sources-title">De onde vêm os números</h2></div>
      <div class="card-body" id="dc-sources"></div>
    </section>`);

  const gauge = createGauge($('#dc-gauge', root));
  let mode = readStorage(MODE_KEY) === MODE.SIMULATE ? MODE.SIMULATE : MODE.LIVE;
  let placeId = Number(readStorage(PLACE_KEY)) || null;
  let overview = null;
  let live = null;
  let liveTimer = null;
  let simTimer = null;
  let simRequest = 0;
  let simResult = null;
  const sim = { rulerCm: 2.2, raining: false, soilPercent: 20, previousStatus: 'NORMAL' };

  const livePlace = () => live?.places.find((place) => place.node.id === placeId) ?? null;
  const currentLimits = () => (mode === MODE.SIMULATE && simResult ? simResult.limits : livePlace()?.limits) ?? null;

  function showNotice(error) {
    setHtmlIfChanged($('#dc-notice', root), error ? html`
      <div class="banner info">
        <div class="banner-icon">${icon('info')}</div>
        <div class="banner-text"><strong>Não deu para mostrar a árvore agora</strong><span>${error.message}</span></div>
      </div>` : '');
  }

  function renderPlaces() {
    const nodes = overview?.nodes ?? live?.places.map((place) => place.node) ?? [];
    if (!placeId || !nodes.some((node) => node.id === placeId)) placeId = nodes.find((node) => node.calibration)?.id ?? nodes[0]?.id ?? null;
    setHtmlIfChanged($('#dc-places', root), html`
      <span class="sim-label">Local</span>
      ${nodes.map((node) => html`
        <button type="button" class="place-button" data-place="${node.id}" aria-pressed="${node.id === placeId}">
          <i class="dot ${node.classification?.status ?? ''}"></i>${node.name}${zoneChip(node.zone)}</button>`)}`);
  }

  function renderMode() {
    $$('[data-mode]', root).forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
    $('#dc-live-card', root).hidden = mode !== MODE.LIVE;
    $('#dc-sim-card', root).hidden = mode !== MODE.SIMULATE;
  }

  function renderLive() {
    const place = livePlace();
    if (!live) return;
    if (!place?.ready) {
      $('#dc-live-meta', root).textContent = 'Este local ainda não tem leitura classificada.';
      setHtmlIfChanged($('#dc-live', root), html`<p class="muted">Sem leitura classificada para mostrar o caminho.</p>`);
      return;
    }
    const changed = place.stored.status !== place.steps.final.status || place.stored.rule !== place.steps.final.rule;
    $('#dc-live-meta', root).textContent = `Leitura das ${formatTime(place.reading.timeMs)} de ${formatDay(place.reading.timeMs)} · atualiza a cada 15 s`;
    setHtmlIfChanged($('#dc-live', root), html`
      ${changed ? html`<p class="drift-note">${icon('info')} Esta leitura foi gravada como ${STATUS_LABEL[place.stored.status]} (${RULE_LABEL[place.stored.rule] ?? place.stored.rule})
        com os limiares da época. Com os limiares de hoje o caminho é o de baixo.</p>` : ''}
      ${decisionFlow(place)}`);
  }

  function renderSimControls() {
    const limits = simResult?.limits ?? livePlace()?.limits ?? null;
    $('#sim-level', root).value = String(sim.rulerCm);
    $('#sim-level-out', root).innerHTML = String(simLevelText(sim.rulerCm, limits));
    $('#sim-soil', root).value = String(sim.soilPercent);
    const saturatedAt = Math.round((overview?.thresholds?.soilSaturatedIndex ?? 0.8) * 100);
    $('#sim-soil-out', root).textContent = `${sim.soilPercent}%${sim.soilPercent >= saturatedAt ? ' · encharcado' : ''}`;
    setHtmlIfChanged($('#sim-scale', root), scaleBar(limits));
    $$('[data-group="raining"] button', root).forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.value === String(sim.raining))));
    $$('[data-group="previous"] button', root).forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.value === (sim.previousStatus ?? ''))));
  }

  function renderSimResult() {
    if (!simResult) return;
    gauge.update({
      limits: simResult.limits,
      latest: { level: simResult.inputs.level },
      classification: { status: simResult.steps.final.status, rule: simResult.steps.final.rule },
    });
    setHtmlIfChanged($('#dc-sim-final', root), finalBox(simResult));
    setHtmlIfChanged($('#dc-sim-flow', root), decisionFlow(simResult));
  }

  // All views draw in the same page element: when this view closes, remove its listeners and ignore late answers.
  const lifecycle = new AbortController();
  const { signal } = lifecycle;

  async function runSimulation() {
    if (!placeId) return;
    const request = ++simRequest;
    try {
      const result = await api.simulate({ nodeId: placeId, ...sim, rulerCm: String(sim.rulerCm) });
      if (signal.aborted || request !== simRequest) return;
      simResult = result;
      showNotice(null);
      renderSimControls();
      renderSimResult();
    } catch (error) {
      if (!signal.aborted && request === simRequest) showNotice(error);
    }
  }

  function scheduleSimulation() {
    renderSimControls();
    clearTimeout(simTimer);
    simTimer = setTimeout(runSimulation, SIMULATE_DELAY_MS);
  }

  function copyLiveValues() {
    const place = livePlace();
    if (!place?.ready) return;
    const level = place.inputs.level;
    sim.rulerCm = level.kind === 'ACIMA' ? RULER_MAX_CM : Math.min(RULER_MAX_CM, Math.max(RULER_MIN_CM, Math.round(level.rulerCm * 20) / 20));
    sim.raining = place.inputs.raining;
    sim.soilPercent = Math.max(0, Math.min(100, Math.round(place.inputs.soilIndex * 20) * 5));
    sim.previousStatus = place.inputs.previousStatus;
    scheduleSimulation();
  }

  async function loadLive() {
    try {
      const nextLive = await api.decision();
      if (signal.aborted) return;
      live = nextLive;
      showNotice(null);
      renderPlaces();
      renderLive();
      setHtmlIfChanged($('#dc-sources', root), sourcesSection(overview, currentLimits()));
    } catch (error) {
      if (signal.aborted) return;
      showNotice(error);
      $('#dc-live-meta', root).textContent = '';
    }
  }

  root.addEventListener('click', (event) => {
    const modeButton = event.target.closest('[data-mode]');
    if (modeButton) {
      mode = modeButton.dataset.mode;
      writeStorage(MODE_KEY, mode);
      renderMode();
      if (mode === MODE.SIMULATE) scheduleSimulation();
      return;
    }
    const placeButton = event.target.closest('[data-place]');
    if (placeButton) {
      placeId = Number(placeButton.dataset.place);
      writeStorage(PLACE_KEY, String(placeId));
      renderPlaces();
      renderLive();
      if (mode === MODE.SIMULATE) scheduleSimulation();
      setHtmlIfChanged($('#dc-sources', root), sourcesSection(overview, currentLimits()));
      return;
    }
    const groupButton = event.target.closest('[data-group] button');
    if (groupButton) {
      const group = groupButton.closest('[data-group]').dataset.group;
      if (group === 'raining') sim.raining = groupButton.dataset.value === 'true';
      if (group === 'previous') sim.previousStatus = groupButton.dataset.value || null;
      scheduleSimulation();
      return;
    }
    const example = event.target.closest('[data-example]');
    if (example) {
      Object.assign(sim, EXAMPLES[Number(example.dataset.example)].values);
      scheduleSimulation();
      return;
    }
    if (event.target.closest('[data-action="from-live"]')) copyLiveValues();
  }, { signal });

  root.addEventListener('input', (event) => {
    if (event.target.id === 'sim-level') sim.rulerCm = Number(event.target.value);
    else if (event.target.id === 'sim-soil') sim.soilPercent = Number(event.target.value);
    else return;
    scheduleSimulation();
  }, { signal });

  renderMode();
  renderSimControls();
  loadLive().then(() => {
    if (mode === MODE.SIMULATE && !signal.aborted) scheduleSimulation();
  });
  liveTimer = setInterval(loadLive, LIVE_REFRESH_MS);

  return {
    update(nextOverview) {
      overview = nextOverview;
      document.title = 'Como o alerta é decidido · Monitoramento de Enchentes';
      renderPlaces();
      setHtmlIfChanged($('#dc-sources', root), sourcesSection(overview, currentLimits()));
    },
    destroy() {
      lifecycle.abort();
      clearInterval(liveTimer);
      clearTimeout(simTimer);
    },
  };
}
