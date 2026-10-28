'use strict';
const { ValidationError } = require('../errors');

const MAX_UINT32 = 4294967295;
const MAX_SMALLINT_UNSIGNED = 65535;
const MAX_ADC_12_BIT = 4095;

const FIELD_LIMITS = Object.freeze({
  node_id: [1, 255],
  seq: [0, MAX_UINT32],
  uptime_ms: [0, MAX_UINT32],
  level_mv: [0, MAX_SMALLINT_UNSIGNED],
  level_raw: [0, MAX_ADC_12_BIT],
  rain_mv: [0, MAX_SMALLINT_UNSIGNED],
  rain_raw: [0, MAX_ADC_12_BIT],
  soil_mv: [0, MAX_SMALLINT_UNSIGNED],
  soil_raw: [0, MAX_ADC_12_BIT],
});

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function validateReadingPayload(payload) {
  if (!isPlainObject(payload)) {
    throw new ValidationError('o corpo da requisição deve ser um objeto JSON');
  }

  const reading = {};
  for (const [field, [min, max]] of Object.entries(FIELD_LIMITS)) {
    const value = payload[field];
    const isIntegerInRange = Number.isInteger(value) && value >= min && value <= max;
    if (!isIntegerInRange) {
      throw new ValidationError(`campo "${field}" ausente ou inválido (inteiro entre ${min} e ${max})`);
    }
    reading[field] = value;
  }
  return reading;
}

module.exports = { validateReadingPayload, FIELD_LIMITS };
