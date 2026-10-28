'use strict';
const { ValidationError } = require('../../errors');

const MAX_SHIFT_MV = 300;
const MIN_READINGS = 3;

const sortedByDepth = (curve) => [...curve].map(([mv, mm]) => [Number(mv), Number(mm)]).sort((a, b) => a[1] - b[1]);

function lineAt(depthMm, [mvA, mmA], [mvB, mmB]) {
  return mvA + ((depthMm - mmA) * (mvB - mvA)) / (mmB - mmA);
}

function segmentAround(depthMm, points) {
  for (let i = 0; i < points.length - 1; i += 1) {
    if (depthMm <= points[i + 1][1]) return [points[i], points[i + 1]];
  }
  return [points[points.length - 2], points[points.length - 1]];
}

// The first segment joins the dry point to the first point with water. The sensor is not linear there,
// so a depth inside that segment uses the slope of the next segment.
function expectedMvAt(depthMm, points) {
  if (depthMm <= points[0][1]) return points[0][0];
  const isInFirstSegment = points.length > 2 && depthMm < points[1][1];
  const [a, b] = isInFirstSegment ? [points[1], points[2]] : segmentAround(depthMm, points);
  return lineAt(depthMm, a, b);
}

function isMonotonic(points) {
  const direction = Math.sign(points[points.length - 1][0] - points[0][0]);
  return points.every((point, i) => i === 0 || Math.sign(point[0] - points[i - 1][0]) === direction);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function sensorValueNow(recentMv) {
  if (recentMv.length < MIN_READINGS) {
    throw new ValidationError('o sensor precisa estar enviando leituras (pelo menos 3 no último minuto)');
  }
  return Math.round(median(recentMv));
}

function rulerToDepthMm(rulerCm, geometry) {
  const depthMm = Math.round((rulerCm * 10 - geometry.bedHeightMm) * 10) / 10;
  const isInsideSensorRange = depthMm >= 0 && depthMm <= geometry.levelRangeMm;
  if (!isInsideSensorRange) {
    const minCm = geometry.bedHeightMm / 10;
    const maxCm = (geometry.bedHeightMm + geometry.levelRangeMm) / 10;
    throw new ValidationError(`a régua precisa marcar entre ${String(minCm).replace('.', ',')} e ${String(maxCm).replace('.', ',')} cm`);
  }
  return depthMm;
}

// Shifts the whole curve so that the sensor value now gives the depth read on the ruler.
// The ruler point is also added when it falls between the dry point and the first point with water.
function adjustCurve(curve, depthMm, sensorMv) {
  const points = sortedByDepth(curve);
  const expectedMv = expectedMvAt(depthMm, points);
  const shiftMv = Math.round(sensorMv - expectedMv);
  if (Math.abs(shiftMv) > MAX_SHIFT_MV) {
    throw new ValidationError(`a diferença ficou grande demais (${shiftMv} mV). Confira a régua e o sensor`);
  }

  const shifted = points.map(([mv, mm]) => [mv + shiftMv, mm]);
  const isInFirstSegment = depthMm > shifted[0][1] && depthMm < shifted[1][1];
  const adjusted = isInFirstSegment ? [shifted[0], [sensorMv, depthMm], ...shifted.slice(1)] : shifted;
  if (!isMonotonic(adjusted)) throw new ValidationError('o ajuste deixaria a curva do sensor inválida. Confira a régua');

  return { expectedMv: Math.round(expectedMv), shiftMv, curve: adjusted };
}

module.exports = { adjustCurve, expectedMvAt, sensorValueNow, rulerToDepthMm, MAX_SHIFT_MV };
