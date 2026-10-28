'use strict';

const TREND = Object.freeze({
  RISING: 'SUBINDO',
  STEADY: 'ESTAVEL',
  FALLING: 'BAIXANDO',
  OVERFLOWING: 'TRANSBORDANDO',
  UNKNOWN: 'INDEFINIDA',
});

const TREND_WINDOW_MS = 3 * 60 * 1000;
const MIN_POINTS = 5;
const MIN_SPAN_MS = 60 * 1000;
// Box 2 noise is about 0.4 mm. A slope below this value is noise, not a change of level.
const CHANGE_MM_PER_MIN = 0.5;
const MAX_FORECAST_MIN = 120;

function slopeMmPerMinute(points) {
  const xs = points.map((p) => p.timeMs / 60000);
  const ys = points.map((p) => p.depthMm);
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;

  let covariance = 0;
  let varianceX = 0;
  for (let i = 0; i < xs.length; i += 1) {
    covariance += (xs[i] - meanX) * (ys[i] - meanY);
    varianceX += (xs[i] - meanX) ** 2;
  }
  return varianceX === 0 ? 0 : covariance / varianceX;
}

function minutesUntil(limitMm, currentMm, mmPerMinute) {
  const limitIsAhead = limitMm > currentMm;
  if (!limitIsAhead) return null;
  const minutes = (limitMm - currentMm) / mmPerMinute;
  return minutes <= MAX_FORECAST_MIN ? Math.max(1, Math.round(minutes)) : null;
}

const NO_TREND = Object.freeze({ direction: TREND.UNKNOWN, mmPerMinute: null, minutesToRisk: null, minutesToOverflow: null });

function levelTrend(recentLevels, nowMs, limits) {
  const latest = recentLevels[recentLevels.length - 1];
  if (!latest) return NO_TREND;
  if (latest.levelRange === 'ACIMA') return { ...NO_TREND, direction: TREND.OVERFLOWING };

  const windowStart = nowMs - TREND_WINDOW_MS;
  const points = recentLevels
    .filter((p) => p.timeMs >= windowStart && p.depthMm !== null && p.depthMm !== undefined)
    .map((p) => ({ timeMs: p.timeMs, depthMm: Number(p.depthMm) }));

  const spanMs = points.length > 1 ? points[points.length - 1].timeMs - points[0].timeMs : 0;
  const hasEnoughData = points.length >= MIN_POINTS && spanMs >= MIN_SPAN_MS;
  if (!hasEnoughData) return NO_TREND;

  const mmPerMinute = Number(slopeMmPerMinute(points).toFixed(2));
  const currentMm = points[points.length - 1].depthMm;

  if (mmPerMinute >= CHANGE_MM_PER_MIN) {
    return {
      direction: TREND.RISING,
      mmPerMinute,
      minutesToRisk: limits ? minutesUntil(limits.risk.depthMm, currentMm, mmPerMinute) : null,
      minutesToOverflow: limits ? minutesUntil(limits.overflow.depthMm, currentMm, mmPerMinute) : null,
    };
  }
  const direction = mmPerMinute <= -CHANGE_MM_PER_MIN ? TREND.FALLING : TREND.STEADY;
  return { direction, mmPerMinute, minutesToRisk: null, minutesToOverflow: null };
}

module.exports = { TREND, TREND_WINDOW_MS, levelTrend, slopeMmPerMinute };
