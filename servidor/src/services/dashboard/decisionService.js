'use strict';
const { NotReadyError, NotFoundError, ValidationError } = require('../../errors');
const { ClassifierOutdatedError } = require('../classifierClient');
const { nodeGeometry, rulerReading, limitAt } = require('./levelGeometry');
const { inRiverOrder } = require('./riverOrder');

const RAIN_CLASS = Object.freeze({ DRY: 'SECO', RAIN: 'CHUVA' });
const LEVEL_RANGE = Object.freeze({ INSIDE: 'DENTRO', ABOVE: 'ACIMA' });

const roundTo1 = (value) => Math.round(value * 10) / 10;

function toTreeInput({ levelRange, levelDepthMm, bankfullDepthMm, rainClass, soilIndex, previousStatus }) {
  return {
    level_range: levelRange,
    level_depth_mm: levelDepthMm,
    bankfull_depth_mm: bankfullDepthMm,
    rain_class: rainClass,
    soil_index: soilIndex,
    previous_status: previousStatus,
  };
}

function rulerLimits(limitsMm, geometry) {
  return {
    bed: limitAt(0, geometry),
    dry: limitAt(limitsMm.dry, geometry),
    attention: limitAt(limitsMm.attention, geometry),
    attentionExit: limitAt(limitsMm.attentionExit, geometry),
    risk: limitAt(limitsMm.risk, geometry),
    riskExit: limitAt(limitsMm.riskExit, geometry),
    overflow: limitAt(limitsMm.bankfull, geometry),
    sensorTop: limitAt(geometry.levelRangeMm, geometry),
  };
}

function describe(node, geometry, inputs, explanation) {
  return {
    node: { id: node.id, name: node.name, zone: node.zone ?? null },
    inputs: {
      level: rulerReading({ levelRange: inputs.levelRange, levelDepthMm: inputs.levelDepthMm }, geometry),
      raining: inputs.rainClass !== RAIN_CLASS.DRY,
      soilIndex: inputs.soilIndex,
      previousStatus: inputs.previousStatus,
    },
    steps: {
      byLevel: explanation.byLevel,
      previousWasHigher: explanation.previousWasHigher,
      afterHysteresis: explanation.afterHysteresis,
      isRaining: explanation.isRaining,
      soilIsSaturated: explanation.soilIsSaturated,
      final: explanation.final,
    },
    soilSaturatedIndex: explanation.soilSaturatedIndex,
    limits: rulerLimits(explanation.limitsMm, geometry),
    thresholdSetId: explanation.thresholdSetId,
  };
}

/*
 * The panel only shows the path. The Python classifier walks the tree and gives the result of each step,
 * so the decision rules stay in one place.
 */
function createDecisionService({ dashboardRepository, nodeRepository, classifierClient, display, now = Date.now }) {
  async function explain(inputs) {
    if (!classifierClient) throw new NotReadyError('o classificador (Python) não está configurado: confira PYTHON_URL no .env');
    try {
      return await classifierClient.explain(toTreeInput(inputs));
    } catch (error) {
      if (error instanceof ClassifierOutdatedError) {
        throw new NotReadyError('reinicie o sistema (iniciar_sistema.bat) para o Python mostrar o caminho da árvore');
      }
      throw new NotReadyError(`o classificador (Python) não respondeu: ${error.message}`);
    }
  }

  async function livePlace(node, row) {
    const geometry = nodeGeometry(node, display);
    const basics = { node: { id: node.id, name: node.name, zone: node.zone ?? null } };
    if (!row || !geometry) return { ...basics, ready: false };

    const inputs = {
      levelRange: row.level_range,
      levelDepthMm: row.level_depth_mm === null ? null : Number(row.level_depth_mm),
      bankfullDepthMm: Number(row.bankfull_depth_mm),
      rainClass: row.rain_class,
      soilIndex: Number(row.soil_index),
      previousStatus: row.previous_status ?? null,
    };
    return {
      ...describe(node, geometry, inputs, await explain(inputs)),
      ready: true,
      reading: { id: row.reading_id, timeMs: Number(row.time_ms), levelMv: row.level_mv },
      stored: { status: row.status, rule: row.rule },
    };
  }

  async function live() {
    const [nodes, rows] = await Promise.all([
      nodeRepository.listWithCalibration(),
      dashboardRepository.latestClassifiedInputs(),
    ]);
    const rowByNode = new Map(rows.map((row) => [row.node_id, row]));
    const places = await Promise.all(inRiverOrder(nodes).map((node) => livePlace(node, rowByNode.get(node.id))));
    return { generatedMs: now(), places };
  }

  async function simulate({ nodeId, rulerCm, raining, soilIndex, previousStatus }) {
    const node = await nodeRepository.findById(nodeId);
    if (!node) throw new NotFoundError(`local ${nodeId} não encontrado`);
    const geometry = nodeGeometry(node, display);
    if (!geometry) throw new ValidationError('este local ainda não tem calibração');

    const depthMm = Math.max(0, roundTo1(rulerCm * 10 - geometry.bedHeightMm));
    const isAboveSensor = depthMm > geometry.levelRangeMm;
    const inputs = {
      levelRange: isAboveSensor ? LEVEL_RANGE.ABOVE : LEVEL_RANGE.INSIDE,
      levelDepthMm: isAboveSensor ? null : depthMm,
      bankfullDepthMm: geometry.bankfullDepthMm,
      rainClass: raining ? RAIN_CLASS.RAIN : RAIN_CLASS.DRY,
      soilIndex,
      previousStatus,
    };
    return { ...describe(node, geometry, inputs, await explain(inputs)), rulerCm };
  }

  return { live, simulate };
}

module.exports = { createDecisionService, toTreeInput };
