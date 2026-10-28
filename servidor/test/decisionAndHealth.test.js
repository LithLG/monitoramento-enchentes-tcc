'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  localDayStarts, dailyCoverage, totalShare, withOngoingGap, markSharedGaps, gapSummary,
} = require('../src/services/dashboard/sensorHealth');
const { createDecisionService } = require('../src/services/dashboard/decisionService');
const { parseExplanation, createClassifierClient, ClassifierOutdatedError } = require('../src/services/classifierClient');
const { createFieldNotesRepository } = require('../src/database/fieldNotesRepository');
const { NotReadyError } = require('../src/errors');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DISPLAY = { bedHeightMm: 10, uncertaintyMm: 2 };

test('saúde: dias locais, do mais antigo até hoje', () => {
  const nowMs = new Date(2026, 9, 27, 15, 0).getTime();
  const days = localDayStarts(nowMs, 3);
  assert.deepEqual(days, [new Date(2026, 9, 25).getTime(), new Date(2026, 9, 26).getTime(), new Date(2026, 9, 27).getTime()]);
});

test('saúde: leituras esperadas contam só desde a primeira leitura e só até agora', () => {
  const day = new Date(2026, 9, 26).getTime();
  const nowMs = day + 12 * HOUR;
  const hourly = [{ hourMs: day + 6 * HOUR, readings: 240 }, { hourMs: day + 7 * HOUR, readings: 120 }];
  const [coverage] = dailyCoverage(hourly, { dayStarts: [day], firstMs: day + 6 * HOUR, nowMs });
  assert.deepEqual([coverage.received, coverage.expected], [360, 1440]);
  assert.equal(coverage.share, 0.25);
  const [before] = dailyCoverage([], { dayStarts: [day - 24 * HOUR], firstMs: day + 6 * HOUR, nowMs });
  assert.deepEqual([before.expected, before.share], [0, null]);
  assert.equal(totalShare([coverage, before]), 0.25);
});

test('saúde: nó calado agora vira falha em andamento', () => {
  assert.deepEqual(withOngoingGap([], 1000, 1000 + 10 * MINUTE), [{ startMs: 1000, endMs: 1000 + 10 * MINUTE, ongoing: true }]);
  assert.deepEqual(withOngoingGap([], 1000, 1000 + MINUTE), []);
});

test('saúde: falha de todos ao mesmo tempo = PC/servidor parado; falha de um só = ESP32 ou Wi-Fi', () => {
  const nightOff = (offsetMs) => ({ startMs: 10 * HOUR + offsetMs, endMs: 14 * HOUR + offsetMs });
  const gaps = new Map([
    [1, [nightOff(0), { startMs: 20 * HOUR, endMs: 20 * HOUR + 5 * MINUTE }]],
    [2, [nightOff(700)]],
    [3, [nightOff(-500)]],
  ]);
  const marked = markSharedGaps(gaps, new Map([[1, 0], [2, 0], [3, 0]]));
  assert.deepEqual(marked.get(1).map((gap) => gap.shared), [true, false]);
  assert.deepEqual(marked.get(2).map((gap) => gap.shared), [true]);

  const summary = gapSummary(marked.get(1));
  assert.deepEqual([summary.count, summary.sharedCount, summary.ownCount, summary.longestMs], [2, 1, 1, 4 * HOUR]);
  assert.equal(summary.recent[0].startMs, 20 * HOUR);
});

test('saúde: um local que ainda não existia não conta para dizer se a falha foi de todos', () => {
  const gaps = new Map([[1, [{ startMs: HOUR, endMs: 2 * HOUR }]], [2, []]]);
  const marked = markSharedGaps(gaps, new Map([[1, 0], [2, 3 * HOUR]]));
  assert.equal(marked.get(1)[0].shared, false);
});

const PYTHON_EXPLANATION = {
  threshold_set_id: 2,
  by_level: { status: 'NORMAL', rule: 'NIVEL_NORMAL' },
  previous_was_higher: true,
  after_hysteresis: { status: 'ATENCAO', rule: 'HISTERESE_MANTEM_ATENCAO' },
  is_raining: true,
  soil_is_saturated: true,
  soil_saturated_index: 0.8,
  final: { status: 'RISCO', rule: 'ESCALADA_SOLO_CHUVA' },
  limits: { dry_mm: 1, attention_mm: 16.4985, attention_exit_mm: 14.4985, risk_mm: 21.012, risk_exit_mm: 19.012, bankfull_mm: 25.5 },
};

test('cliente do Python: explicação de cada passo; Python antigo (sem /explain) é avisado', async () => {
  const explanation = parseExplanation(PYTHON_EXPLANATION);
  assert.deepEqual(explanation.afterHysteresis, { status: 'ATENCAO', rule: 'HISTERESE_MANTEM_ATENCAO' });
  assert.equal(explanation.limitsMm.riskExit, 19.012);
  assert.throws(() => parseExplanation({ ...PYTHON_EXPLANATION, final: { status: 'PERIGO', rule: 'x' } }));

  const oldPython = createClassifierClient('http://py', { fetchImpl: async () => ({ ok: false, status: 404 }) });
  await assert.rejects(oldPython.explain({}), { name: 'ClassifierOutdatedError' });
});

const BOX_2 = { id: 2, name: 'Caixa 2', zone: 'PERIURBANA', calibration_id: 6, bankfull_depth_mm: 25.5, level_range_mm: 26, river_position: 50 };

function decisionService({ explain = async () => parseExplanation(PYTHON_EXPLANATION), rows = [] } = {}) {
  const sent = [];
  const service = createDecisionService({
    dashboardRepository: { latestClassifiedInputs: async () => rows },
    nodeRepository: { listWithCalibration: async () => [BOX_2], findById: async (id) => (id === 2 ? BOX_2 : null) },
    classifierClient: { explain: async (input) => { sent.push(input); return explain(input); } },
    display: DISPLAY,
  });
  return { service, sent };
}

test('simulador: régua vira lâmina sobre o leito; acima do sensor vira ACIMA', async () => {
  const { service, sent } = decisionService();
  const result = await service.simulate({ nodeId: 2, rulerCm: 2.5, raining: true, soilIndex: 0.85, previousStatus: 'ATENCAO' });
  assert.deepEqual(sent[0], {
    level_range: 'DENTRO', level_depth_mm: 15, bankfull_depth_mm: 25.5, rain_class: 'CHUVA', soil_index: 0.85, previous_status: 'ATENCAO',
  });
  assert.equal(result.steps.final.status, 'RISCO');
  assert.deepEqual([result.limits.attention.rulerCm, result.limits.riskExit.rulerCm, result.limits.overflow.rulerCm], [2.65, 2.9, 3.55]);

  await service.simulate({ nodeId: 2, rulerCm: 3.7, raining: false, soilIndex: 0, previousStatus: null });
  assert.deepEqual([sent[1].level_range, sent[1].level_depth_mm, sent[1].rain_class], ['ACIMA', null, 'SECO']);
});

test('árvore ao vivo: usa as mesmas entradas da última classificação, com a classe anterior', async () => {
  const rows = [{
    node_id: 2, reading_id: 90, time_ms: 5000, level_mv: 1300, level_range: 'DENTRO', level_depth_mm: 15,
    rain_class: 'CHUVA', soil_index: 0.9, bankfull_depth_mm: 25.5, status: 'RISCO', rule: 'ESCALADA_SOLO_CHUVA', previous_status: 'ATENCAO',
  }];
  const { service, sent } = decisionService({ rows });
  const { places } = await service.live();
  assert.equal(sent[0].previous_status, 'ATENCAO');
  assert.deepEqual([places[0].ready, places[0].inputs.level.rulerCm, places[0].stored.rule], [true, 2.5, 'ESCALADA_SOLO_CHUVA']);
});

test('árvore: Python fora do ar ou desatualizado → mensagem do que fazer', async () => {
  const down = decisionService({ explain: async () => { throw new Error('ECONNREFUSED'); } }).service;
  await assert.rejects(down.simulate({ nodeId: 2, rulerCm: 2, raining: false, soilIndex: 0, previousStatus: null }), NotReadyError);
  const outdated = decisionService({ explain: async () => { throw new ClassifierOutdatedError(); } }).service;
  await assert.rejects(outdated.simulate({ nodeId: 2, rulerCm: 2, raining: false, soilIndex: 0, previousStatus: null }), /reinicie o sistema/);
});

test('caderno de campo sem o script 14: leitura vazia e gravação explica o que fazer', async () => {
  const missing = Object.assign(new Error("Table 'annotation' doesn't exist"), { code: 'ER_NO_SUCH_TABLE' });
  const pool = { query: async () => { throw missing; }, execute: async () => { throw missing; } };
  const repository = createFieldNotesRepository(pool);
  assert.deepEqual(await repository.annotations({ nodeId: 2, fromMs: 0, toMs: 1 }), []);
  assert.deepEqual(await repository.rulerChecks({}), []);
  assert.equal(await repository.checkReady(0), false);
  await assert.rejects(repository.addAnnotation({ nodeId: 2, timeMs: 0, text: 'x' }), /14_anotacoes_regua\.sql/);
});
