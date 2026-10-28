'use strict';

const LEVEL_RANGE = Object.freeze({ BELOW: 'ABAIXO', INSIDE: 'DENTRO', ABOVE: 'ACIMA' });
const RAIN_CLASS = Object.freeze({ DRY: 'SECO', RAIN: 'CHUVA', HEAVY: 'CHUVA_INTENSA' });
const SOIL_INDEX_COLUMN_LIMIT = 9.999;

const round = (value, decimals) => Number(value.toFixed(decimals));

function interpolate(mv, [mv0, mm0], [mv1, mm1]) {
  const isVerticalSegment = mv1 === mv0;
  if (isVerticalSegment) return mm1;
  return mm0 + ((mv - mv0) * (mm1 - mm0)) / (mv1 - mv0);
}

// Outside the calibration curve the sensor only tells "below" or "above". The depth is unknown.
// The capacitive sensor gives LOWER mV with more water. Signed mV makes every curve rise with depth.
function convertLevel(mv, curve, sensorTipAboveBedMm) {
  const byDepth = [...curve].sort((a, b) => a[1] - b[1]);
  const mvRisesWithWater = byDepth[byDepth.length - 1][0] > byDepth[0][0];
  const direction = mvRisesWithWater ? 1 : -1;
  const points = byDepth.map(([pointMv, mm]) => [direction * pointMv, mm]);
  const signedMv = direction * mv;

  if (signedMv < points[0][0]) return { levelRange: LEVEL_RANGE.BELOW, levelDepthMm: null };
  if (signedMv > points[points.length - 1][0]) return { levelRange: LEVEL_RANGE.ABOVE, levelDepthMm: null };

  const segmentEnd = points.findIndex(([pointMv], i) => i > 0 && signedMv <= pointMv);
  const sensorMm = interpolate(signedMv, points[segmentEnd - 1], points[segmentEnd]);
  return { levelRange: LEVEL_RANGE.INSIDE, levelDepthMm: round(sensorTipAboveBedMm + sensorMm, 1) };
}

function classifyRain(mv, wetBelowMv, heavyBelowMv) {
  const hasHeavyLimit = heavyBelowMv !== null && heavyBelowMv !== undefined;
  const isHeavyRain = hasHeavyLimit && mv < heavyBelowMv;
  if (isHeavyRain) return RAIN_CLASS.HEAVY;
  if (mv < wetBelowMv) return RAIN_CLASS.RAIN;
  return RAIN_CLASS.DRY;
}

function soilIndex(mv, dryMv, saturatedMv) {
  const index = (dryMv - mv) / (dryMv - saturatedMv);
  const clamped = Math.max(-SOIL_INDEX_COLUMN_LIMIT, Math.min(SOIL_INDEX_COLUMN_LIMIT, index));
  return round(clamped, 3);
}

const NOT_CONVERTED = Object.freeze({
  calibrationId: null,
  levelRange: null,
  levelDepthMm: null,
  rainClass: null,
  soilIndex: null,
});

function convertReading(reading, calibration) {
  if (!calibration) return NOT_CONVERTED;

  const level = convertLevel(reading.level_mv, calibration.level_curve, Number(calibration.sensor_tip_above_bed_mm));
  return {
    calibrationId: calibration.id,
    ...level,
    rainClass: classifyRain(reading.rain_mv, calibration.rain_wet_below_mv, calibration.rain_heavy_below_mv),
    soilIndex: soilIndex(reading.soil_mv, calibration.soil_dry_mv, calibration.soil_saturated_mv),
  };
}

module.exports = {
  LEVEL_RANGE,
  RAIN_CLASS,
  convertLevel,
  classifyRain,
  soilIndex,
  convertReading,
};
