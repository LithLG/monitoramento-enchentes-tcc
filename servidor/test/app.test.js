'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createReadingController } = require('../src/controllers/readingController');
const { createStatusController } = require('../src/controllers/statusController');
const { createReadingService } = require('../src/services/readingService');
const { createClassifierClient } = require('../src/services/classifierClient');
const { createDashboardController } = require('../src/controllers/dashboardController');

const silentLogger = { log() {}, warn() {}, error() {} };
const PAYLOAD = {
  node_id: 1, seq: 1, uptime_ms: 15000,
  level_mv: 142, level_raw: 0, rain_mv: 3150, rain_raw: 4095, soil_mv: 2741, soil_raw: 3245,
};

function fakeDashboardService() {
  const created = [];
  return {
    created,
    overview: async () => ({ nodes: [], summary: { total: 0, byStatus: {}, online: 0 } }),
    history: async (nodeId, range) => ({ node: { id: nodeId }, range, points: [], events: [] }),
    exportCsv: async () => ({ content: '\uFEFFdata_hora;seq\r\n' }),
    createNode: async (input) => { created.push(input); return { id: input.id, name: input.name, calibration_id: 7 }; },
    updateNode: async (nodeId, changes) => ({ id: nodeId, ...changes }),
  };
}

function fakeRulerService() {
  const requests = [];
  return {
    requests,
    plan: async (nodeId, rulerCm) => { requests.push(['plan', nodeId, rulerCm]); return { nodeId, rulerCm, shiftMv: 22 }; },
    adjust: async (nodeId, rulerCm) => { requests.push(['apply', nodeId, rulerCm]); return { nodeId, rulerCm, shiftMv: 22, calibrationId: 30 }; },
    record: async (nodeId, rulerCm) => { requests.push(['record', nodeId, rulerCm]); return { id: 5, nodeId, rulerCm }; },
    remove: async (checkId) => { requests.push(['remove', checkId]); },
  };
}

function fakeAnnotationService() {
  const added = [];
  return {
    added,
    add: async (input) => { added.push(input); return { id: 1, ...input }; },
    remove: async () => {},
    list: async () => [],
  };
}

function fakeDecisionService() {
  return {
    live: async () => ({ places: [] }),
    simulate: async (input) => ({ inputs: input, steps: { final: { status: 'NORMAL', rule: 'NIVEL_NORMAL' } } }),
  };
}

async function startApp({ fromServerComputer = true } = {}) {
  const inserted = [];
  const readingService = createReadingService({
    readingRepository: { insert: async (r) => { inserted.push(r); return inserted.length; } },
    calibrationRepository: { findActiveByNode: async () => null },
  });
  const readingRepository = {
    nodeOverview: async () => [{
      node_id: 1, name: 'Caixa 1', recorded_at: new Date(), level_mv: 142, rain_mv: 3150, soil_mv: 2741,
      level_range: null, status: null, total_readings: 1, unclassified: 1,
    }],
  };
  const dashboardService = fakeDashboardService();
  const rulerService = fakeRulerService();
  const annotationService = fakeAnnotationService();
  const app = createApp({
    readingController: createReadingController({ readingService, logger: silentLogger }),
    statusController: createStatusController({ readingRepository, pingDatabase: async () => {} }),
    dashboardController: createDashboardController({
      dashboardService,
      rulerService,
      annotationService,
      decisionService: fakeDecisionService(),
      isServerComputer: () => fromServerComputer,
      now: () => 1_000_000_000,
    }),
    logger: silentLogger,
  });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, inserted, dashboardService, rulerService, annotationService, close: () => new Promise((resolve) => server.close(resolve)) };
}

const post = (url, body) => fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

test('POST /readings válido → 201 e grava', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const response = await post(`${app.base}/readings`, PAYLOAD);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true, id: 1 });
  assert.equal(app.inserted.length, 1);
});

test('POST /readings inválido → 400 com mensagem', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const response = await post(`${app.base}/readings`, { ...PAYLOAD, level_raw: 9999 });
  assert.equal(response.status, 400);
  assert.match((await response.json()).erro, /level_raw/);
});

test('JSON quebrado → 400', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const response = await post(`${app.base}/readings`, '{lixo');
  assert.equal(response.status, 400);
});

test('GET / mostra o painel, /status a tabela simples, /api/nodes o JSON, /health o banco', async (t) => {
  const app = await startApp();
  t.after(app.close);
  const panel = await fetch(`${app.base}/`);
  assert.equal(panel.status, 200);
  assert.match(await panel.text(), /Monitoramento de Enchentes/);
  const page = await fetch(`${app.base}/status`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Caixa 1/);
  assert.equal((await (await fetch(`${app.base}/api/nodes`)).json())[0].node_id, 1);
  assert.deepEqual(await (await fetch(`${app.base}/health`)).json(), { ok: true, banco: 'ok' });
});

test('rota inexistente → 404', async (t) => {
  const app = await startApp();
  t.after(app.close);
  assert.equal((await fetch(`${app.base}/nada`)).status, 404);
});

test('cliente do Python: segue o contrato e trata erros', async () => {
  const ok = createClassifierClient('http://py', {
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ status: 'RISCO', rule: 'NIVEL_CRISTA', threshold_set_id: 1 }) }),
  });
  assert.deepEqual(await ok.classify({}), { status: 'RISCO', rule: 'NIVEL_CRISTA', thresholdSetId: 1 });

  const invalid = createClassifierClient('http://py', {
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ status: 'PERIGO', rule: 'x', threshold_set_id: 1 }) }),
  });
  await assert.rejects(invalid.classify({}), { name: 'PermanentClassificationError' });

  const down = createClassifierClient('http://py', { fetchImpl: async () => ({ ok: false, status: 503 }) });
  await assert.rejects(down.classify({}), (error) => error.name === 'Error');
});

test('painel: cadastro de local só pelo computador do servidor', async (t) => {
  const remote = await startApp({ fromServerComputer: false });
  t.after(remote.close);
  const denied = await post(`${remote.base}/api/nodes`, { id: 4, name: 'Ponte' });
  assert.equal(denied.status, 403);
  assert.equal(remote.dashboardService.created.length, 0);

  const local = await startApp();
  t.after(local.close);
  const created = await post(`${local.base}/api/nodes`, { id: 4, name: '  Ponte  ', copyCalibrationFrom: 2 });
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), { ok: true, node: { id: 4, name: 'Ponte', calibrated: true } });
  assert.deepEqual(local.dashboardService.created[0],
    { id: 4, name: 'Ponte', description: null, zone: null, riverPosition: null, copyCalibrationFrom: 2 });
});

test('painel: dados inválidos do cadastro → 400 com mensagem', async (t) => {
  const app = await startApp();
  t.after(app.close);
  for (const body of [{ id: 0, name: 'x' }, { id: 4, name: '' }, { id: 4, name: 'x', copyCalibrationFrom: 'abc' }]) {
    const response = await post(`${app.base}/api/nodes`, body);
    assert.equal(response.status, 400, JSON.stringify(body));
  }
});

test('painel: histórico valida o local e o período; CSV sai como arquivo', async (t) => {
  const app = await startApp();
  t.after(app.close);
  assert.equal((await fetch(`${app.base}/api/nodes/abc/history`)).status, 400);
  assert.equal((await fetch(`${app.base}/api/nodes/2/history?from=200&to=100`)).status, 400);
  const history = await fetch(`${app.base}/api/nodes/2/history?from=1000&to=61000`);
  assert.deepEqual((await history.json()).range, { fromMs: 1000, toMs: 61000 });

  const csv = await fetch(`${app.base}/api/nodes/2/readings.csv?from=1000&to=61000`);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.headers.get('content-disposition'), /attachment; filename="local-2_/);
});

test('painel: ajuste pela régua; prévia para todos, gravar só pelo computador do servidor', async (t) => {
  const remote = await startApp({ fromServerComputer: false });
  t.after(remote.close);
  const preview = await fetch(`${remote.base}/api/nodes/2/ruler-adjustment?rulerCm=2,1`);
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).shiftMv, 22);
  assert.equal((await post(`${remote.base}/api/nodes/2/ruler-adjustment`, { rulerCm: '2,1' })).status, 403);
  assert.deepEqual(remote.rulerService.requests, [['plan', 2, 2.1]]);

  const local = await startApp();
  t.after(local.close);
  assert.equal((await post(`${local.base}/api/nodes/2/ruler-adjustment`, { rulerCm: 'abc' })).status, 400);
  const applied = await post(`${local.base}/api/nodes/2/ruler-adjustment`, { rulerCm: '2,0' });
  assert.equal(applied.status, 201);
  assert.equal((await applied.json()).calibrationId, 30);
  assert.deepEqual(local.rulerService.requests, [['apply', 2, 2]]);
});

test('painel: medida da régua e anotações só gravam pelo computador do servidor', async (t) => {
  const remote = await startApp({ fromServerComputer: false });
  t.after(remote.close);
  assert.equal((await post(`${remote.base}/api/nodes/2/ruler-checks`, { rulerCm: '2,0' })).status, 403);
  assert.equal((await post(`${remote.base}/api/annotations`, { text: 'Coloquei água' })).status, 403);
  assert.equal((await fetch(`${remote.base}/api/annotations/1`, { method: 'DELETE' })).status, 403);

  const local = await startApp();
  t.after(local.close);
  assert.equal((await post(`${local.base}/api/nodes/2/ruler-checks`, { rulerCm: '2,0' })).status, 201);
  assert.equal((await post(`${local.base}/api/annotations`, { text: '   ' })).status, 400);
  const note = await post(`${local.base}/api/annotations`, { nodeId: 2, text: 'Coloquei água' });
  assert.equal(note.status, 201);
  assert.deepEqual(local.annotationService.added, [{ nodeId: 2, timeMs: 1_000_000_000, text: 'Coloquei água' }]);
  assert.equal((await fetch(`${local.base}/api/ruler-checks/abc`, { method: 'DELETE' })).status, 400);
});

test('painel: simulador valida os valores e não precisa ser o computador do servidor', async (t) => {
  const remote = await startApp({ fromServerComputer: false });
  t.after(remote.close);
  const ok = await post(`${remote.base}/api/decision/simulate`, { nodeId: 2, rulerCm: '2,7', raining: true, soilPercent: 85, previousStatus: 'NORMAL' });
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).inputs, { nodeId: 2, rulerCm: 2.7, raining: true, soilIndex: 0.85, previousStatus: 'NORMAL' });
  for (const body of [{ nodeId: 2, rulerCm: '2', raining: 'sim', soilPercent: 10 }, { nodeId: 2, rulerCm: '2', raining: true, soilPercent: 120 },
    { nodeId: 2, rulerCm: '2', raining: true, soilPercent: 10, previousStatus: 'ALERTA' }]) {
    assert.equal((await post(`${remote.base}/api/decision/simulate`, body)).status, 400, JSON.stringify(body));
  }
});
