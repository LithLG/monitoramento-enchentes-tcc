'use strict';
const { rulerReading } = require('./levelGeometry');

const roundTo1 = (value) => Math.round(value * 10) / 10;

// Positive error: the sensor shows more water than the ruler. Outside the sensor range there is no number to compare.
function sensorErrorMm({ sensorRange, sensorDepthMm, rulerDepthMm }) {
  if (sensorRange !== 'DENTRO' || sensorDepthMm === null) return null;
  return roundTo1(sensorDepthMm - rulerDepthMm);
}

function rulerErrorSummary(checks) {
  const errors = checks.map(sensorErrorMm).filter((error) => error !== null);
  if (errors.length === 0) {
    return { checks: checks.length, compared: 0, meanErrorMm: null, meanAbsErrorMm: null, maxAbsErrorMm: null };
  }
  const sum = (values) => values.reduce((total, value) => total + value, 0);
  const absolute = errors.map(Math.abs);
  return {
    checks: checks.length,
    compared: errors.length,
    meanErrorMm: roundTo1(sum(errors) / errors.length),
    meanAbsErrorMm: roundTo1(sum(absolute) / absolute.length),
    maxAbsErrorMm: roundTo1(Math.max(...absolute)),
  };
}

// Adds what the screen needs: the error and the sensor value in ruler centimeters.
function describeCheck(check, geometry) {
  const sensor = rulerReading({ levelRange: check.sensorRange, levelDepthMm: check.sensorDepthMm }, geometry);
  return { ...check, errorMm: sensorErrorMm(check), sensorRulerCm: sensor.rulerCm };
}

module.exports = { sensorErrorMm, rulerErrorSummary, describeCheck };
