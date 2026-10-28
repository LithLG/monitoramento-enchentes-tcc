'use strict';
const { ValidationError, NotFoundError, ConflictError } = require('../../errors');
const { DuplicateNodeError } = require('../../database/nodeRepository');
const { nodeGeometry, rulerReading, classLimits } = require('./levelGeometry');
const { levelTrend, TREND_WINDOW_MS } = require('./trend');
const { connectionState, CONNECTION } = require('./connection');
const { bucketSecondsFor } = require('./timeRange');
const { toChartPoint, summarize, buildEvents } = require('./history');
const { readingsToCsv } = require('./csv');
const { describeCheck } = require('./rulerChecks');
const { NODE_ID_MAX } = require('./nodeInput');
const { driftWarning, DRIFT_WINDOW_MS, DRIFT_BUCKET_S } = require('./drift');
const { alertEpisodes, leadTimeSummary } = require('./leadTime');
const { inRiverOrder } = require('./riverOrder');

const NO_SIGNAL_GAP_MS = 2 * 60 * 1000;
const RAIN_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const RAIN_CACHE_MS = 30 * 1000;
const DRIFT_CACHE_MS = 5 * 60 * 1000;
const RAINY_CLASSES = new Set(['CHUVA', 'CHUVA_INTENSA']);
const NO_FIELD_NOTES = Object.freeze({
  annotations: async () => [],
  rulerChecks: async () => [],
  checkReady: async () => false,
});

function firstFreeNodeId(nodes) {
  const used = new Set(nodes.map((node) => node.id));
  for (let id = 1; id <= NODE_ID_MAX; id += 1) {
    if (!used.has(id)) return id;
  }
  return null;
}

function calibrationSummary(node) {
  if (node.calibration_id === null) return null;
  return {
    id: node.calibration_id,
    createdMs: node.calibration_created_ms,
    notes: node.calibration_notes,
    curve: node.level_curve,
    soilDryMv: node.soil_dry_mv,
    soilSaturatedMv: node.soil_saturated_mv,
    rainWetBelowMv: node.rain_wet_below_mv,
  };
}

function createDashboardService({
  dashboardRepository,
  nodeRepository,
  unknownNodeTracker,
  checkClassifier = async () => 'NAO_CONFIGURADO',
  fieldNotesRepository = NO_FIELD_NOTES,
  display,
  now = Date.now,
}) {
  const statusSinceCache = new Map();
  const lastRainCache = new Map();
  const driftCache = new Map();

  async function statusSince(nodeId, status) {
    const cached = statusSinceCache.get(nodeId);
    if (cached && cached.status === status) return cached.sinceMs;
    const sinceMs = await dashboardRepository.statusSince(nodeId, status);
    statusSinceCache.set(nodeId, { status, sinceMs });
    return sinceMs;
  }

  async function lastRain(nodeId, latest, nowMs) {
    const latestIsRainy = latest && RAINY_CLASSES.has(latest.rain_class);
    if (latestIsRainy) {
      lastRainCache.set(nodeId, { timeMs: latest.time_ms, checkedMs: nowMs });
      return latest.time_ms;
    }
    const cached = lastRainCache.get(nodeId);
    if (cached && nowMs - cached.checkedMs < RAIN_CACHE_MS) return cached.timeMs;
    const timeMs = await dashboardRepository.lastRainMs(nodeId, nowMs - RAIN_LOOKBACK_MS);
    lastRainCache.set(nodeId, { timeMs, checkedMs: nowMs });
    return timeMs;
  }

  async function sensorDrift(node, nowMs) {
    const cached = driftCache.get(node.id);
    const isFresh = cached && cached.calibrationId === node.calibration_id && nowMs - cached.checkedMs < DRIFT_CACHE_MS;
    if (isFresh) return cached.warning;
    const buckets = await dashboardRepository.driftBuckets(node.id, node.calibration_id, nowMs - DRIFT_WINDOW_MS, DRIFT_BUCKET_S);
    const warning = driftWarning(buckets);
    driftCache.set(node.id, { calibrationId: node.calibration_id, checkedMs: nowMs, warning });
    return warning;
  }

  async function describeNode(node, { thresholds, latest, classification, nowMs }) {
    const geometry = nodeGeometry(node, display);
    const limits = classLimits(thresholds, geometry);
    const hasReading = latest !== undefined && latest.id !== null;
    const connection = connectionState(hasReading ? latest.time_ms : null, nowMs);
    const canCheckDrift = connection === CONNECTION.ONLINE && node.calibration_id !== null;

    const [recentLevels, sinceMs, lastRainMs, drift] = await Promise.all([
      hasReading ? dashboardRepository.recentLevels(node.id, nowMs - TREND_WINDOW_MS) : [],
      classification ? statusSince(node.id, classification.status) : null,
      hasReading ? lastRain(node.id, latest, nowMs) : null,
      canCheckDrift ? sensorDrift(node, nowMs) : null,
    ]);

    const soilIndex = hasReading && latest.soil_index !== null ? Number(latest.soil_index) : null;
    return {
      id: node.id,
      name: node.name,
      description: node.description,
      zone: node.zone,
      riverPosition: node.river_position,
      createdMs: node.created_ms,
      calibration: calibrationSummary(node),
      geometry,
      limits,
      connection,
      latest: hasReading ? {
        timeMs: latest.time_ms,
        levelMv: latest.level_mv,
        rainMv: latest.rain_mv,
        soilMv: latest.soil_mv,
        level: rulerReading({ levelRange: latest.level_range, levelDepthMm: latest.level_depth_mm }, geometry),
        rainClass: latest.rain_class,
        raining: RAINY_CLASSES.has(latest.rain_class),
        soilIndex,
        soilSaturated: soilIndex !== null && thresholds !== null && soilIndex >= thresholds.soilSaturatedIndex,
      } : null,
      lastRainMs,
      classification: classification ? {
        status: classification.status,
        rule: classification.rule,
        timeMs: classification.time_ms,
        sinceMs,
      } : null,
      trend: levelTrend(recentLevels, nowMs, limits),
      drift,
    };
  }

  function countBy(items, key) {
    return items.reduce((counts, item) => {
      const value = key(item);
      if (value) counts[value] = (counts[value] ?? 0) + 1;
      return counts;
    }, {});
  }

  async function overview() {
    const nowMs = now();
    const [thresholds, nodes, latestRows, classificationRows, classifier, fieldNotesReady] = await Promise.all([
      dashboardRepository.activeThresholds(),
      nodeRepository.listWithCalibration(),
      dashboardRepository.latestReadingPerNode(),
      dashboardRepository.latestClassificationPerNode(),
      checkClassifier(),
      fieldNotesRepository.checkReady(nowMs),
    ]);
    const latestByNode = new Map(latestRows.map((row) => [row.node_id, row]));
    const classificationByNode = new Map(classificationRows.map((row) => [row.node_id, row]));

    const described = await Promise.all(inRiverOrder(nodes).map((node) => describeNode(node, {
      thresholds,
      latest: latestByNode.get(node.id),
      classification: classificationByNode.get(node.id),
      nowMs,
    })));

    return {
      generatedMs: nowMs,
      thresholds,
      nodes: described,
      summary: {
        total: described.length,
        byStatus: countBy(described, (node) => node.classification?.status),
        online: described.filter((node) => node.connection === CONNECTION.ONLINE).length,
      },
      unknownNodes: unknownNodeTracker.list(),
      nextFreeNodeId: firstFreeNodeId(nodes),
      zonesReady: nodeRepository.supportsZones(),
      fieldNotesReady,
      services: { database: 'ONLINE', classifier },
      display,
    };
  }

  async function requireNode(nodeId) {
    const node = await nodeRepository.findById(nodeId);
    if (!node) throw new NotFoundError(`local ${nodeId} não encontrado`);
    return node;
  }

  async function history(nodeId, range) {
    const node = await requireNode(nodeId);
    const geometry = nodeGeometry(node, display);
    const bucketSeconds = bucketSecondsFor(range);

    const [thresholds, buckets, changes, calibrations, annotations, checks] = await Promise.all([
      dashboardRepository.activeThresholds(),
      dashboardRepository.historyBuckets(nodeId, range, bucketSeconds),
      dashboardRepository.changeRows(nodeId, range, NO_SIGNAL_GAP_MS),
      nodeRepository.calibrationHistory(nodeId),
      fieldNotesRepository.annotations({ nodeId, ...range }),
      fieldNotesRepository.rulerChecks({ nodeId, ...range }),
    ]);
    const episodes = alertEpisodes(changes);

    return {
      node: { id: node.id, name: node.name, zone: node.zone },
      range,
      bucketSeconds,
      limits: classLimits(thresholds, geometry),
      geometry,
      points: buckets.map((bucket) => toChartPoint(bucket, geometry)),
      events: buildEvents(changes, { gapMs: NO_SIGNAL_GAP_MS, geometry }),
      stats: summarize(buckets, geometry),
      leadTimes: { episodes, summary: leadTimeSummary(episodes) },
      calibrations,
      annotations,
      rulerChecks: checks.map((check) => describeCheck(check, geometry)),
    };
  }

  async function exportCsv(nodeId, range) {
    const node = await requireNode(nodeId);
    const rows = await dashboardRepository.exportRows(nodeId, range);
    return { node, content: readingsToCsv(rows, nodeGeometry(node, display)) };
  }

  async function createNode(input) {
    if (input.copyCalibrationFrom !== null) {
      const source = await nodeRepository.findById(input.copyCalibrationFrom);
      const sourceHasCalibration = source !== null && source.calibration_id !== null;
      if (!sourceHasCalibration) throw new ValidationError(`o local ${input.copyCalibrationFrom} não tem calibração para copiar`);
    }

    try {
      await nodeRepository.create(input);
    } catch (error) {
      if (error instanceof DuplicateNodeError) throw new ConflictError(`já existe um local com o número ${input.id}`);
      throw error;
    }
    unknownNodeTracker.forget(input.id);
    return requireNode(input.id);
  }

  async function updateNode(nodeId, changes) {
    await requireNode(nodeId);
    await nodeRepository.update(nodeId, changes);
    return requireNode(nodeId);
  }

  const forgetDrift = (nodeId) => driftCache.delete(nodeId);

  return { overview, history, exportCsv, createNode, updateNode, forgetDrift };
}

module.exports = { createDashboardService, firstFreeNodeId, inRiverOrder };
