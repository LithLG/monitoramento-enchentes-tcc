'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReadingService } = require('../src/services/readingService');
const { createClassificationService } = require('../src/services/classificationService');
const { PermanentClassificationError } = require('../src/services/classifierClient');
const { ValidationError } = require('../src/errors');

const PAYLOAD = Object.freeze({
  node_id: 1, seq: 1, uptime_ms: 15000,
  level_mv: 1350, level_raw: 1500, rain_mv: 1600, rain_raw: 1800, soil_mv: 2000, soil_raw: 2200,
});
const CALIBRATION = Object.freeze({
  id: 3, level_curve: [[150, 0], [930, 5], [1770, 20], [2300, 40]], sensor_tip_above_bed_mm: 10,
  soil_dry_mv: 2750, soil_saturated_mv: 1900, rain_wet_below_mv: 2900, rain_heavy_below_mv: 2000,
});
const silentLogger = { log() {}, warn() {}, error() {} };

function mysqlError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

test('grava a leitura convertida com a calibração ativa e avisa quem classifica', async () => {
  const inserted = [];
  const stored = [];
  const service = createReadingService({
    readingRepository: { insert: async (r) => { inserted.push(r); return 42; } },
    calibrationRepository: { findActiveByNode: async () => CALIBRATION },
    onReadingStored: (id) => stored.push(id),
  });

  const result = await service.store(PAYLOAD);

  assert.equal(result.id, 42);
  assert.equal(inserted[0].calibrationId, 3);
  assert.equal(inserted[0].levelDepthMm, 22.5);
  assert.equal(inserted[0].rainClass, 'CHUVA_INTENSA');
  assert.deepEqual(stored, [42]);
});

test('sem calibração, grava só o bruto', async () => {
  const inserted = [];
  const service = createReadingService({
    readingRepository: { insert: async (r) => { inserted.push(r); return 1; } },
    calibrationRepository: { findActiveByNode: async () => null },
  });
  await service.store(PAYLOAD);
  assert.equal(inserted[0].calibrationId, null);
  assert.equal(inserted[0].level_mv, 1350);
});

test('leitura repetida não é erro: devolve duplicate e não avisa a classificação', async () => {
  let notified = false;
  const service = createReadingService({
    readingRepository: { insert: async () => { throw mysqlError('ER_DUP_ENTRY'); } },
    calibrationRepository: { findActiveByNode: async () => null },
    onReadingStored: () => { notified = true; },
  });
  const result = await service.store(PAYLOAD);
  assert.equal(result.duplicate, true);
  assert.equal(notified, false);
});

test('nó não cadastrado vira erro de validação (HTTP 400), não erro interno', async () => {
  for (const code of ['ER_NO_REFERENCED_ROW', 'ER_NO_REFERENCED_ROW_2']) {
    const service = createReadingService({
      readingRepository: { insert: async () => { throw mysqlError(code); } },
      calibrationRepository: { findActiveByNode: async () => null },
    });
    await assert.rejects(service.store({ ...PAYLOAD, node_id: 9 }), ValidationError, code);
  }
});

test('nó não cadastrado é avisado ao painel com o endereço de quem enviou', async () => {
  const unknown = [];
  const service = createReadingService({
    readingRepository: { insert: async () => { throw mysqlError('ER_NO_REFERENCED_ROW_2'); } },
    calibrationRepository: { findActiveByNode: async () => null },
    onUnknownNode: (info) => unknown.push(info),
  });
  await assert.rejects(service.store({ ...PAYLOAD, node_id: 4 }, { sourceIp: '192.168.10.23' }), ValidationError);
  assert.deepEqual(unknown, [{ nodeId: 4, sourceIp: '192.168.10.23' }]);
});

function fakeClassificationRepository(pending) {
  const classifications = [];
  return {
    classifications,
    findUnclassified: async () => pending,
    findPreviousStatus: async (nodeId, readingId) => {
      const previous = classifications.filter((c) => c.readingId < readingId).at(-1);
      return previous ? previous.status : null;
    },
    insertClassification: async (c) => { classifications.push(c); },
  };
}

const PENDING = [
  { id: 1, node_id: 1, level_range: 'DENTRO', level_depth_mm: 15, rain_class: 'SECO', soil_index: 0.1, bankfull_depth_mm: 30 },
  { id: 2, node_id: 1, level_range: 'DENTRO', level_depth_mm: 25, rain_class: 'CHUVA', soil_index: 0.5, bankfull_depth_mm: 30 },
];

test('sem Python configurado, não classifica nada (leituras continuam pendentes)', async () => {
  const repository = fakeClassificationRepository(PENDING);
  const service = createClassificationService({ readingRepository: repository, classifierClient: null });
  assert.equal(await service.classifyPending(), 0);
  assert.equal(repository.classifications.length, 0);
});

test('classifica em ordem e envia a classe anterior (histerese)', async () => {
  const repository = fakeClassificationRepository(PENDING);
  const sent = [];
  const classifierClient = {
    classify: async (input) => {
      sent.push(input);
      return { status: input.level_depth_mm >= 20 ? 'ATENCAO' : 'NORMAL', rule: 'NIVEL', thresholdSetId: 1 };
    },
  };
  const service = createClassificationService({ readingRepository: repository, classifierClient, logger: silentLogger });

  assert.equal(await service.classifyPending(), 2);
  assert.equal(sent[0].previous_status, null);
  assert.equal(sent[1].previous_status, 'NORMAL');
  assert.deepEqual(repository.classifications.map((c) => c.status), ['NORMAL', 'ATENCAO']);
});

test('Python fora do ar: para sem perder nada e tenta no próximo ciclo', async () => {
  const repository = fakeClassificationRepository(PENDING);
  const classifierClient = { classify: async () => { throw new Error('ECONNREFUSED'); } };
  const service = createClassificationService({ readingRepository: repository, classifierClient, logger: silentLogger });
  assert.equal(await service.classifyPending(), 0);
  assert.equal(repository.classifications.length, 0);
});

test('Python recusa UMA leitura: pula ela e continua as outras', async () => {
  const repository = fakeClassificationRepository(PENDING);
  const classifierClient = {
    classify: async (input) => {
      if (input.reading_id === 1) throw new PermanentClassificationError('HTTP 422');
      return { status: 'ATENCAO', rule: 'NIVEL', thresholdSetId: 1 };
    },
  };
  const service = createClassificationService({ readingRepository: repository, classifierClient, logger: silentLogger });
  assert.equal(await service.classifyPending(), 1);
  assert.equal(repository.classifications[0].readingId, 2);
});

test('leituras que chegam juntas são todas classificadas, sem esperar o próximo ciclo', async () => {
  const pending = [{ ...PENDING[0], id: 1, node_id: 1 }];
  const classified = [];
  const repository = {
    findUnclassified: async () => pending.filter((r) => !classified.includes(r.id)),
    findPreviousStatus: async () => null,
    insertClassification: async ({ readingId }) => { classified.push(readingId); },
  };
  const classifierClient = {
    classify: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { status: 'NORMAL', rule: 'NIVEL_NORMAL', thresholdSetId: 1 };
    },
  };
  const service = createClassificationService({ readingRepository: repository, classifierClient, logger: silentLogger });

  const firstRun = service.classifyPending();
  pending.push({ ...PENDING[0], id: 2, node_id: 2 }, { ...PENDING[0], id: 3, node_id: 3 });
  await service.classifyPending();
  await service.classifyPending();
  await firstRun;

  assert.deepEqual(classified.sort(), [1, 2, 3]);
});
