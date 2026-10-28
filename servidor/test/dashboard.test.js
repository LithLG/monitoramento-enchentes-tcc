'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGeometry, rulerReading, classLimits } = require('../src/services/dashboard/levelGeometry');
const { levelTrend } = require('../src/services/dashboard/trend');
const { connectionState } = require('../src/services/dashboard/connection');
const { parseTimeRange, bucketSecondsFor } = require('../src/services/dashboard/timeRange');
const { buildEvents, summarize, toChartPoint } = require('../src/services/dashboard/history');
const { readingsToCsv } = require('../src/services/dashboard/csv');
const { parseNewNode } = require('../src/services/dashboard/nodeInput');
const { createUnknownNodeTracker } = require('../src/services/dashboard/unknownNodeTracker');
const { createDashboardService, firstFreeNodeId } = require('../src/services/dashboard/dashboardService');
const { DuplicateNodeError } = require('../src/database/nodeRepository');
const { createServerComputerCheck } = require('../src/middlewares/serverComputer');
const { ValidationError, NotFoundError, ConflictError } = require('../src/errors');

const DISPLAY = { bedHeightMm: 10, uncertaintyMm: 2 };
const CALIBRATION = { bankfull_depth_mm: 25.5, level_range_mm: 26 };
const GEOMETRY = buildGeometry(CALIBRATION, DISPLAY);
const V2 = { attentionFraction: 0.647, riskFraction: 0.824, hysteresisMm: 2, dryDepthMm: 1, soilSaturatedIndex: 0.8 };
const LIMITS = classLimits(V2, GEOMETRY);

test('régua: lâmina sobre o leito + altura do leito (1,0 cm)', () => {
  assert.deepEqual(rulerReading({ levelRange: 'DENTRO', levelDepthMm: 12 }, GEOMETRY), { kind: 'DENTRO', depthMm: 12, rulerCm: 2.2 });
  assert.deepEqual(rulerReading({ levelRange: 'ACIMA', levelDepthMm: null }, GEOMETRY), { kind: 'ACIMA', depthMm: null, rulerCm: 3.6 });
  assert.deepEqual(rulerReading({ levelRange: 'ABAIXO', levelDepthMm: null }, GEOMETRY), { kind: 'ABAIXO', depthMm: 0, rulerCm: 1 });
  assert.equal(rulerReading({ levelRange: null, levelDepthMm: null }, GEOMETRY).kind, 'SEM_CALIBRACAO');
  assert.equal(rulerReading({ levelRange: 'DENTRO', levelDepthMm: 12 }, null).kind, 'SEM_CALIBRACAO');
});

test('limites v2 na régua: atenção 2,65 cm, risco 3,1 cm, transborda 3,55 cm e saídas da histerese', () => {
  assert.deepEqual(LIMITS.attention, { depthMm: 16.5, rulerCm: 2.65 });
  assert.deepEqual(LIMITS.risk, { depthMm: 21, rulerCm: 3.1 });
  assert.deepEqual(LIMITS.overflow, { depthMm: 25.5, rulerCm: 3.55 });
  assert.equal(LIMITS.attentionExit.depthMm, 14.5);
  assert.equal(LIMITS.riskExit.depthMm, 19);
  assert.equal(classLimits(V2, null), null);
});

const NOW = 1_000_000_000;
const series = (mmPerMinute, startMm = 12) => Array.from({ length: 13 }, (_, i) => ({
  timeMs: NOW - (12 - i) * 15000,
  levelRange: 'DENTRO',
  depthMm: startMm + (mmPerMinute * (i * 15)) / 60,
}));

test('tendência: subindo com previsão de risco e de transbordamento', () => {
  const trend = levelTrend(series(1.5, 15), NOW, LIMITS);
  assert.equal(trend.direction, 'SUBINDO');
  assert.equal(trend.mmPerMinute, 1.5);
  // Last reading is 15 + 1.5 x 3 = 19.5 mm: risk (21 mm) in 1 min, overflow (25.5 mm) in 4 min.
  assert.equal(trend.minutesToRisk, 1);
  assert.equal(trend.minutesToOverflow, 4);
});

test('tendência: ruído do sensor conta como estável; descida conta como baixando', () => {
  const noisy = series(0).map((p, i) => ({ ...p, depthMm: p.depthMm + (i % 2 ? 0.4 : -0.4) }));
  assert.equal(levelTrend(noisy, NOW, LIMITS).direction, 'ESTAVEL');
  assert.equal(levelTrend(series(-2, 20), NOW, LIMITS).direction, 'BAIXANDO');
});

test('tendência: poucos dados, dados velhos ou água acima do sensor', () => {
  assert.equal(levelTrend(series(2).slice(-3), NOW, LIMITS).direction, 'INDEFINIDA');
  assert.equal(levelTrend(series(2), NOW + 10 * 60000, LIMITS).direction, 'INDEFINIDA');
  assert.equal(levelTrend([{ timeMs: NOW, levelRange: 'ACIMA', depthMm: null }], NOW, LIMITS).direction, 'TRANSBORDANDO');
  assert.equal(levelTrend([], NOW, LIMITS).direction, 'INDEFINIDA');
});

test('conexão: online, atrasado (3 leituras perdidas), sem sinal (5 min), nunca enviou', () => {
  assert.equal(connectionState(NOW - 20000, NOW), 'ONLINE');
  assert.equal(connectionState(NOW - 60000, NOW), 'ATRASADO');
  assert.equal(connectionState(NOW - 6 * 60000, NOW), 'SEM_SINAL');
  assert.equal(connectionState(null, NOW), 'NUNCA_ENVIOU');
});

test('período: padrão de 1 h, validação e tamanho dos pontos do gráfico', () => {
  assert.deepEqual(parseTimeRange({}, NOW), { fromMs: NOW - 3600000, toMs: NOW });
  assert.throws(() => parseTimeRange({ from: 'x' }, NOW), ValidationError);
  assert.throws(() => parseTimeRange({ from: String(NOW), to: String(NOW - 1) }, NOW), ValidationError);
  assert.throws(() => parseTimeRange({ from: '1', to: String(40 * 86400000) }, NOW), ValidationError);
  assert.equal(bucketSecondsFor({ fromMs: 0, toMs: 3600000 }), 15);
  assert.equal(bucketSecondsFor({ fromMs: 0, toMs: 24 * 3600000 }), 180);
  assert.equal(bucketSecondsFor({ fromMs: 0, toMs: 7 * 24 * 3600000 }), 1200);
});

const change = (timeMs, status, rule, extra = {}) => ({
  time_ms: timeMs, prev_time_ms: timeMs - 15000, status, rule, level_range: 'DENTRO', level_depth_mm: 17, ...extra,
});

test('eventos: mudança de classe, avisos, sem sinal; leitura sem classe não cria evento', () => {
  const events = buildEvents([
    { ...change(1000, 'NORMAL', 'NIVEL_NORMAL'), prev_time_ms: null },
    change(2000, null, null),
    change(3000, 'NORMAL', 'NIVEL_NORMAL'),
    change(4000, 'NORMAL', 'AVISO_SOLO_CHUVA'),
    change(5000, 'ATENCAO', 'NIVEL_ATENCAO'),
    change(6000, 'ATENCAO', 'HISTERESE_MANTEM_ATENCAO'),
    { ...change(400000, 'NORMAL', 'NIVEL_NORMAL'), prev_time_ms: 6000 },
  ], { gapMs: 120000, geometry: GEOMETRY });

  assert.deepEqual(events.map((e) => [e.type, e.to ?? e.rule ?? null]), [
    ['CLASSE', 'NORMAL'],
    ['SEM_SINAL', null],
    ['CLASSE', 'ATENCAO'],
    ['AVISO_INICIO', 'AVISO_SOLO_CHUVA'],
  ]);
  assert.equal(events[2].level.rulerCm, 2.7);
  assert.equal(events[1].minutes, 7);
});

const bucket = (extra) => ({
  bucket_ms: 0, readings: 4, avg_mm: 12, min_mm: 11, max_mm: 13, above: 0, below: 0, rainy: 0,
  soil_index: 0.2, level_mv: 1400, rain_mv: 3129, soil_mv: 230, n_normal: 4, n_atencao: 0, n_risco: 0, ...extra,
});

test('gráfico: ponto acima do sensor só quando a maioria das leituras está acima', () => {
  assert.equal(toChartPoint(bucket({ above: 1, avg_mm: 20 }), GEOMETRY).rulerCm, 3);
  const mostlyAbove = toChartPoint(bucket({ above: 3, avg_mm: 20, n_risco: 4, n_normal: 0 }), GEOMETRY);
  assert.deepEqual([mostlyAbove.rulerCm, mostlyAbove.above, mostlyAbove.status], [3.6, true, 'RISCO']);
  assert.equal(toChartPoint(bucket({ avg_mm: null, min_mm: null, max_mm: null, below: 4 }), GEOMETRY).rulerCm, 1);
});

test('resumo do período: tempo em cada classe, máximo, mínimo e minutos de chuva', () => {
  const stats = summarize([
    bucket({}),
    bucket({ max_mm: 24, n_normal: 0, n_atencao: 2, n_risco: 2, rainy: 4 }),
  ], GEOMETRY);
  assert.deepEqual(stats.statusShare, { NORMAL: 0.5, ATENCAO: 0.25, RISCO: 0.25 });
  assert.equal(stats.maxRulerCm, 3.4);
  assert.equal(stats.minRulerCm, 2.1);
  assert.equal(stats.rainMinutes, 1);
  const alwaysAbove = summarize([bucket({ avg_mm: null, min_mm: null, max_mm: null, above: 4 })], GEOMETRY);
  assert.deepEqual([alwaysAbove.minRulerCm, alwaysAbove.minIsAboveSensor], [3.6, true]);
});

test('CSV: abre no Excel em português (BOM, ";" e vírgula decimal)', () => {
  const csv = readingsToCsv([{
    time_ms: new Date(2026, 9, 26, 5, 12, 3).getTime(), seq: 7, level_mv: 1404, rain_mv: 3129, soil_mv: 232,
    level_range: 'DENTRO', level_depth_mm: 11.6, rain_class: 'SECO', soil_index: 0.166, status: 'NORMAL', rule: 'NIVEL_NORMAL',
  }], GEOMETRY);
  const [header, line] = csv.split('\r\n');
  assert.ok(header.startsWith('﻿data_hora;seq;'));
  assert.equal(line, '2026-10-26 05:12:03;7;1404;3129;232;DENTRO;11,6;2,16;SECO;0,166;NORMAL;NIVEL_NORMAL');
});

test('cadastro: limpa espaços, descrição vazia vira nula, calibração opcional', () => {
  assert.deepEqual(parseNewNode({ id: '5', name: ' Ponte ', description: '  ', copyCalibrationFrom: '' }),
    { id: 5, name: 'Ponte', description: null, zone: null, riverPosition: null, copyCalibrationFrom: null });
  assert.throws(() => parseNewNode({ id: 256, name: 'x' }), ValidationError);
  assert.throws(() => parseNewNode({ id: 4, name: 'x'.repeat(51) }), ValidationError);
  assert.throws(() => parseNewNode([]), ValidationError);
});

test('sensores desconhecidos: guarda o último envio e esquece depois de 10 min ou do cadastro', () => {
  let now = 0;
  const tracker = createUnknownNodeTracker({ now: () => now });
  tracker.record({ nodeId: 4, sourceIp: '::ffff:192.168.10.23' });
  now = 15000;
  tracker.record({ nodeId: 4, sourceIp: null });
  assert.deepEqual(tracker.list(), [{ nodeId: 4, sourceIp: '::ffff:192.168.10.23', firstSeenMs: 0, lastSeenMs: 15000, attempts: 2 }]);
  tracker.forget(4);
  assert.deepEqual(tracker.list(), []);
  tracker.record({ nodeId: 5 });
  now += 11 * 60000;
  assert.deepEqual(tracker.list(), []);
});

test('computador do servidor: localhost e os próprios IPs; outros aparelhos não', () => {
  const isServerComputer = createServerComputerCheck(() => ['192.168.10.5']);
  const from = (address) => ({ socket: { remoteAddress: address } });
  assert.equal(isServerComputer(from('127.0.0.1')), true);
  assert.equal(isServerComputer(from('::1')), true);
  assert.equal(isServerComputer(from('::ffff:192.168.10.5')), true);
  assert.equal(isServerComputer(from('::ffff:192.168.10.40')), false);
});

function fakeRepositories({ nodes }) {
  const created = [];
  return {
    created,
    nodeRepository: {
      listWithCalibration: async () => nodes,
      findById: async (id) => nodes.find((node) => node.id === id) ?? null,
      create: async (input) => {
        if (nodes.some((node) => node.id === input.id)) throw new DuplicateNodeError(input.id);
        created.push(input);
        nodes.push({ id: input.id, name: input.name, calibration_id: input.copyCalibrationFrom ? 9 : null });
      },
      update: async () => {},
      supportsZones: () => true,
    },
    dashboardRepository: {
      activeThresholds: async () => ({ ...V2, name: 'v2' }),
      latestReadingPerNode: async () => [{ node_id: 1, id: 10, time_ms: NOW - 5000, level_mv: 1400, rain_mv: 1650, soil_mv: 700,
        level_range: 'DENTRO', level_depth_mm: 12, rain_class: 'CHUVA', soil_index: 1.03 }],
      latestClassificationPerNode: async () => [{ node_id: 1, reading_id: 10, time_ms: NOW - 5000, status: 'NORMAL', rule: 'AVISO_SOLO_CHUVA' }],
      statusSince: async () => NOW - 60000,
      lastRainMs: async () => null,
      recentLevels: async () => series(0),
      driftBuckets: async () => [],
    },
  };
}

const NODE_1 = { id: 1, name: 'Caixa 1', calibration_id: 3, bankfull_depth_mm: 25.5, level_range_mm: 26, level_curve: [[2747, 0], [1359, 12]] };

test('visão geral: junta cadastro, última leitura, classe, tendência e sensores desconhecidos', async () => {
  const repositories = fakeRepositories({ nodes: [{ ...NODE_1 }, { id: 2, name: 'Caixa 2', calibration_id: null }] });
  const tracker = createUnknownNodeTracker();
  tracker.record({ nodeId: 4, sourceIp: '10.0.0.9' });
  const service = createDashboardService({ ...repositories, unknownNodeTracker: tracker, display: DISPLAY, now: () => NOW });

  const overview = await service.overview();
  const [box1, box2] = overview.nodes;
  assert.deepEqual(box1.latest.level, { kind: 'DENTRO', depthMm: 12, rulerCm: 2.2 });
  assert.equal(box1.latest.raining, true);
  assert.equal(box1.latest.soilSaturated, true);
  assert.equal(box1.connection, 'ONLINE');
  assert.equal(box1.trend.direction, 'ESTAVEL');
  assert.equal(box1.classification.sinceMs, NOW - 60000);
  assert.equal(box1.lastRainMs, NOW - 5000);
  assert.deepEqual([box2.latest, box2.limits, box2.connection], [null, null, 'NUNCA_ENVIOU']);
  assert.deepEqual(overview.summary, { total: 2, byStatus: { NORMAL: 1 }, online: 1 });
  assert.equal(overview.unknownNodes[0].nodeId, 4);
  assert.equal(overview.nextFreeNodeId, 3);
});

test('cadastro de local: número repetido → 409; copiar de local sem calibração → 400; some da lista de desconhecidos', async () => {
  const repositories = fakeRepositories({ nodes: [{ ...NODE_1 }, { id: 2, name: 'Caixa 2', calibration_id: null }] });
  const tracker = createUnknownNodeTracker();
  tracker.record({ nodeId: 4 });
  const service = createDashboardService({ ...repositories, unknownNodeTracker: tracker, display: DISPLAY, now: () => NOW });

  await assert.rejects(service.createNode({ id: 1, name: 'x', description: null, copyCalibrationFrom: null }), ConflictError);
  await assert.rejects(service.createNode({ id: 4, name: 'x', description: null, copyCalibrationFrom: 2 }), ValidationError);
  const node = await service.createNode({ id: 4, name: 'Ponte', description: null, copyCalibrationFrom: 1 });
  assert.equal(node.calibration_id, 9);
  assert.deepEqual(tracker.list(), []);
  await assert.rejects(service.updateNode(77, { name: 'x', description: null }), NotFoundError);
});

test('primeiro número livre para um nó novo', () => {
  assert.equal(firstFreeNodeId([{ id: 1 }, { id: 2 }, { id: 4 }]), 3);
  assert.equal(firstFreeNodeId([]), 1);
});
