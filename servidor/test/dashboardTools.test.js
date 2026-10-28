'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGeometry } = require('../src/services/dashboard/levelGeometry');
const { adjustCurve, sensorValueNow, rulerToDepthMm } = require('../src/services/dashboard/rulerAdjustment');
const { driftWarning } = require('../src/services/dashboard/drift');
const { alertEpisodes, leadTimeSummary } = require('../src/services/dashboard/leadTime');
const { parseNewNode, parseNodeChanges, parseRulerCm } = require('../src/services/dashboard/nodeInput');
const { inRiverOrder } = require('../src/services/dashboard/dashboardService');
const { createNodeRepository } = require('../src/database/nodeRepository');
const { ValidationError, NotReadyError } = require('../src/errors');
const { createRulerService } = require('../src/services/dashboard/rulerService');
const { sensorErrorMm, rulerErrorSummary } = require('../src/services/dashboard/rulerChecks');

const DISPLAY = { bedHeightMm: 10, uncertaintyMm: 2 };
const GEOMETRY = buildGeometry({ bankfull_depth_mm: 25.5, level_range_mm: 26 }, DISPLAY);
const BOX_2_CURVE = [[2668, 0], [1280, 12], [1084, 26]];
const MINUTE = 60000;

test('régua: 2,0 cm na régua = 10 mm de água sobre o leito; fora da faixa do sensor → erro', () => {
  assert.equal(rulerToDepthMm(2, GEOMETRY), 10);
  assert.equal(rulerToDepthMm(3.6, GEOMETRY), 26);
  assert.throws(() => rulerToDepthMm(0.9, GEOMETRY), ValidationError);
  assert.throws(() => rulerToDepthMm(3.7, GEOMETRY), ValidationError);
  assert.equal(parseRulerCm('2,05'), 2.05);
  assert.throws(() => parseRulerCm(''), ValidationError);
  assert.throws(() => parseRulerCm('-1'), ValidationError);
});

test('régua: valor do sensor agora é a mediana do último minuto (pelo menos 3 leituras)', () => {
  assert.equal(sensorValueNow([1300, 1310, 1290, 5000]), 1305);
  assert.throws(() => sensorValueNow([1300, 1310]), ValidationError);
});

test('ajuste pela régua no primeiro trecho: desloca a curva e grava o ponto medido', () => {
  // 10 mm is between the dry point (0 mm) and the first water point (12 mm): it uses the 14 mV/mm slope.
  const plan = adjustCurve(BOX_2_CURVE, 10, 1330);
  assert.deepEqual([plan.expectedMv, plan.shiftMv], [1308, 22]);
  assert.deepEqual(plan.curve, [[2690, 0], [1330, 10], [1302, 12], [1106, 26]]);
});

test('ajuste pela régua acima do primeiro trecho: só desloca a curva', () => {
  const plan = adjustCurve(BOX_2_CURVE, 14, 1200);
  assert.deepEqual([plan.expectedMv, plan.shiftMv], [1252, -52]);
  assert.deepEqual(plan.curve, [[2616, 0], [1228, 12], [1032, 26]]);
});

test('ajuste pela régua: diferença grande demais ou curva inválida → erro', () => {
  assert.throws(() => adjustCurve(BOX_2_CURVE, 14, 1700), /grande demais/);
  assert.throws(() => adjustCurve([[1400, 0], [1280, 12], [1084, 26]], 2, 1420), /curva do sensor inválida/);
});

const drifting = (levels, extra = {}) => levels.map((avg, i) => ({ bucket_ms: i * 20 * MINUTE, avg_mm: avg, outside: 0, rainy: 0, ...extra }));

test('desvio do sensor: subida lenta e constante sem chuva gera aviso', () => {
  // Like box 2 on the night of 25 to 26/10: about +0.3 mm every 20 min with the water still.
  const warning = driftWarning(drifting([12.0, 12.3, 12.6, 12.8, 13.2, 13.5, 13.8, 14.1, 14.4]));
  assert.deepEqual(warning, { riseMm: 2.4, sinceMs: 0, hours: 2.7 });
});

test('desvio do sensor: chuva, salto (água colocada), descida, poucos dados ou fora da faixa → sem aviso', () => {
  const slowRise = [12.0, 12.3, 12.6, 12.8, 13.2, 13.5, 13.8, 14.1, 14.4];
  assert.equal(driftWarning(drifting(slowRise, { rainy: 1 })), null);
  assert.equal(driftWarning(drifting([12, 12.2, 12.4, 17.5, 17.6, 17.8, 18])), null);
  assert.equal(driftWarning(drifting([14.4, 14.1, 13.8, 13.5, 13.2, 12.9])), null);
  assert.equal(driftWarning(drifting([12, 12.5, 13, 13.5, 14])), null);
  assert.equal(driftWarning(drifting(slowRise).map((b, i) => (i === 4 ? { ...b, outside: 1 } : b))), null);
  assert.equal(driftWarning(drifting([12, 12.1, 12.1, 12.2, 12.2, 12.3])), null);
});

const row = (minute, status, rule) => ({ time_ms: minute * MINUTE, status, rule });

test('antecedência: tempo entre o primeiro alerta e o transbordamento', () => {
  const episodes = alertEpisodes([
    row(0, 'NORMAL', 'NIVEL_NORMAL'),
    row(1, 'ATENCAO', 'NIVEL_ATENCAO'),
    row(2, 'RISCO', 'NIVEL_RISCO'),
    row(5, 'RISCO', 'TRANSBORDOU'),
    row(10, 'NORMAL', 'NIVEL_NORMAL'),
    row(20, 'ATENCAO', 'NIVEL_ATENCAO'),
  ]);
  assert.equal(episodes.length, 2);
  assert.deepEqual(
    [episodes[0].attentionLeadMs, episodes[0].riskLeadMs, episodes[0].overflowed, episodes[0].ongoing],
    [4 * MINUTE, 3 * MINUTE, true, false],
  );
  assert.deepEqual([episodes[1].ongoing, episodes[1].overflowed, episodes[1].attentionLeadMs], [true, false, null]);
  assert.deepEqual(leadTimeSummary(episodes), {
    episodes: 2, overflows: 1, measured: 1, averageAttentionLeadMs: 4 * MINUTE, averageRiskLeadMs: 3 * MINUTE,
  });
});

test('antecedência: alerta que já vinha de antes do período não conta (início desconhecido)', () => {
  const episodes = alertEpisodes([
    row(0, 'RISCO', 'NIVEL_RISCO'),
    row(3, 'RISCO', 'TRANSBORDOU'),
    row(9, 'NORMAL', 'NIVEL_NORMAL'),
  ]);
  assert.deepEqual([episodes[0].startedBeforePeriod, episodes[0].overflowed, episodes[0].attentionLeadMs], [true, true, null]);
  assert.equal(leadTimeSummary(episodes).measured, 0);
});

test('zona e posição no rio: valores aceitos e erros', () => {
  const node = parseNewNode({ id: 4, name: 'Ponte', zone: 'URBANA', riverPosition: '65.456' });
  assert.deepEqual([node.zone, node.riverPosition], ['URBANA', 65.46]);
  assert.deepEqual(parseNodeChanges({ name: 'Ponte', zone: '', riverPosition: '' }),
    { name: 'Ponte', description: null, zone: null, riverPosition: null });
  assert.throws(() => parseNewNode({ id: 4, name: 'x', zone: 'CENTRO' }), ValidationError);
  assert.throws(() => parseNewNode({ id: 4, name: 'x', riverPosition: 101 }), ValidationError);
});

test('ordem no mapa: da esquerda para a direita como na maquete; sem posição vai no fim', () => {
  const nodes = [{ id: 1, river_position: 80 }, { id: 4, river_position: null }, { id: 2, river_position: 50 }, { id: 3, river_position: 20 }];
  assert.deepEqual(inRiverOrder(nodes).map((node) => node.id), [3, 2, 1, 4]);
});

function fakeFieldNotes({ ready = true } = {}) {
  const checks = [];
  return {
    checks,
    checkReady: async () => ready,
    addRulerCheck: async (check) => {
      if (!ready) throw new NotReadyError('rode o 14');
      checks.push(check);
      return checks.length;
    },
  };
}

function rulerService({ recentMv = [1329, 1330, 1331], ready = true } = {}) {
  const saved = [];
  const changed = [];
  const node = {
    id: 2, name: 'Caixa 2', calibration_id: 12, bankfull_depth_mm: 25.5, level_range_mm: 26,
    sensor_tip_above_bed_mm: 0, level_curve: BOX_2_CURVE,
  };
  const fieldNotes = fakeFieldNotes({ ready });
  const service = createRulerService({
    nodeRepository: {
      findById: async (id) => (id === 2 ? node : null),
      replaceLevelCurve: async (nodeId, change) => { saved.push({ nodeId, ...change }); return 13; },
    },
    dashboardRepository: { recentLevelMv: async () => recentMv },
    fieldNotesRepository: fieldNotes,
    display: DISPLAY,
    now: () => new Date(2026, 9, 26, 9, 30).getTime(),
    onCalibrationChanged: (nodeId) => changed.push(nodeId),
  });
  return { service, saved, changed, checks: fieldNotes.checks };
}

test('régua no serviço: prévia mostra o erro do sensor e o antes e depois do ajuste', async () => {
  const { service } = rulerService();
  const plan = await service.plan(2, 2);
  assert.deepEqual([plan.sensorMv, plan.rulerDepthMm, plan.errorMm, plan.shiftMv], [1330, 10, 1.6, 22]);
  assert.equal(plan.before.level.rulerCm, 2.16);
  assert.equal(plan.after.level.rulerCm, 2);
  assert.deepEqual([plan.adjustProblem, plan.canRecord], [null, true]);
});

test('régua no serviço: ajustar cria calibração nova e guarda a medida de antes do ajuste', async () => {
  const { service, saved, changed, checks } = rulerService();
  const result = await service.adjust(2, 2);
  assert.deepEqual([result.calibrationId, result.checkRecorded], [13, true]);
  assert.deepEqual(saved[0].levelCurve, [[2690, 0], [1330, 10], [1302, 12], [1106, 26]]);
  assert.equal(saved[0].notes, 'Ajuste pela regua no painel 2026-10-26 09:30:00: regua 2 cm = 1330 mV (curva deslocada 22 mV).');
  assert.deepEqual(changed, [2]);
  assert.deepEqual(checks, [{
    nodeId: 2, rulerCm: 2, rulerDepthMm: 10, sensorMv: 1330, sensorRange: 'DENTRO', sensorDepthMm: 11.6, calibrationId: 12, adjusted: true,
  }]);
});

test('régua no serviço: só registrar não muda a calibração', async () => {
  const { service, saved, checks } = rulerService();
  const check = await service.record(2, 2.1);
  assert.deepEqual([check.id, check.errorMm, check.adjusted], [1, 0.6, false]);
  assert.deepEqual([saved.length, checks.length], [0, 1]);
});

test('régua no serviço: sem o script 14 o ajuste funciona, mas a medida não é guardada', async () => {
  const { service } = rulerService({ ready: false });
  assert.equal((await service.plan(2, 2)).canRecord, false);
  assert.equal((await service.adjust(2, 2)).checkRecorded, false);
  await assert.rejects(service.record(2, 2), NotReadyError);
});

test('régua no serviço: caixa seca também é medida; diferença grande não ajusta; sensor parado → erro', async () => {
  const dry = await rulerService({ recentMv: [2668, 2668, 2669] }).service.plan(2, 1);
  assert.deepEqual([dry.errorMm, dry.shiftMv], [0, 0]);
  const far = await rulerService({ recentMv: [1700, 1700, 1700] }).service.plan(2, 2.4);
  assert.equal(far.after, null);
  assert.match(far.adjustProblem, /grande demais/);
  await assert.rejects(rulerService({ recentMv: [] }).service.plan(2, 2), ValidationError);
});

test('erro do sensor contra a régua: média com sinal, média sem sinal e maior erro', () => {
  const check = (sensorDepthMm, rulerDepthMm, sensorRange = 'DENTRO') => ({ sensorRange, sensorDepthMm, rulerDepthMm });
  assert.equal(sensorErrorMm(check(12.3, 11)), 1.3);
  assert.equal(sensorErrorMm(check(null, 26, 'ACIMA')), null);
  assert.deepEqual(rulerErrorSummary([check(12, 10), check(15, 16), check(22, 23), check(null, 26, 'ACIMA')]), {
    checks: 4, compared: 3, meanErrorMm: 0, meanAbsErrorMm: 1.3, maxAbsErrorMm: 2,
  });
  assert.equal(rulerErrorSummary([]).meanErrorMm, null);
});

test('banco sem as colunas de zona (script 13 não rodado): painel continua funcionando', async () => {
  const queries = [];
  const pool = {
    query: async (sql) => {
      queries.push(sql);
      if (sql.includes('n.zone')) throw Object.assign(new Error('Unknown column'), { code: 'ER_BAD_FIELD_ERROR' });
      return [[{ id: 1, name: 'Caixa 1', zone: null, river_position: null, calibration_id: null }]];
    },
  };
  const repository = createNodeRepository(pool);
  const nodes = await repository.listWithCalibration();
  assert.deepEqual([nodes[0].id, nodes[0].zone, nodes[0].river_position], [1, null, null]);
  assert.equal(repository.supportsZones(), false);
  await repository.listWithCalibration();
  assert.equal(queries.filter((sql) => sql.includes('n.zone')).length, 1);
});
