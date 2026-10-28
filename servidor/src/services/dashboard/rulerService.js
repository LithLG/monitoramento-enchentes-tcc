'use strict';
const { ValidationError, NotFoundError, NotReadyError } = require('../../errors');
const { convertLevel } = require('../conversion');
const { nodeGeometry, rulerReading } = require('./levelGeometry');
const { adjustCurve, sensorValueNow, rulerToDepthMm } = require('./rulerAdjustment');
const { sensorErrorMm } = require('./rulerChecks');
const { localDateTime } = require('./csv');

const SENSOR_NOW_WINDOW_MS = 60 * 1000;

const cmText = (value) => String(value).replace('.', ',');

/*
 * The ruler is the reference. A measurement compares it with the sensor now; an adjustment
 * also shifts the sensor curve (new calibration). Both are kept for the error in the article.
 */
function createRulerService({
  nodeRepository,
  dashboardRepository,
  fieldNotesRepository,
  display,
  now = Date.now,
  onCalibrationChanged = () => {},
}) {
  async function requireCalibratedNode(nodeId) {
    const node = await nodeRepository.findById(nodeId);
    if (!node) throw new NotFoundError(`local ${nodeId} não encontrado`);
    if (node.calibration_id === null) throw new ValidationError('este local ainda não tem calibração');
    return node;
  }

  async function measure(nodeId, rulerCm) {
    const node = await requireCalibratedNode(nodeId);
    const geometry = nodeGeometry(node, display);
    const tipMm = Number(node.sensor_tip_above_bed_mm);
    const rulerDepthMm = rulerToDepthMm(rulerCm, geometry);
    const sensorMv = sensorValueNow(await dashboardRepository.recentLevelMv(nodeId, now() - SENSOR_NOW_WINDOW_MS));
    const levelWith = (curve) => {
      const converted = convertLevel(sensorMv, curve, tipMm);
      return rulerReading({ levelRange: converted.levelRange, levelDepthMm: converted.levelDepthMm }, geometry);
    };
    const sensor = levelWith(node.level_curve);
    return { node, tipMm, rulerDepthMm, sensorMv, sensor, levelWith };
  }

  function adjustmentFor(measurement) {
    if (measurement.rulerDepthMm < measurement.tipMm) {
      return { adjustment: null, problem: 'para ajustar, a água precisa estar acima da ponta do sensor' };
    }
    try {
      const shifted = adjustCurve(measurement.node.level_curve, measurement.rulerDepthMm - measurement.tipMm, measurement.sensorMv);
      return { adjustment: { shiftMv: shifted.shiftMv, curve: shifted.curve }, problem: null };
    } catch (error) {
      if (error instanceof ValidationError) return { adjustment: null, problem: error.message };
      throw error;
    }
  }

  const toCheck = (measurement, rulerCm, adjusted) => ({
    nodeId: measurement.node.id,
    rulerCm,
    rulerDepthMm: measurement.rulerDepthMm,
    sensorMv: measurement.sensorMv,
    sensorRange: measurement.sensor.kind,
    sensorDepthMm: measurement.sensor.kind === 'DENTRO' ? measurement.sensor.depthMm : null,
    calibrationId: measurement.node.calibration_id,
    adjusted,
  });

  async function plan(nodeId, rulerCm) {
    const measurement = await measure(nodeId, rulerCm);
    const { adjustment, problem } = adjustmentFor(measurement);
    return {
      nodeId,
      rulerCm,
      rulerDepthMm: measurement.rulerDepthMm,
      sensorMv: measurement.sensorMv,
      errorMm: sensorErrorMm(toCheck(measurement, rulerCm, false)),
      before: { curve: measurement.node.level_curve, level: measurement.sensor },
      after: adjustment ? { curve: adjustment.curve, level: measurement.levelWith(adjustment.curve) } : null,
      shiftMv: adjustment?.shiftMv ?? null,
      adjustProblem: problem,
      canRecord: await fieldNotesRepository.checkReady(),
    };
  }

  async function record(nodeId, rulerCm) {
    const measurement = await measure(nodeId, rulerCm);
    const check = toCheck(measurement, rulerCm, false);
    const id = await fieldNotesRepository.addRulerCheck(check);
    return { id, ...check, errorMm: sensorErrorMm(check) };
  }

  async function adjust(nodeId, rulerCm) {
    const measurement = await measure(nodeId, rulerCm);
    const { adjustment, problem } = adjustmentFor(measurement);
    if (!adjustment) throw new ValidationError(problem);

    const notes = `Ajuste pela regua no painel ${localDateTime(now())}: regua ${cmText(rulerCm)} cm = `
      + `${measurement.sensorMv} mV (curva deslocada ${adjustment.shiftMv} mV).`;
    const calibrationId = await nodeRepository.replaceLevelCurve(nodeId, { levelCurve: adjustment.curve, notes });
    onCalibrationChanged(nodeId);

    const check = toCheck(measurement, rulerCm, true);
    let checkRecorded = true;
    try {
      await fieldNotesRepository.addRulerCheck(check);
    } catch (error) {
      if (!(error instanceof NotReadyError)) throw error;
      checkRecorded = false;
    }
    return {
      nodeId,
      rulerCm,
      sensorMv: measurement.sensorMv,
      shiftMv: adjustment.shiftMv,
      errorMm: sensorErrorMm(check),
      calibrationId,
      checkRecorded,
      after: { curve: adjustment.curve, level: measurement.levelWith(adjustment.curve) },
    };
  }

  async function remove(checkId) {
    const removed = await fieldNotesRepository.removeRulerCheck(checkId);
    if (!removed) throw new NotFoundError(`medida ${checkId} não encontrada`);
  }

  return { plan, record, adjust, remove };
}

module.exports = { createRulerService };
