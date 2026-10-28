// Draws the land of each zone (rural, periurban, urban) as SVG text, like the model of the authors.

export const ZONE_LABEL = { RURAL: 'Zona Rural', PERIURBANA: 'Zona Periurbana', URBANA: 'Zona Urbana' };
export const ZONE_ORDER = ['RURAL', 'PERIURBANA', 'URBANA'];

const SCENE_TOP = 52;
const RIVER_CLEARANCE = 42;
const BUILDING_COLORS = ['#f6c3d0', '#f3e2a0', '#bfe3f3', '#f6c3d0', '#c9e8d2'];

function seededRandom(seedText) {
  let seed = 0;
  for (const char of seedText) seed = (Math.imul(seed, 31) + char.charCodeAt(0)) | 0;
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Places items at random spots inside the band, away from the river and from each other.
function scatter(band, count, radius, riverYAt, random, height) {
  const spots = [];
  for (let attempt = 0; attempt < count * 40 && spots.length < count; attempt += 1) {
    const x = band.x0 + radius + random() * (band.x1 - band.x0 - 2 * radius);
    const y = SCENE_TOP + radius + random() * (height - SCENE_TOP - 2 * radius);
    const isAwayFromRiver = Math.abs(y - riverYAt(x)) > RIVER_CLEARANCE + radius;
    const isAwayFromOthers = spots.every((spot) => Math.hypot(spot.x - x, spot.y - y) > spot.r + radius + 6);
    if (isAwayFromRiver && isAwayFromOthers) spots.push({ x, y, r: radius });
  }
  return spots;
}

const tree = ({ x, y }, size = 1) => `
  <g class="z-tree" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${size.toFixed(2)})">
    <rect class="z-trunk" x="-1.6" y="4" width="3.2" height="8" rx="1"/>
    <circle class="z-canopy" r="9"/><circle class="z-canopy-light" cx="-3" cy="-3" r="4"/>
  </g>`;

const house = ({ x, y }, size = 1) => `
  <g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${size.toFixed(2)})">
    <rect class="z-wall" x="-11" y="-4" width="22" height="15" rx="1.5"/>
    <path class="z-roof" d="M -14 -3 L 0 -15 L 14 -3 Z"/>
    <rect class="z-door" x="-3" y="3" width="6" height="8" rx="1"/>
  </g>`;

const cow = ({ x, y }) => `
  <g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
    <ellipse class="z-cow" rx="9" ry="5.5"/><circle class="z-cow" cx="9" cy="-3" r="3.4"/>
    <circle class="z-cow-spot" cx="-3" cy="-1" r="2.4"/><circle class="z-cow-spot" cx="3" cy="2" r="1.6"/>
    <path class="z-cow-leg" d="M -6 4 v 5 M -2 4 v 5 M 3 4 v 5 M 6 4 v 5"/>
  </g>`;

const crop = ({ x, y }, random) => {
  const width = 46 + random() * 26;
  const height = 26 + random() * 14;
  return `<rect class="z-crop" x="${(x - width / 2).toFixed(1)}" y="${(y - height / 2).toFixed(1)}" width="${width.toFixed(1)}"
    height="${height.toFixed(1)}" rx="5" transform="rotate(${(random() * 16 - 8).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
};

function building({ x, y }, random) {
  const width = 26 + random() * 16;
  const height = 38 + random() * 30;
  const color = BUILDING_COLORS[Math.floor(random() * BUILDING_COLORS.length)];
  const left = x - width / 2;
  const top = y - height / 2;
  let windows = '';
  for (let row = top + 6; row < top + height - 8; row += 9) {
    for (let col = left + 5; col < left + width - 6; col += 8) windows += `<rect class="z-window" x="${col.toFixed(1)}" y="${row.toFixed(1)}" width="4" height="5"/>`;
  }
  return `<g><rect class="z-building-base" x="${(left - 3).toFixed(1)}" y="${(top + height - 3).toFixed(1)}" width="${(width + 6).toFixed(1)}" height="6" rx="2"/>
    <rect class="z-building" style="fill:${color}" x="${left.toFixed(1)}" y="${top.toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" rx="2"/>
    ${windows}</g>`;
}

const car = ({ x, y }) => `
  <g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
    <rect class="z-car" x="-10" y="-5" width="20" height="9" rx="4"/><rect class="z-car-glass" x="-4" y="-4" width="8" height="4" rx="1.5"/>
    <circle class="z-wheel" cx="-6" cy="5" r="2.6"/><circle class="z-wheel" cx="6" cy="5" r="2.6"/>
  </g>`;

// Picks an x inside the band that is far from the markers of the places, for roads and bridges.
function freeX(band, avoidXs, random, margin) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const x = band.x0 + (band.x1 - band.x0) * (0.2 + random() * 0.6);
    if (avoidXs.every((avoid) => Math.abs(avoid - x) > margin)) return x;
  }
  return null;
}

function ruralBand(band, riverYAt, random, height) {
  const width = band.x1 - band.x0;
  const farm = scatter(band, Math.max(1, Math.round(width / 260)), 22, riverYAt, random, height);
  const fields = scatter(band, Math.max(2, Math.round(width / 110)), 36, riverYAt, random, height)
    .filter((spot) => farm.every((f) => Math.hypot(f.x - spot.x, f.y - spot.y) > 70));
  const cows = scatter(band, Math.max(3, Math.round(width / 80)), 12, riverYAt, random, height)
    .filter((spot) => [...fields, ...farm].every((other) => Math.hypot(other.x - spot.x, other.y - spot.y) > other.r + 22));
  const trees = scatter(band, Math.round(width / 26), 11, riverYAt, random, height)
    .filter((spot) => [...fields, ...cows, ...farm].every((other) => Math.hypot(other.x - spot.x, other.y - spot.y) > other.r + 14));
  const fence = farm.map((spot) => `<path class="z-fence" d="M ${(spot.x - 40).toFixed(1)} ${(spot.y + 20).toFixed(1)} h 80"/>
       <path class="z-fence-post" d="${Array.from({ length: 9 }, (_, i) => `M ${(spot.x - 40 + i * 10).toFixed(1)} ${(spot.y + 15).toFixed(1)} v 10`).join(' ')}"/>`).join('');
  return [
    ...fields.map((spot) => crop(spot, random)),
    fence,
    ...farm.map((spot) => house(spot, 1.25)),
    ...cows.map(cow),
    ...trees.map((spot) => tree(spot, 0.85 + random() * 0.5)),
  ].join('');
}

function periurbanBand(band, riverYAt, random, height, avoidXs) {
  const roadX = freeX(band, avoidXs, random, 50);
  const road = roadX === null ? '' : `<path class="z-dirt-road" d="M ${roadX.toFixed(1)} ${SCENE_TOP} C ${(roadX - 30).toFixed(1)} 110,
    ${(roadX + 30).toFixed(1)} 150, ${roadX.toFixed(1)} ${(riverYAt(roadX) - 30).toFixed(1)}"/>`;
  const awayFromRoad = (spot, margin) => roadX === null || Math.abs(spot.x - roadX) > margin;
  const houses = scatter(band, Math.max(4, Math.round((band.x1 - band.x0) / 38)), 15, riverYAt, random, height)
    .filter((spot) => awayFromRoad(spot, 26));
  const trees = scatter(band, Math.round((band.x1 - band.x0) / 45), 10, riverYAt, random, height)
    .filter((spot) => houses.every((h) => Math.hypot(h.x - spot.x, h.y - spot.y) > 26) && awayFromRoad(spot, 20));
  return [road, ...houses.map((spot) => house(spot, 0.95 + random() * 0.25)), ...trees.map((spot) => tree(spot, 0.8))].join('');
}

function urbanBand(band, riverYAt, random, height, avoidXs) {
  const avenueY = SCENE_TOP + 26;
  const width = band.x1 - band.x0;
  const avenue = `<rect class="z-asphalt" x="${band.x0}" y="${avenueY - 9}" width="${width}" height="18"/>
    <path class="z-lane" d="M ${band.x0 + 6} ${avenueY} H ${band.x1 - 6}"/>`;
  const bridgeX = freeX(band, avoidXs, random, 70) ?? band.x0 + width * 0.5;
  const bridgeTop = riverYAt(bridgeX) - 40;
  const bridge = `<rect class="z-asphalt" x="${(bridgeX - 10).toFixed(1)}" y="${avenueY}" width="20" height="${(height - avenueY).toFixed(1)}"/>
    <rect class="z-bridge" x="${(bridgeX - 14).toFixed(1)}" y="${bridgeTop.toFixed(1)}" width="28" height="80" rx="3"/>
    <path class="z-lane" d="M ${bridgeX.toFixed(1)} ${avenueY + 12} V ${(height - 6).toFixed(1)}"/>`;
  const crosswalk = Array.from({ length: 5 }, (_, i) => `<rect class="z-crosswalk" x="${(bridgeX - 9 + i * 4).toFixed(1)}" y="${avenueY - 8}" width="2.2" height="16"/>`).join('');
  const blocks = scatter({ x0: band.x0, x1: band.x1 }, Math.max(5, Math.round(width / 30)), 22, riverYAt, random, height)
    .filter((spot) => Math.abs(spot.x - bridgeX) > 36 && spot.y - 26 > avenueY + 8);
  const cars = [{ x: band.x0 + width * (0.15 + random() * 0.2), y: avenueY }, { x: band.x0 + width * (0.65 + random() * 0.2), y: avenueY }]
    .filter((spot) => Math.abs(spot.x - bridgeX) > 24);
  return [avenue, bridge, crosswalk, ...blocks.map((spot) => building(spot, random)), ...cars.map(car)].join('');
}

const BAND_DRAWERS = { RURAL: ruralBand, PERIURBANA: periurbanBand, URBANA: urbanBand };

const ZONE_ICON = {
  RURAL: '<circle cx="0" cy="-2" r="5"/><rect x="-1" y="2" width="2" height="5"/>',
  PERIURBANA: '<path d="M -6 0 L 0 -6 L 6 0 Z"/><rect x="-4.5" y="0" width="9" height="6"/>',
  URBANA: '<rect x="-6" y="-6" width="5" height="12"/><rect x="1" y="-3" width="5" height="9"/>',
};

function zoneLabel(band) {
  const text = ZONE_LABEL[band.zone] ?? 'Sem zona';
  const width = 34 + text.length * 7.6;
  const x = (band.x0 + band.x1) / 2;
  return `<g class="z-label z-label-${band.zone ?? 'NONE'}" transform="translate(${x.toFixed(1)} 26)">
    <rect x="${(-width / 2).toFixed(1)}" y="-15" width="${width.toFixed(1)}" height="30" rx="15"/>
    <g class="z-label-icon" transform="translate(${(-width / 2 + 17).toFixed(1)} 0)">${ZONE_ICON[band.zone] ?? ''}</g>
    <text x="${(-width / 2 + 29).toFixed(1)}" y="5">${text.toUpperCase()}</text>
  </g>`;
}

// Consecutive places of the same zone share one band. A band ends half way to the next place.
export function zoneBands(placed, width) {
  if (!placed.length) return [{ zone: null, x0: 0, x1: width }];
  const bands = [];
  placed.forEach((place, index) => {
    const last = bands[bands.length - 1];
    if (last && last.zone === place.zone) return;
    const previous = placed[index - 1];
    const x0 = previous ? (previous.x + place.x) / 2 : 0;
    if (last) last.x1 = x0;
    bands.push({ zone: place.zone, x0, x1: width });
  });
  return bands;
}

export function drawZones(bands, riverYAt, height, idPrefix, markerXs = []) {
  const clipId = (index) => `${idPrefix}-band-${index}`;
  const defs = bands.map((band, index) => `<clipPath id="${clipId(index)}"><rect x="${band.x0.toFixed(1)}" y="0"
    width="${(band.x1 - band.x0).toFixed(1)}" height="${height}"/></clipPath>`).join('');
  const backgrounds = bands.map((band) => `<rect class="z-bg z-bg-${band.zone ?? 'NONE'}" x="${band.x0.toFixed(1)}" y="0"
    width="${(band.x1 - band.x0).toFixed(1)}" height="${height}"/>`).join('');
  const scenes = bands.map((band, index) => {
    const draw = BAND_DRAWERS[band.zone];
    if (!draw) return '';
    const random = seededRandom(`${band.zone}-${index}-${Math.round(band.x0)}-${Math.round(band.x1)}`);
    return `<g clip-path="url(#${clipId(index)})">${draw(band, riverYAt, random, height, markerXs)}</g>`;
  }).join('');
  const borders = bands.slice(1).map((band) => `<path class="z-border" d="M ${band.x0.toFixed(1)} 0 V ${height}"/>`).join('');
  const labels = bands.filter((band) => band.zone).map(zoneLabel).join('');
  return { defs, backgrounds, scenes, borders, labels };
}
