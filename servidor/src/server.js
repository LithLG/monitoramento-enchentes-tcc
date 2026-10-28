'use strict';
const { loadConfig } = require('./config');
const { createPool } = require('./database/pool');
const { createReadingRepository } = require('./database/readingRepository');
const { createCalibrationRepository } = require('./database/calibrationRepository');
const { createReadingService } = require('./services/readingService');
const { createClassifierClient, CLASSIFIER_STATE } = require('./services/classifierClient');
const { createClassificationService } = require('./services/classificationService');
const { createReadingController } = require('./controllers/readingController');
const { createStatusController } = require('./controllers/statusController');
const { createDashboardController } = require('./controllers/dashboardController');
const { createDashboardRepository } = require('./database/dashboardRepository');
const { createNodeRepository } = require('./database/nodeRepository');
const { createDashboardService } = require('./services/dashboard/dashboardService');
const { createRulerService } = require('./services/dashboard/rulerService');
const { createDecisionService } = require('./services/dashboard/decisionService');
const { createAnnotationService } = require('./services/dashboard/annotationService');
const { createSensorHealthService } = require('./services/dashboard/sensorHealthService');
const { createFieldNotesRepository } = require('./database/fieldNotesRepository');
const { createUnknownNodeTracker } = require('./services/dashboard/unknownNodeTracker');
const { createServerComputerCheck } = require('./middlewares/serverComputer');
const { createApp } = require('./app');
const { startDiscoveryBeacon, localIPv4Interfaces } = require('./discovery/beacon');

async function ensureDatabaseIsReachable(pingDatabase) {
  try {
    await pingDatabase();
  } catch (error) {
    throw new Error(`não consegui conectar no MySQL (${error.message}). `
      + 'O serviço MySQL84 está rodando? Usuário e senha do .env estão certos?');
  }
}

const CLASSIFIER_HEALTH_CACHE_MS = 10 * 1000;

function cachedFor(ttlMs, load) {
  let value;
  let loadedAtMs = -Infinity;
  return async () => {
    if (Date.now() - loadedAtMs > ttlMs) {
      value = await load();
      loadedAtMs = Date.now();
    }
    return value;
  };
}

function printStartupInfo(config) {
  console.log(`Servidor ouvindo na porta ${config.port}. Painel: http://localhost:${config.port}`);
  for (const { address } of localIPv4Interfaces()) {
    console.log(`Painel pelo celular (mesmo Wi-Fi): http://${address}:${config.port}`);
  }
  console.log(config.pythonUrl
    ? `Classificação: Python em ${config.pythonUrl}`
    : 'Classificação: PYTHON_URL vazio — leituras ficam gravadas como não classificadas');
  console.log('Aguardando leituras... (Ctrl+C para parar)');
}

async function main() {
  const config = loadConfig();
  const pool = createPool(config.db);
  const pingDatabase = () => pool.query('SELECT 1');
  await ensureDatabaseIsReachable(pingDatabase);

  const readingRepository = createReadingRepository(pool);
  const calibrationRepository = createCalibrationRepository(pool);
  const classifierClient = config.pythonUrl ? createClassifierClient(config.pythonUrl) : null;
  const classificationService = createClassificationService({ readingRepository, classifierClient });
  const classifyPendingInBackground = () => {
    classificationService.classifyPending().catch((error) => console.error('[classificação]', error));
  };

  const unknownNodeTracker = createUnknownNodeTracker();
  const readingService = createReadingService({
    readingRepository,
    calibrationRepository,
    onReadingStored: classifyPendingInBackground,
    onUnknownNode: unknownNodeTracker.record,
  });

  const dashboardRepository = createDashboardRepository(pool);
  const nodeRepository = createNodeRepository(pool);
  const fieldNotesRepository = createFieldNotesRepository(pool);
  const dashboardService = createDashboardService({
    dashboardRepository,
    nodeRepository,
    fieldNotesRepository,
    unknownNodeTracker,
    checkClassifier: classifierClient
      ? cachedFor(CLASSIFIER_HEALTH_CACHE_MS, classifierClient.health)
      : async () => CLASSIFIER_STATE.NOT_CONFIGURED,
    display: config.display,
  });

  const app = createApp({
    readingController: createReadingController({ readingService }),
    statusController: createStatusController({ readingRepository, pingDatabase }),
    dashboardController: createDashboardController({
      dashboardService,
      rulerService: createRulerService({
        nodeRepository,
        dashboardRepository,
        fieldNotesRepository,
        display: config.display,
        onCalibrationChanged: dashboardService.forgetDrift,
      }),
      decisionService: createDecisionService({ dashboardRepository, nodeRepository, classifierClient, display: config.display }),
      annotationService: createAnnotationService({ fieldNotesRepository, nodeRepository }),
      sensorHealthService: createSensorHealthService({
        dashboardRepository, nodeRepository, fieldNotesRepository, display: config.display,
      }),
      isServerComputer: createServerComputerCheck(),
    }),
  });

  const server = app.listen(config.port, '0.0.0.0', () => printStartupInfo(config));
  const stopDiscoveryBeacon = startDiscoveryBeacon({
    httpPort: config.port,
    discoveryPort: config.discoveryPort,
    intervalMs: config.discoveryIntervalMs,
  });
  const retryTimer = config.classifyIntervalMs > 0
    ? setInterval(classifyPendingInBackground, config.classifyIntervalMs)
    : null;

  const shutdown = () => {
    console.log('\nEncerrando...');
    clearInterval(retryTimer);
    stopDiscoveryBeacon();
    server.close(() => pool.end().finally(() => process.exit(0)));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(`Erro ao iniciar: ${error.message}`);
  process.exit(1);
});
