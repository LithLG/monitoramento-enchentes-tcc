'use strict';

/*
 * Display only. The Python classifier decides the class; these numbers only draw the
 * limits on the screen and convert the water depth to the ruler reading of the model.
 */

const LEVEL_KIND = Object.freeze({
  INSIDE: 'DENTRO',
  ABOVE: 'ACIMA',
  BELOW: 'ABAIXO',
  NOT_CALIBRATED: 'SEM_CALIBRACAO',
});

const roundTo = (value, decimals) => Number(value.toFixed(decimals));
const depthToRulerCm = (depthMm, bedHeightMm) => roundTo((bedHeightMm + depthMm) / 10, 2);

function buildGeometry(calibration, { bedHeightMm, uncertaintyMm }) {
  if (!calibration) return null;
  return {
    bedHeightMm,
    uncertaintyMm,
    bankfullDepthMm: Number(calibration.bankfull_depth_mm),
    levelRangeMm: Number(calibration.level_range_mm),
  };
}

const nodeGeometry = (node, display) => buildGeometry(node.calibration_id === null ? null : node, display);

function rulerReading({ levelRange, levelDepthMm }, geometry) {
  const isConverted = geometry !== null && levelRange !== null && levelRange !== undefined;
  if (!isConverted) return { kind: LEVEL_KIND.NOT_CALIBRATED, depthMm: null, rulerCm: null };

  if (levelRange === LEVEL_KIND.ABOVE) {
    return { kind: LEVEL_KIND.ABOVE, depthMm: null, rulerCm: depthToRulerCm(geometry.levelRangeMm, geometry.bedHeightMm) };
  }
  if (levelRange === LEVEL_KIND.BELOW) {
    return { kind: LEVEL_KIND.BELOW, depthMm: 0, rulerCm: depthToRulerCm(0, geometry.bedHeightMm) };
  }
  return {
    kind: LEVEL_KIND.INSIDE,
    depthMm: Number(levelDepthMm),
    rulerCm: depthToRulerCm(Number(levelDepthMm), geometry.bedHeightMm),
  };
}

function limitAt(depthMm, geometry) {
  const roundedDepthMm = roundTo(depthMm, 1);
  return { depthMm: roundedDepthMm, rulerCm: depthToRulerCm(roundedDepthMm, geometry.bedHeightMm) };
}

function classLimits(thresholds, geometry) {
  if (!thresholds || !geometry) return null;

  const attentionMm = thresholds.attentionFraction * geometry.bankfullDepthMm;
  const riskMm = thresholds.riskFraction * geometry.bankfullDepthMm;
  return {
    bed: limitAt(0, geometry),
    dry: limitAt(thresholds.dryDepthMm, geometry),
    attention: limitAt(attentionMm, geometry),
    attentionExit: limitAt(attentionMm - thresholds.hysteresisMm, geometry),
    risk: limitAt(riskMm, geometry),
    riskExit: limitAt(riskMm - thresholds.hysteresisMm, geometry),
    overflow: limitAt(geometry.bankfullDepthMm, geometry),
    sensorTop: limitAt(geometry.levelRangeMm, geometry),
  };
}

module.exports = { LEVEL_KIND, buildGeometry, nodeGeometry, rulerReading, classLimits, limitAt, depthToRulerCm };
