'use strict';
const {
  localDayStarts, dailyCoverage, totalShare, withOngoingGap, markSharedGaps, gapSummary, READING_INTERVAL_MS, GAP_MS,
} = require('./sensorHealth');
const { rulerErrorSummary, describeCheck } = require('./rulerChecks');
const { inRiverOrder } = require('./riverOrder');
const { nodeGeometry } = require('./levelGeometry');

const READINGS_CACHE_MS = 60 * 1000;
const CHECKS_LIST_LIMIT = 200;

function createSensorHealthService({ dashboardRepository, nodeRepository, fieldNotesRepository, display, now = Date.now }) {
  let readingsCache = null;

  // The 7-day reading counts are the heavy part, so they are kept for one minute.
  async function readingStats(nowMs) {
    const isFresh = readingsCache && nowMs - readingsCache.loadedMs < READINGS_CACHE_MS;
    if (isFresh) return readingsCache;
    const dayStarts = localDayStarts(nowMs);
    const [hourly, gaps, spans] = await Promise.all([
      dashboardRepository.hourlyReadingCounts(dayStarts[0]),
      dashboardRepository.readingGaps(dayStarts[0], GAP_MS),
      dashboardRepository.readingSpanPerNode(),
    ]);
    readingsCache = { loadedMs: nowMs, dayStarts, hourly, gaps, spans };
    return readingsCache;
  }

  async function health() {
    const nowMs = now();
    const [nodes, stats, checks, ready] = await Promise.all([
      nodeRepository.listWithCalibration(),
      readingStats(nowMs),
      fieldNotesRepository.rulerChecks({ limit: 1000 }),
      fieldNotesRepository.checkReady(nowMs),
    ]);
    const ordered = inRiverOrder(nodes);
    const spanByNode = new Map(stats.spans.map((span) => [span.nodeId, span]));
    const firstMsByNode = new Map(stats.spans.map((span) => [span.nodeId, span.firstMs]));
    const gapsByNode = new Map(ordered.map((node) => [
      node.id,
      withOngoingGap(stats.gaps.filter((gap) => gap.nodeId === node.id), spanByNode.get(node.id)?.lastMs ?? null, nowMs),
    ]));
    const markedGaps = markSharedGaps(gapsByNode, firstMsByNode);
    const calibrations = await Promise.all(ordered.map((node) => nodeRepository.calibrationHistory(node.id)));
    const geometryById = new Map(nodes.map((node) => [node.id, nodeGeometry(node, display)]));
    const checksWithError = checks.map((check) => describeCheck(check, geometryById.get(check.nodeId) ?? null));

    const places = ordered.map((node, index) => {
      const days = dailyCoverage(stats.hourly.filter((hour) => hour.nodeId === node.id), {
        dayStarts: stats.dayStarts,
        firstMs: firstMsByNode.get(node.id) ?? null,
        nowMs,
      });
      const nodeChecks = checksWithError.filter((check) => check.nodeId === node.id);
      return {
        id: node.id,
        name: node.name,
        zone: node.zone ?? null,
        lastReadingMs: spanByNode.get(node.id)?.lastMs ?? null,
        coverage: { share: totalShare(days), days },
        gaps: gapSummary(markedGaps.get(node.id) ?? []),
        calibrations: { count: calibrations[index].length, current: calibrations[index].find((c) => c.active) ?? null },
        ruler: { summary: rulerErrorSummary(nodeChecks), last: nodeChecks[0] ?? null },
      };
    });

    const nameById = new Map(nodes.map((node) => [node.id, node.name]));
    return {
      generatedMs: nowMs,
      intervalMs: READING_INTERVAL_MS,
      dayStarts: stats.dayStarts,
      places,
      ruler: {
        ready,
        summary: rulerErrorSummary(checksWithError),
        checks: checksWithError.slice(0, CHECKS_LIST_LIMIT).map((check) => ({ ...check, nodeName: nameById.get(check.nodeId) ?? `Nó ${check.nodeId}` })),
      },
    };
  }

  return { health };
}

module.exports = { createSensorHealthService };
