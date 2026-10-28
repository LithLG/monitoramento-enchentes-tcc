'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateReadingPayload } = require('../src/services/readingValidation');
const { ValidationError } = require('../src/errors');

const VALID = Object.freeze({
  node_id: 1, seq: 12, uptime_ms: 180000,
  level_mv: 142, level_raw: 0, rain_mv: 3150, rain_raw: 4095, soil_mv: 2741, soil_raw: 3245,
});

test('aceita o JSON que o firmware envia e descarta campos desconhecidos', () => {
  assert.deepEqual(validateReadingPayload({ ...VALID, extra: 'x' }), VALID);
});

test('recusa corpo que não é objeto', () => {
  for (const body of [null, [], 'texto', 5]) {
    assert.throws(() => validateReadingPayload(body), ValidationError);
  }
});

test('recusa campo ausente, negativo, fracionário ou fora do limite', () => {
  const cases = [
    { ...VALID, seq: undefined },
    { ...VALID, level_mv: -1 },
    { ...VALID, soil_mv: 12.5 },
    { ...VALID, rain_raw: 4096 },
    { ...VALID, node_id: 0 },
    { ...VALID, node_id: '1' },
  ];
  for (const body of cases) {
    assert.throws(() => validateReadingPayload(body), ValidationError, JSON.stringify(body));
  }
});
