'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { convertLevel, classifyRain, soilIndex, convertReading } = require('../src/services/conversion');

const CURVE = [[150, 0], [930, 5], [1770, 20], [2300, 40]];

test('nível: interpola dentro da faixa e soma a altura da ponta acima do leito', () => {
  assert.deepEqual(convertLevel(930, CURVE, 10), { levelRange: 'DENTRO', levelDepthMm: 15 });
  assert.deepEqual(convertLevel(1350, CURVE, 10), { levelRange: 'DENTRO', levelDepthMm: 22.5 });
});

test('nível: extremos da curva contam como dentro', () => {
  assert.deepEqual(convertLevel(150, CURVE, 10), { levelRange: 'DENTRO', levelDepthMm: 10 });
  assert.deepEqual(convertLevel(2300, CURVE, 10), { levelRange: 'DENTRO', levelDepthMm: 50 });
});

test('nível: fora da curva é leitura censurada, sem lâmina', () => {
  assert.deepEqual(convertLevel(142, CURVE, 10), { levelRange: 'ABAIXO', levelDepthMm: null });
  assert.deepEqual(convertLevel(2400, CURVE, 10), { levelRange: 'ACIMA', levelDepthMm: null });
});

test('nível: aceita a curva fora de ordem', () => {
  const shuffled = [CURVE[2], CURVE[0], CURVE[3], CURVE[1]];
  assert.deepEqual(convertLevel(1350, shuffled, 10), { levelRange: 'DENTRO', levelDepthMm: 22.5 });
});

const CAPACITIVE_CURVE = [[1700, 0], [1500, 15], [1300, 30], [1200, 40]];

test('nível capacitivo (mais água = menos mV): interpola dentro da faixa', () => {
  assert.deepEqual(convertLevel(1400, CAPACITIVE_CURVE, 0), { levelRange: 'DENTRO', levelDepthMm: 22.5 });
  assert.deepEqual(convertLevel(1700, CAPACITIVE_CURVE, 0), { levelRange: 'DENTRO', levelDepthMm: 0 });
  assert.deepEqual(convertLevel(1200, CAPACITIVE_CURVE, 0), { levelRange: 'DENTRO', levelDepthMm: 40 });
});

test('nível capacitivo: mV acima da curva é água ABAIXO; mV abaixo da curva é água ACIMA', () => {
  assert.deepEqual(convertLevel(1750, CAPACITIVE_CURVE, 0), { levelRange: 'ABAIXO', levelDepthMm: null });
  assert.deepEqual(convertLevel(1150, CAPACITIVE_CURVE, 0), { levelRange: 'ACIMA', levelDepthMm: null });
});

test('nível capacitivo: aceita a curva fora de ordem', () => {
  const shuffled = [CAPACITIVE_CURVE[2], CAPACITIVE_CURVE[0], CAPACITIVE_CURVE[3], CAPACITIVE_CURVE[1]];
  assert.deepEqual(convertLevel(1400, shuffled, 0), { levelRange: 'DENTRO', levelDepthMm: 22.5 });
});

test('chuva: tensão cai quando molha', () => {
  assert.equal(classifyRain(3150, 2900, 2000), 'SECO');
  assert.equal(classifyRain(2500, 2900, 2000), 'CHUVA');
  assert.equal(classifyRain(1600, 2900, 2000), 'CHUVA_INTENSA');
  assert.equal(classifyRain(2900, 2900, 2000), 'SECO', 'no limite exato ainda é seco');
});

test('chuva: sem limite de chuva intensa vira binária (plano B)', () => {
  assert.equal(classifyRain(1600, 2900, null), 'CHUVA');
});

test('solo: índice S vai de 0 (seco) a 1 (encharcado)', () => {
  assert.equal(soilIndex(2750, 2750, 1900), 0);
  assert.equal(soilIndex(1900, 2750, 1900), 1);
  assert.equal(soilIndex(2000, 2750, 1900), 0.882);
});

test('solo com FD10 (mais água = mais mV): índice S também vai de 0 a 1', () => {
  assert.equal(soilIndex(142, 142, 900), 0);
  assert.equal(soilIndex(900, 142, 900), 1);
  assert.equal(soilIndex(710, 142, 900), 0.749);
});

test('solo: índice fora de 0–1 é mantido (sinal de recalibrar), mas limitado à coluna do banco', () => {
  assert.equal(soilIndex(1800, 2750, 1900), 1.118);
  assert.equal(soilIndex(0, 2750, 2749), 9.999);
});

test('sem calibração, nada é convertido', () => {
  const reading = { level_mv: 1000, rain_mv: 3000, soil_mv: 2500 };
  assert.deepEqual(convertReading(reading, null), {
    calibrationId: null, levelRange: null, levelDepthMm: null, rainClass: null, soilIndex: null,
  });
});

test('com calibração, converte as três grandezas', () => {
  const calibration = {
    id: 7, level_curve: CURVE, sensor_tip_above_bed_mm: '10.0',
    soil_dry_mv: 2750, soil_saturated_mv: 1900, rain_wet_below_mv: 2900, rain_heavy_below_mv: 2000,
  };
  const reading = { level_mv: 1350, rain_mv: 1600, soil_mv: 2000 };
  assert.deepEqual(convertReading(reading, calibration), {
    calibrationId: 7, levelRange: 'DENTRO', levelDepthMm: 22.5, rainClass: 'CHUVA_INTENSA', soilIndex: 0.882,
  });
});
