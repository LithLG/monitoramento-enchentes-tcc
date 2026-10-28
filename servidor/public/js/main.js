import { html, $, setHtmlIfChanged, readStorage, writeStorage } from './dom.js';
import { api } from './api.js';
import { formatTime, formatAgo } from './format.js';
import { createOverviewView } from './views/overview.js';
import { createDetailView } from './views/detail.js';
import { createDecisionView } from './views/decision.js';
import { createSensorsView } from './views/sensors.js';
import { createSoundToggle, createAlertWatcher, toast } from './components/alerts.js';
import {
  setupDialog, openAddNodeDialog, openEditNodeDialog, openExplainDialog, openRulerAdjustDialog, openAnnotationDialog,
} from './components/dialogs.js';

const POLL_MS = 5000;
const THEME_KEY = 'painel-tema';
const page = $('#conteudo');

let view = null;
let viewRoute = null;
let lastOverview = null;
let lastError = null;
let pollTimer = null;

function navigate(hash) {
  if (location.hash === hash) renderRoute();
  else location.hash = hash;
}

function parseRoute() {
  const match = location.hash.match(/^#\/local\/(\d+)/);
  if (match) return { name: 'detail', nodeId: Number(match[1]) };
  if (location.hash.startsWith('#/decisao')) return { name: 'decision' };
  if (location.hash.startsWith('#/sensores')) return { name: 'sensors' };
  return { name: 'overview' };
}

const NAV_BY_ROUTE = { overview: 'overview', detail: 'overview', decision: 'decision', sensors: 'sensors' };

function markNavigation(route) {
  document.querySelectorAll('[data-nav]').forEach((link) => {
    const isCurrent = link.dataset.nav === NAV_BY_ROUTE[route.name];
    if (isCurrent) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function openAddNode(overview, presetId) {
  openAddNodeDialog(overview, { presetId, onCreated: () => refresh() });
}

function renderRoute() {
  const route = parseRoute();
  const routeKey = route.name === 'detail' ? `detail:${route.nodeId}` : route.name;
  markNavigation(route);
  if (routeKey === viewRoute) return;

  view?.destroy();
  viewRoute = routeKey;
  window.scrollTo({ top: 0 });
  if (route.name === 'detail') {
    view = createDetailView(page, {
      nodeId: route.nodeId,
      openEditNode: (node, overview) => openEditNodeDialog(node, overview, { onSaved: () => refresh() }),
      openExplain: (overview) => openExplainDialog(overview),
      openRulerAdjust: (node, { onDone } = {}) => openRulerAdjustDialog(node, { onDone: () => { refresh(); onDone?.(); } }),
      openAnnotation: (options) => openAnnotationDialog(options),
    });
  } else if (route.name === 'decision') {
    view = createDecisionView(page);
  } else if (route.name === 'sensors') {
    view = createSensorsView(page);
  } else {
    document.title = 'Monitoramento de Enchentes';
    view = createOverviewView(page, { navigate, openAddNode });
  }
  if (lastOverview) view.update(lastOverview);
}

function renderSystemPill(overview, error) {
  const pill = $('#system-pill');
  const label = pill.querySelector('.label');
  if (error) {
    pill.className = 'topbar-status alert';
    label.textContent = 'Sem conexão com o servidor';
    return;
  }
  const risk = overview.summary.byStatus.RISCO ?? 0;
  const attention = overview.summary.byStatus.ATENCAO ?? 0;
  if (risk) {
    pill.className = 'topbar-status alert';
    label.textContent = `Risco em ${risk} ${risk === 1 ? 'local' : 'locais'}`;
  } else if (attention) {
    pill.className = 'topbar-status warn';
    label.textContent = `Atenção em ${attention} ${attention === 1 ? 'local' : 'locais'}`;
  } else {
    pill.className = 'topbar-status ok';
    label.textContent = 'Tudo normal';
  }
}

const SERVICE_TEXT = { ONLINE: 'online', FORA_DO_AR: 'fora do ar', NAO_CONFIGURADO: 'não configurado' };

function renderFooter(overview, error) {
  const footer = $('#footer');
  if (!overview) return;
  const classifier = overview.services.classifier;
  setHtmlIfChanged(footer, html`
    <span class="svc ${error ? 'bad' : 'ok'}"><i></i>Servidor e banco ${error ? 'sem resposta' : 'ok'}</span>
    <span class="svc ${classifier === 'ONLINE' ? 'ok' : 'bad'}"><i></i>Classificador (Python) ${SERVICE_TEXT[classifier] ?? classifier}</span>
    ${overview.thresholds ? html`<span>Limiares: <strong>${overview.thresholds.name}</strong> · <a class="link" href="#/decisao">como o alerta é decidido</a></span>` : ''}
    <span>Atualizado ${error ? formatAgo(overview.generatedMs, Date.now()) : `às ${formatTime(overview.generatedMs)}`}</span>`);
}

async function refresh() {
  try {
    const overview = await api.overview();
    lastOverview = overview;
    lastError = null;
    alertWatcher.check(overview.nodes);
    if (view) view.update(overview);
    else renderRoute();
    renderSystemPill(overview);
    renderFooter(overview, null);
    const risk = overview.summary.byStatus.RISCO ?? 0;
    if (parseRoute().name === 'overview') document.title = risk ? `(${risk}) Risco · Monitoramento de Enchentes` : 'Monitoramento de Enchentes';
  } catch (error) {
    const firstError = lastError === null;
    lastError = error;
    renderSystemPill(null, error);
    renderFooter(lastOverview, error);
    if (!lastOverview) {
      page.innerHTML = String(html`<div class="card error-state"><h2>Não consegui falar com o servidor</h2>
        <p>${error.message} O painel tenta de novo a cada 5 segundos.</p></div>`);
      viewRoute = null;
      view = null;
    } else if (firstError) {
      toast({ title: 'Conexão perdida', message: 'Mostrando os últimos dados recebidos. Tentando reconectar…' });
    }
  }
}

function startClock() {
  const clock = $('#clock');
  const tick = () => { clock.textContent = formatTime(Date.now()); };
  tick();
  setInterval(tick, 1000);
}

function setupTheme() {
  $('#theme-toggle').addEventListener('click', () => {
    const current = document.documentElement.dataset.theme
      ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    writeStorage(THEME_KEY, next === 'dark' ? 'escuro' : 'claro');
    viewRoute = null;
    renderRoute();
  });
  if (!readStorage(THEME_KEY)) {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      viewRoute = null;
      renderRoute();
    });
  }
}

function setupFullscreen() {
  $('#fullscreen-toggle').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  });
}

const sound = createSoundToggle($('#sound-toggle'));
const alertWatcher = createAlertWatcher({ sound, onOpenNode: (id) => navigate(`#/local/${id}`) });

setupDialog();
setupTheme();
setupFullscreen();
startClock();
window.addEventListener('hashchange', renderRoute);
renderRoute();
refresh();
pollTimer = setInterval(refresh, POLL_MS);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refresh();
});
window.addEventListener('beforeunload', () => clearInterval(pollTimer));
