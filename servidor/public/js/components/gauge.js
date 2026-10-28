import { formatNumber, formatLimitCm } from '../format.js';

const WIDTH = 430;
const HEIGHT = 372;
const TOP_CM = 4.5;
const PLOT_TOP = 22;
const PLOT_BOTTOM = 340;
const RULER_X = 50;
const BOX_LEFT = 72;
const BOX_RIGHT = 302;
const CHANNEL_LEFT = 122;
const CHANNEL_RIGHT = 252;
const OVERFLOW_DRAW_CM = 3.95;
const WAVE_PERIOD = 120;

const yFor = (cm) => PLOT_BOTTOM - ((PLOT_BOTTOM - PLOT_TOP) * cm) / TOP_CM;

function wavePath(amplitude, offset) {
  let d = `M ${-WAVE_PERIOD} ${offset}`;
  for (let x = -WAVE_PERIOD; x < WIDTH + WAVE_PERIOD; x += WAVE_PERIOD / 2) {
    const direction = (x / (WAVE_PERIOD / 2)) % 2 === 0 ? -1 : 1;
    d += ` Q ${x + WAVE_PERIOD / 4} ${offset + direction * amplitude} ${x + WAVE_PERIOD / 2} ${offset}`;
  }
  return `${d} L ${WIDTH + WAVE_PERIOD} ${HEIGHT} L ${-WAVE_PERIOD} ${HEIGHT} Z`;
}

function rulerTicks() {
  let ticks = '';
  for (let tenth = 0; tenth <= TOP_CM * 10; tenth += 1) {
    const cm = tenth / 10;
    const isMajor = tenth % 10 === 0;
    const isMiddle = tenth % 5 === 0;
    const length = isMajor ? 12 : isMiddle ? 8 : 4;
    ticks += `<line class="tick${isMajor ? ' major' : ''}" x1="${RULER_X}" x2="${RULER_X + length}" y1="${yFor(cm)}" y2="${yFor(cm)}"/>`;
    if (isMajor) ticks += `<text class="tick-label" x="${RULER_X - 6}" y="${yFor(cm) + 4}">${cm} cm</text>`;
  }
  return ticks;
}

export function createGauge(container) {
  container.innerHTML = `
    <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="Corte da caixa com o nível da água">
      <defs>
        <linearGradient id="gauge-water" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="#60a5fa" stop-opacity="0.95"/><stop offset="1" stop-color="#1e40af" stop-opacity="0.95"/>
        </linearGradient>
        <clipPath id="gauge-water-clip">
          <rect x="${CHANNEL_LEFT}" y="${PLOT_TOP - 40}" width="${CHANNEL_RIGHT - CHANNEL_LEFT}" height="${PLOT_BOTTOM - PLOT_TOP + 40}"/>
          <rect class="clip-overflow" x="${BOX_LEFT}" y="${PLOT_TOP - 40}" width="${BOX_RIGHT - BOX_LEFT}" height="0"/>
        </clipPath>
      </defs>
      <g class="ruler">
        <line class="ruler-line" x1="${RULER_X}" x2="${RULER_X}" y1="${yFor(0)}" y2="${yFor(TOP_CM)}"/>
        ${rulerTicks()}
      </g>
      <g clip-path="url(#gauge-water-clip)">
        <g class="water-move" style="transform: translateY(${PLOT_BOTTOM}px)">
          <path class="wave-b" d="${wavePath(5, 2)}"/>
          <path class="wave-a" d="${wavePath(4, 0)}"/>
          <rect class="water-body" x="${-WAVE_PERIOD}" y="5" width="${WIDTH + 2 * WAVE_PERIOD}" height="${HEIGHT}"/>
        </g>
      </g>
      <path class="bank bank-left" d=""/>
      <path class="bank bank-right" d=""/>
      <rect class="grass grass-left" height="6" rx="3"/>
      <rect class="grass grass-right" height="6" rx="3"/>
      <rect class="bed" x="${BOX_LEFT}" width="${BOX_RIGHT - BOX_LEFT}"/>
      <path class="box-wall" d="M ${BOX_LEFT} ${yFor(TOP_CM)} V ${PLOT_BOTTOM} H ${BOX_RIGHT} V ${yFor(TOP_CM)}"/>
      <g class="limits"></g>
      <text class="dry-label" x="${(CHANNEL_LEFT + CHANNEL_RIGHT) / 2}" text-anchor="middle"></text>
      <g class="level-marker" style="transform: translateY(${PLOT_BOTTOM}px)">
        <path class="level-pointer" d="M ${RULER_X + 1} 0 l 12 -7 v 14 z"/>
        <g class="bubble">
          <rect class="level-bubble" x="${(CHANNEL_LEFT + CHANNEL_RIGHT) / 2 - 44}" y="-40" width="88" height="28" rx="14"/>
          <text class="level-text" x="${(CHANNEL_LEFT + CHANNEL_RIGHT) / 2}" y="-21" text-anchor="middle"></text>
        </g>
      </g>
    </svg>`;

  const root = container.querySelector('svg');
  const water = root.querySelector('.water-move');
  const marker = root.querySelector('.level-marker');
  const clipOverflow = root.querySelector('.clip-overflow');
  const dryLabel = root.querySelector('.dry-label');
  let lastLimitsKey = '';

  function drawTerrain(limits) {
    const bedY = yFor(limits.bed.rulerCm);
    const crestY = yFor(limits.overflow.rulerCm);
    root.querySelector('.bed').setAttribute('y', bedY);
    root.querySelector('.bed').setAttribute('height', PLOT_BOTTOM - bedY);
    root.querySelector('.bank-left').setAttribute('d', `M ${BOX_LEFT} ${bedY} V ${crestY} H ${CHANNEL_LEFT - 10} L ${CHANNEL_LEFT} ${bedY} Z`);
    root.querySelector('.bank-right').setAttribute('d', `M ${BOX_RIGHT} ${bedY} V ${crestY} H ${CHANNEL_RIGHT + 10} L ${CHANNEL_RIGHT} ${bedY} Z`);
    const grassLeft = root.querySelector('.grass-left');
    grassLeft.setAttribute('x', BOX_LEFT);
    grassLeft.setAttribute('y', crestY - 3);
    grassLeft.setAttribute('width', CHANNEL_LEFT - 10 - BOX_LEFT);
    const grassRight = root.querySelector('.grass-right');
    grassRight.setAttribute('x', CHANNEL_RIGHT + 10);
    grassRight.setAttribute('y', crestY - 3);
    grassRight.setAttribute('width', BOX_RIGHT - CHANNEL_RIGHT - 10);
    clipOverflow.setAttribute('height', crestY - (PLOT_TOP - 40));
    dryLabel.setAttribute('y', bedY - 12);

    const lines = [
      { key: 'attention', label: 'Atenção', cm: limits.attention.rulerCm, dy: 0 },
      { key: 'risk', label: 'Risco', cm: limits.risk.rulerCm, dy: 0 },
      { key: 'overflow', label: 'Transborda', cm: limits.overflow.rulerCm, dy: 0 },
    ];
    root.querySelector('.limits').innerHTML = lines.map(({ key, label, cm }) => `
      <line class="limit ${key}" x1="${BOX_LEFT}" x2="${BOX_RIGHT + 6}" y1="${yFor(cm)}" y2="${yFor(cm)}"/>
      <text class="limit-label ${key}" x="${BOX_RIGHT + 12}" y="${yFor(cm) + 4}">${label} <tspan class="value">${formatLimitCm(cm)}</tspan></text>`).join('');
  }

  function update(node) {
    const limits = node.limits;
    const level = node.latest?.level;
    if (!limits) {
      water.style.transform = `translateY(${PLOT_BOTTOM}px)`;
      marker.style.display = 'none';
      dryLabel.textContent = 'sem calibração';
      return;
    }

    const limitsKey = JSON.stringify(limits);
    if (limitsKey !== lastLimitsKey) {
      drawTerrain(limits);
      lastLimitsKey = limitsKey;
    }

    const isOverflowing = level?.kind === 'ACIMA';
    const isDry = !level || level.kind === 'ABAIXO' || node.classification?.rule === 'RIO_SECO';
    const shownCm = isOverflowing ? OVERFLOW_DRAW_CM : level && !isDry ? level.rulerCm : limits.bed.rulerCm;
    const levelY = yFor(shownCm);

    root.parentElement.classList.toggle('overflowing', isOverflowing);
    const hiddenWaterY = yFor(limits.bed.rulerCm) + 10;
    water.style.transform = `translateY(${isDry ? hiddenWaterY : levelY}px)`;
    marker.style.display = '';
    marker.style.transform = `translateY(${levelY}px)`;
    dryLabel.textContent = isDry && level ? 'rio seco' : '';
    root.querySelector('.bubble').style.display = isDry ? 'none' : '';
    root.querySelector('.level-text').textContent = isOverflowing
      ? `≥ ${formatNumber(level.rulerCm)} cm`
      : `${formatNumber(shownCm)} cm`;
  }

  return { update };
}
