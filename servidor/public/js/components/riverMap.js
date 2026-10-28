import { STATUS_LABEL, levelText } from '../format.js';
import { zoneBands, drawZones } from './zoneScene.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 360;
const RIVER = 'M -60 240 C 90 168, 200 304, 340 244 S 560 140, 690 202 S 880 304, 1060 212';
const X_START = 70;
const X_END = 930;
const LABEL_ROW_BOTTOM = 46;
const MIN_TAG_WIDTH = 130;
const MAX_TAG_WIDTH = 270;
const TAG_PADDING = 14;
const TAG_HEIGHT = 56;
const TAG_GAP = 44;
const MAX_NAME_CHARS = 24;
const RIVER_SAMPLES = 600;

let mapCount = 0;

function shorten(text) {
  return text.length > MAX_NAME_CHARS ? `${text.slice(0, MAX_NAME_CHARS - 1)}…` : text;
}

function markerState(node) {
  if (node.preview) return 'preview';
  const isOffline = node.connection === 'SEM_SINAL' || node.connection === 'NUNCA_ENVIOU';
  if (isOffline) return 'offline';
  return node.classification?.status ?? 'offline';
}

function markerTexts(node, state) {
  if (state === 'preview') return { status: 'NOVO LOCAL', detail: '' };
  if (state === 'offline') return { status: node.connection === 'NUNCA_ENVIOU' ? 'AGUARDANDO DADOS' : 'SEM SINAL', detail: '' };
  const level = levelText(node.latest?.level, node.classification?.rule);
  const value = level.unit ? `${level.value} ${level.unit}` : level.value;
  return { status: (STATUS_LABEL[state] ?? '').toUpperCase(), detail: ` · ${value}` };
}

// Places without a position (before script 13) are spread evenly along the river.
function riverPositions(nodes) {
  return nodes.map((node, index) => node.riverPosition ?? ((index + 1) * 100) / (nodes.length + 1));
}

export function createRiverMap(container, { onSelect = () => {}, interactive = true } = {}) {
  mapCount += 1;
  const idPrefix = `rio${mapCount}`;
  container.innerHTML = `
    <svg viewBox="0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}" role="group" aria-label="Mapa esquemático do rio, da zona rural à zona urbana">
      <defs>
        <linearGradient id="${idPrefix}-water" x1="0" x2="1">
          <stop offset="0" stop-color="#3b82f6"/><stop offset="0.5" stop-color="#2563eb"/><stop offset="1" stop-color="#1d4ed8"/>
        </linearGradient>
        <g class="zone-defs"></g>
      </defs>
      <g class="zone-backgrounds"></g>
      <g class="zone-scenes"></g>
      <g class="zone-borders"></g>
      <path class="bank" d="${RIVER}"/>
      <path class="river-glow" d="${RIVER}"/>
      <path class="river" d="${RIVER}" stroke="url(#${idPrefix}-water)"/>
      <path class="river-flow" d="${RIVER}"/>
      <g class="zone-labels"></g>
      <g class="flow-tag" transform="translate(${VIEW_WIDTH - 16} ${VIEW_HEIGHT - 16})">
        <rect x="-176" y="-17" width="172" height="26" rx="13"/>
        <text class="flow-label" x="-90" y="1" text-anchor="middle">sentido da correnteza →</text>
      </g>
      <g class="markers"></g>
    </svg>`;

  const svg = container.querySelector('svg');
  const path = svg.querySelector('.river');
  const layer = svg.querySelector('.markers');
  const markers = new Map();
  let layoutKey = '';

  const samples = [];
  const length = path.getTotalLength();
  for (let i = 0; i <= RIVER_SAMPLES; i += 1) samples.push(path.getPointAtLength((length * i) / RIVER_SAMPLES));

  function riverYAt(x) {
    let low = 0;
    let high = samples.length - 1;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (samples[middle].x < x) low = middle;
      else high = middle;
    }
    const [a, b] = [samples[low], samples[high]];
    return b.x === a.x ? a.y : a.y + ((x - a.x) * (b.y - a.y)) / (b.x - a.x);
  }

  function drawLand(placed) {
    const key = JSON.stringify(placed.map((p) => [p.node.id, p.node.zone, Math.round(p.x)]));
    if (key === layoutKey) return;
    layoutKey = key;
    const bands = zoneBands(placed.map((p) => ({ x: p.x, zone: p.node.zone ?? null })), VIEW_WIDTH);
    const zones = drawZones(bands, riverYAt, VIEW_HEIGHT, idPrefix, placed.map((p) => p.x));
    svg.querySelector('.zone-defs').innerHTML = zones.defs;
    svg.querySelector('.zone-backgrounds').innerHTML = zones.backgrounds;
    svg.querySelector('.zone-scenes').innerHTML = zones.scenes;
    svg.querySelector('.zone-borders').innerHTML = zones.borders;
    svg.querySelector('.zone-labels').innerHTML = zones.labels;
  }

  function createMarker(nodeId) {
    const group = document.createElementNS(SVG_NS, 'g');
    if (interactive) {
      group.setAttribute('tabindex', '0');
      group.setAttribute('role', 'link');
    }
    group.innerHTML = `
      <line class="stem" x1="0" y1="0" x2="0" y2="0"/>
      <circle class="halo" r="26"/>
      <circle class="core-ring" r="14"/>
      <circle class="core" r="14"/>
      <g class="tag">
        <rect class="tag-bg" y="${-TAG_HEIGHT / 2}" height="${TAG_HEIGHT}" rx="13"/>
        <text class="tag-name" y="-5"></text>
        <text class="tag-value" y="16"><tspan class="tag-status"></tspan><tspan class="tag-detail"></tspan></text>
      </g>`;
    if (interactive) {
      const open = () => onSelect(nodeId);
      group.addEventListener('click', open);
      group.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });
    }
    layer.appendChild(group);
    return group;
  }

  function fitTag(group) {
    const name = group.querySelector('.tag-name');
    const value = group.querySelector('.tag-value');
    const textWidth = Math.max(name.getComputedTextLength(), value.getComputedTextLength());
    const width = Math.min(MAX_TAG_WIDTH, Math.max(MIN_TAG_WIDTH, textWidth + 2 * TAG_PADDING));
    const rect = group.querySelector('.tag-bg');
    rect.setAttribute('x', String(-width / 2));
    rect.setAttribute('width', String(width));
    name.setAttribute('x', String(-width / 2 + TAG_PADDING));
    value.setAttribute('x', String(-width / 2 + TAG_PADDING));
    return width;
  }

  function preferredSide(point) {
    const fitsAbove = point.y - TAG_GAP - TAG_HEIGHT > LABEL_ROW_BOTTOM;
    const fitsBelow = point.y + TAG_GAP + TAG_HEIGHT < VIEW_HEIGHT - 4;
    if (fitsAbove && fitsBelow) return point.y > VIEW_HEIGHT / 2 ? 'above' : 'below';
    return fitsAbove ? 'above' : 'below';
  }

  // Close neighbours put their tags on opposite sides of the river, so the tags do not cover each other.
  function chooseSides(placed) {
    let previous = null;
    for (const place of placed) {
      let side = preferredSide(place);
      const overlapsPrevious = previous && previous.side === side
        && Math.abs(place.x - previous.x) < (place.tagWidth + previous.tagWidth) / 2 + 8;
      if (overlapsPrevious) side = side === 'above' ? 'below' : 'above';
      place.side = side;
      previous = place;
    }
  }

  function placeMarker(group, place) {
    const above = place.side === 'above';
    const tagY = above ? -(TAG_GAP + TAG_HEIGHT / 2) : TAG_GAP + TAG_HEIGHT / 2;
    const minX = place.tagWidth / 2 + 8 - place.x;
    const maxX = VIEW_WIDTH - place.tagWidth / 2 - 8 - place.x;
    const tagX = Math.min(maxX, Math.max(minX, 0));
    group.setAttribute('transform', `translate(${place.x.toFixed(1)} ${place.y.toFixed(1)})`);
    group.querySelector('.tag').setAttribute('transform', `translate(${tagX.toFixed(1)} ${tagY})`);
    const stem = group.querySelector('.stem');
    stem.setAttribute('x2', tagX.toFixed(1));
    stem.setAttribute('y2', String(above ? tagY + TAG_HEIGHT / 2 : tagY - TAG_HEIGHT / 2));
  }

  function update(nodes) {
    const visibleIds = new Set(nodes.map((node) => node.id));
    for (const [nodeId, group] of markers) {
      if (!visibleIds.has(nodeId)) {
        group.remove();
        markers.delete(nodeId);
      }
    }

    const positions = riverPositions(nodes);
    const placed = nodes.map((node, index) => {
      const x = X_START + (positions[index] / 100) * (X_END - X_START);
      return { node, x, y: riverYAt(x) };
    });
    drawLand(placed);

    for (const place of placed) {
      const { node } = place;
      const group = markers.get(node.id) ?? createMarker(node.id);
      markers.set(node.id, group);
      const state = markerState(node);
      const texts = markerTexts(node, state);
      group.setAttribute('class', `marker ${state}`);
      group.querySelector('.tag-name').textContent = shorten(node.name || 'Novo local');
      group.querySelector('.tag-status').textContent = texts.status;
      group.querySelector('.tag-detail').textContent = texts.detail;
      if (interactive) group.setAttribute('aria-label', `${node.name}: ${texts.status.toLowerCase()}${texts.detail}. Abrir histórico.`);
      place.group = group;
      place.tagWidth = fitTag(group);
    }
    chooseSides(placed);
    placed.forEach((place) => placeMarker(place.group, place));
  }

  return { update };
}
