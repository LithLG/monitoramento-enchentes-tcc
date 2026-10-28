'use strict';
const { ValidationError } = require('../../errors');

const NODE_ID_MIN = 1;
const NODE_ID_MAX = 255;
const NAME_MAX = 50;
const DESCRIPTION_MAX = 255;
const ZONES = Object.freeze(['RURAL', 'PERIURBANA', 'URBANA']);
const RIVER_POSITION_MIN = 0;
const RIVER_POSITION_MAX = 100;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function parseNodeId(raw, field = 'id') {
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  const isValidId = Number.isInteger(value) && value >= NODE_ID_MIN && value <= NODE_ID_MAX;
  if (!isValidId) throw new ValidationError(`"${field}" deve ser um número inteiro de ${NODE_ID_MIN} a ${NODE_ID_MAX}`);
  return value;
}

function parseName(raw) {
  const name = typeof raw === 'string' ? raw.trim() : '';
  const hasValidLength = name.length >= 1 && name.length <= NAME_MAX;
  if (!hasValidLength) throw new ValidationError(`o nome do local é obrigatório (até ${NAME_MAX} caracteres)`);
  return name;
}

function parseDescription(raw) {
  const isEmpty = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
  if (isEmpty) return null;
  if (typeof raw !== 'string' || raw.trim().length > DESCRIPTION_MAX) {
    throw new ValidationError(`a descrição deve ter até ${DESCRIPTION_MAX} caracteres`);
  }
  return raw.trim();
}

const isBlank = (value) => value === undefined || value === null || value === '';

function parseZone(raw) {
  if (isBlank(raw)) return null;
  if (!ZONES.includes(raw)) throw new ValidationError('a zona deve ser RURAL, PERIURBANA ou URBANA');
  return raw;
}

function parseRiverPosition(raw) {
  if (isBlank(raw)) return null;
  const value = Number(raw);
  const isInRange = Number.isFinite(value) && value >= RIVER_POSITION_MIN && value <= RIVER_POSITION_MAX;
  if (!isInRange) throw new ValidationError(`a posição no rio deve ser um número de ${RIVER_POSITION_MIN} a ${RIVER_POSITION_MAX}`);
  return Math.round(value * 100) / 100;
}

function parseRulerCm(raw) {
  const value = Number(String(raw ?? '').trim().replace(',', '.'));
  const isPositiveNumber = Number.isFinite(value) && value > 0 && String(raw ?? '').trim() !== '';
  if (!isPositiveNumber) throw new ValidationError('informe quanto a régua marca, em cm (por exemplo 2,0)');
  return Math.round(value * 100) / 100;
}

const ANNOTATION_MAX = 140;
const ANNOTATION_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const ANNOTATION_MAX_AGE_MS = 366 * 24 * 60 * 60 * 1000;
const STATUSES = Object.freeze(['NORMAL', 'ATENCAO', 'RISCO']);
const SIMULATION_RULER_MAX_CM = 10;

function parseRecordId(raw, label) {
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (!Number.isInteger(value) || value < 1) throw new ValidationError(`${label} inválido`);
  return value;
}

function parseAnnotation(body, nowMs) {
  if (!isPlainObject(body)) throw new ValidationError('o corpo da requisição deve ser um objeto JSON');
  const text = typeof body.text === 'string' ? body.text.trim().replace(/\s+/g, ' ') : '';
  const hasValidLength = text.length >= 1 && text.length <= ANNOTATION_MAX;
  if (!hasValidLength) throw new ValidationError(`escreva a anotação (até ${ANNOTATION_MAX} caracteres)`);

  const timeMs = isBlank(body.timeMs) ? nowMs : Number(body.timeMs);
  const isPlausibleTime = Number.isFinite(timeMs)
    && timeMs <= nowMs + ANNOTATION_FUTURE_TOLERANCE_MS && timeMs >= nowMs - ANNOTATION_MAX_AGE_MS;
  if (!isPlausibleTime) throw new ValidationError('a hora da anotação deve ser agora ou no passado (até 1 ano)');

  return {
    nodeId: isBlank(body.nodeId) ? null : parseNodeId(body.nodeId, 'nodeId'),
    timeMs: Math.round(timeMs),
    text,
  };
}

function parseSimulation(body) {
  if (!isPlainObject(body)) throw new ValidationError('o corpo da requisição deve ser um objeto JSON');
  const rulerCm = parseRulerCm(body.rulerCm);
  if (rulerCm > SIMULATION_RULER_MAX_CM) throw new ValidationError(`o nível simulado deve ser até ${SIMULATION_RULER_MAX_CM} cm`);

  const soilPercent = Number(body.soilPercent);
  const isValidSoil = Number.isFinite(soilPercent) && soilPercent >= 0 && soilPercent <= 100;
  if (!isValidSoil) throw new ValidationError('o solo simulado deve ser de 0 a 100%');

  const previousStatus = isBlank(body.previousStatus) ? null : body.previousStatus;
  if (previousStatus !== null && !STATUSES.includes(previousStatus)) {
    throw new ValidationError('a classe anterior deve ser NORMAL, ATENCAO ou RISCO');
  }
  if (typeof body.raining !== 'boolean') throw new ValidationError('informe se está chovendo (true ou false)');

  return {
    nodeId: parseNodeId(body.nodeId, 'nodeId'),
    rulerCm,
    raining: body.raining,
    soilIndex: Math.round(soilPercent * 10) / 1000,
    previousStatus,
  };
}

function parseNewNode(body) {
  if (!isPlainObject(body)) throw new ValidationError('o corpo da requisição deve ser um objeto JSON');

  const copiesCalibration = body.copyCalibrationFrom !== undefined && body.copyCalibrationFrom !== null
    && body.copyCalibrationFrom !== '';
  return {
    id: parseNodeId(body.id),
    name: parseName(body.name),
    description: parseDescription(body.description),
    zone: parseZone(body.zone),
    riverPosition: parseRiverPosition(body.riverPosition),
    copyCalibrationFrom: copiesCalibration ? parseNodeId(body.copyCalibrationFrom, 'copyCalibrationFrom') : null,
  };
}

function parseNodeChanges(body) {
  if (!isPlainObject(body)) throw new ValidationError('o corpo da requisição deve ser um objeto JSON');
  return {
    name: parseName(body.name),
    description: parseDescription(body.description),
    zone: parseZone(body.zone),
    riverPosition: parseRiverPosition(body.riverPosition),
  };
}

module.exports = {
  parseNodeId,
  parseNewNode,
  parseNodeChanges,
  parseRulerCm,
  parseRecordId,
  parseAnnotation,
  parseSimulation,
  NODE_ID_MAX,
  ZONES,
  ANNOTATION_MAX,
};
