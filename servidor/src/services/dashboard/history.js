'use strict';
const { depthToRulerCm } = require('./levelGeometry');
const { READING_INTERVAL_S } = require('./timeRange');

const EVENT = Object.freeze({
  STATUS: 'CLASSE',
  WARNING_START: 'AVISO_INICIO',
  WARNING_END: 'AVISO_FIM',
  NO_SIGNAL: 'SEM_SINAL',
});

const WARNING_RULES = new Set(['RIO_SECO', 'AVISO_SOLO_CHUVA', 'TRANSBORDOU', 'ESCALADA_SOLO_CHUVA']);
const MAX_EVENTS = 200;

function worstStatus(bucket) {
  if (bucket.n_risco > 0) return 'RISCO';
  if (bucket.n_atencao > 0) return 'ATENCAO';
  if (bucket.n_normal > 0) return 'NORMAL';
  return null;
}

// In one bucket some readings can be inside the sensor range and some above it.
// The bucket shows "above" only when most readings are above, so one splash does not move the line.
function bucketLevel(bucket, geometry) {
  const mostlyAbove = bucket.above * 2 > bucket.readings;
  if (mostlyAbove) return { rulerCm: depthToRulerCm(geometry.levelRangeMm, geometry.bedHeightMm), above: true };

  const hasDepth = bucket.avg_mm !== null;
  if (hasDepth) return { rulerCm: depthToRulerCm(bucket.avg_mm, geometry.bedHeightMm), above: false };

  const isDry = bucket.below > 0;
  return { rulerCm: isDry ? depthToRulerCm(0, geometry.bedHeightMm) : null, above: false };
}

function toChartPoint(bucket, geometry) {
  const level = geometry ? bucketLevel(bucket, geometry) : { rulerCm: null, above: false };
  const toCm = (mm) => (geometry && mm !== null ? depthToRulerCm(mm, geometry.bedHeightMm) : null);
  return {
    timeMs: bucket.bucket_ms,
    readings: bucket.readings,
    rulerCm: level.rulerCm,
    minCm: toCm(bucket.min_mm),
    maxCm: toCm(bucket.max_mm),
    above: level.above,
    rainShare: bucket.readings ? Number((bucket.rainy / bucket.readings).toFixed(2)) : 0,
    soilIndex: bucket.soil_index === null ? null : Number(Number(bucket.soil_index).toFixed(3)),
    status: worstStatus(bucket),
    raw: { levelMv: Math.round(bucket.level_mv), rainMv: Math.round(bucket.rain_mv), soilMv: Math.round(bucket.soil_mv) },
  };
}

function summarize(buckets, geometry) {
  const total = (key) => buckets.reduce((sum, b) => sum + Number(b[key] ?? 0), 0);
  const classified = total('n_normal') + total('n_atencao') + total('n_risco');
  const share = (key) => (classified ? Number((total(key) / classified).toFixed(3)) : 0);

  const maxima = buckets.map((b) => b.max_mm).filter((mm) => mm !== null);
  const minima = buckets.map((b) => b.min_mm).filter((mm) => mm !== null);
  const anyAbove = buckets.some((b) => b.above > 0);
  const anyDry = buckets.some((b) => b.below > 0);
  const toCm = (mm) => (geometry ? depthToRulerCm(mm, geometry.bedHeightMm) : null);

  let maxRulerCm = maxima.length ? toCm(Math.max(...maxima)) : null;
  if (anyAbove && geometry) maxRulerCm = toCm(geometry.levelRangeMm);
  let minRulerCm = minima.length ? toCm(Math.min(...minima)) : null;
  if (anyDry && geometry) minRulerCm = toCm(0);
  const alwaysAbove = minRulerCm === null && anyAbove && geometry !== null;
  if (alwaysAbove) minRulerCm = toCm(geometry.levelRangeMm);

  return {
    readings: total('readings'),
    classified,
    statusShare: { NORMAL: share('n_normal'), ATENCAO: share('n_atencao'), RISCO: share('n_risco') },
    maxRulerCm,
    maxIsAboveSensor: anyAbove,
    minRulerCm,
    minIsAboveSensor: alwaysAbove,
    rainMinutes: Math.round((total('rainy') * READING_INTERVAL_S) / 60),
  };
}

function levelAt(row, geometry) {
  if (!geometry) return null;
  if (row.level_range === 'ACIMA') return { rulerCm: depthToRulerCm(geometry.levelRangeMm, geometry.bedHeightMm), above: true };
  if (row.level_depth_mm === null) return null;
  return { rulerCm: depthToRulerCm(row.level_depth_mm, geometry.bedHeightMm), above: false };
}

function buildEvents(rows, { gapMs, geometry }) {
  const events = [];
  let current = null;

  for (const row of rows) {
    const isGap = row.prev_time_ms !== null && row.time_ms - row.prev_time_ms > gapMs;
    if (isGap) {
      events.push({
        type: EVENT.NO_SIGNAL,
        timeMs: row.prev_time_ms,
        untilMs: row.time_ms,
        minutes: Math.round((row.time_ms - row.prev_time_ms) / 60000),
      });
    }

    const isClassified = row.status !== null;
    if (!isClassified) continue;
    if (current === null) {
      current = { status: row.status, rule: row.rule };
      continue;
    }

    const level = levelAt(row, geometry);
    const statusChanged = row.status !== current.status;
    const ruleChanged = row.rule !== current.rule;
    if (statusChanged) {
      events.push({ type: EVENT.STATUS, timeMs: row.time_ms, from: current.status, to: row.status, rule: row.rule, level });
    } else if (ruleChanged) {
      if (WARNING_RULES.has(current.rule)) events.push({ type: EVENT.WARNING_END, timeMs: row.time_ms, rule: current.rule, level });
      if (WARNING_RULES.has(row.rule)) events.push({ type: EVENT.WARNING_START, timeMs: row.time_ms, rule: row.rule, level });
    }
    current = { status: row.status, rule: row.rule };
  }

  return events.slice(-MAX_EVENTS).reverse();
}

module.exports = { EVENT, WARNING_RULES, toChartPoint, summarize, buildEvents };
