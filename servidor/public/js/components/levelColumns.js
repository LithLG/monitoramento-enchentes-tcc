import { html, setHtmlIfChanged } from '../dom.js';
import { formatNumber, formatLimitCm, STATUS_LABEL } from '../format.js';

const TOP_CM = 4.4;
const PLOT_TOP = 18;
const PLOT_BOTTOM = 268;
const LEFT = 52;
const COLUMN_WIDTH = 50;
const COLUMN_GAP = 46;
const LABEL_SPACE = 132;
const HEIGHT = 322;

const yFor = (cm) => PLOT_BOTTOM - ((PLOT_BOTTOM - PLOT_TOP) * Math.min(cm, TOP_CM)) / TOP_CM;

function displayedCm(node) {
  const level = node.latest?.level;
  if (!level || level.kind === 'SEM_CALIBRACAO') return null;
  return level.rulerCm;
}

function valueLabel(node) {
  const level = node.latest?.level;
  if (!level || level.kind === 'SEM_CALIBRACAO') return 'sem dados';
  if (level.kind === 'ACIMA') return `≥ ${formatNumber(level.rulerCm)} cm`;
  const isDry = level.kind === 'ABAIXO' || node.classification?.rule === 'RIO_SECO';
  return isDry ? 'seco' : `${formatNumber(level.rulerCm)} cm`;
}

const MAX_NAME_CHARS = 11;
const STATUS_COLOR_VAR = { NORMAL: '--normal-line', ATENCAO: '--attention-line', RISCO: '--risk-line' };
const shorten = (text) => (text.length > MAX_NAME_CHARS ? `${text.slice(0, MAX_NAME_CHARS - 1)}…` : text);

function limitLines(limits, width) {
  if (!limits) return [];
  const lines = [
    { key: 'attention', label: 'Atenção', cm: limits.attention.rulerCm },
    { key: 'risk', label: 'Risco', cm: limits.risk.rulerCm },
    { key: 'overflow', label: 'Transborda', cm: limits.overflow.rulerCm },
  ];
  return lines.map(({ key, label, cm }) => html`
    <line class="limit ${key}" x1="${LEFT}" x2="${width - LABEL_SPACE + 6}" y1="${yFor(cm)}" y2="${yFor(cm)}"/>
    <text class="limit-label ${key}" x="${width - LABEL_SPACE + 12}" y="${yFor(cm) + 4}">${label} ${formatLimitCm(cm)}</text>`);
}

function axis(width) {
  const ticks = [];
  for (let cm = 0; cm <= 4; cm += 1) {
    ticks.push(html`
      <line class="grid-line" x1="${LEFT}" x2="${width - LABEL_SPACE + 6}" y1="${yFor(cm)}" y2="${yFor(cm)}"/>
      <text class="axis-label" x="${LEFT - 10}" y="${yFor(cm) + 4}" text-anchor="end">${cm} cm</text>`);
  }
  return ticks;
}

function column(node, index, bedCm) {
  const x = LEFT + COLUMN_GAP / 2 + index * (COLUMN_WIDTH + COLUMN_GAP);
  const levelCm = displayedCm(node);
  const waterTop = levelCm === null ? PLOT_BOTTOM : yFor(Math.max(levelCm, bedCm));
  const waterHeight = Math.max(0, yFor(bedCm) - waterTop);
  const status = node.classification?.status;
  const labelY = Math.min(waterTop, yFor(bedCm)) - 9;
  return html`
    <g class="col" data-node-id="${node.id}" tabindex="0" role="link" aria-label="${node.name}: ${valueLabel(node)}">
      <rect class="tube" x="${x}" y="${PLOT_TOP}" width="${COLUMN_WIDTH}" height="${PLOT_BOTTOM - PLOT_TOP}" rx="10"/>
      <rect class="water" x="${x + 3}" y="${waterTop}" width="${COLUMN_WIDTH - 6}" height="${waterHeight}"
        style="y:${waterTop}px;height:${waterHeight}px"/>
      <rect class="bed" x="${x + 3}" y="${yFor(bedCm)}" width="${COLUMN_WIDTH - 6}" height="${PLOT_BOTTOM - yFor(bedCm) - 3}" rx="0"/>
      <text class="col-value" x="${x + COLUMN_WIDTH / 2}" y="${Math.max(PLOT_TOP + 14, labelY)}" text-anchor="middle">${valueLabel(node)}</text>
      <text class="col-name" x="${x + COLUMN_WIDTH / 2}" y="${PLOT_BOTTOM + 22}" text-anchor="middle">${shorten(node.name)}</text>
      <circle cx="${x + COLUMN_WIDTH / 2 - 26}" cy="${PLOT_BOTTOM + 40}" r="4.5" style="fill:var(${STATUS_COLOR_VAR[status] ?? '--offline'})"/>
      <text class="axis-label" x="${x + COLUMN_WIDTH / 2 - 18}" y="${PLOT_BOTTOM + 44}">${STATUS_LABEL[status] ?? 'Sem classe'}</text>
    </g>`;
}

export function createLevelColumns(container, { onSelect }) {
  container.addEventListener('click', (event) => {
    const target = event.target.closest('[data-node-id]');
    if (target) onSelect(Number(target.dataset.nodeId));
  });
  container.addEventListener('keydown', (event) => {
    const target = event.target.closest('[data-node-id]');
    if (target && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      onSelect(Number(target.dataset.nodeId));
    }
  });

  function update(nodes) {
    const reference = nodes.find((node) => node.limits);
    const bedCm = reference ? reference.limits.bed.rulerCm : 1;
    const width = LEFT + nodes.length * (COLUMN_WIDTH + COLUMN_GAP) + LABEL_SPACE;
    const svg = html`
      <svg viewBox="0 0 ${Math.max(width, 380)} ${HEIGHT}" role="group" aria-label="Comparativo do nível de cada local na régua">
        <defs>
          <linearGradient id="col-water" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stop-color="#60a5fa"/><stop offset="1" stop-color="#1d4ed8"/>
          </linearGradient>
        </defs>
        ${axis(width)}
        ${nodes.map((node, index) => column(node, index, bedCm))}
        ${limitLines(reference?.limits, width)}
      </svg>`;
    setHtmlIfChanged(container, svg);
  }

  return { update };
}
