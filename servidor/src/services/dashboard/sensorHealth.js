'use strict';

const READING_INTERVAL_MS = 15 * 1000;
const HEALTH_DAYS = 7;
const GAP_MS = 2 * 60 * 1000;
const SHARED_GAP_SLACK_MS = 60 * 1000;
const RECENT_GAPS = 5;

// Local midnights (time zone of the server PC), oldest first, today last.
function localDayStarts(nowMs, days = HEALTH_DAYS) {
  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(today);
    day.setDate(today.getDate() - (days - 1 - i));
    return day.getTime();
  });
}

function nextDayStart(dayStartMs) {
  const next = new Date(dayStartMs);
  next.setDate(next.getDate() + 1);
  return next.getTime();
}

/*
 * Received = readings that arrived in the day. Expected = one reading every 15 s, counted only
 * from the first reading of the place and only up to now (today is not over yet).
 */
function dailyCoverage(hourly, { dayStarts, firstMs, nowMs, intervalMs = READING_INTERVAL_MS }) {
  return dayStarts.map((dayStartMs) => {
    const dayEndMs = nextDayStart(dayStartMs);
    const received = hourly
      .filter((hour) => hour.hourMs >= dayStartMs && hour.hourMs < dayEndMs)
      .reduce((total, hour) => total + hour.readings, 0);
    const windowMs = Math.min(dayEndMs, nowMs) - Math.max(dayStartMs, firstMs ?? Infinity);
    const expected = Math.max(0, Math.floor(windowMs / intervalMs));
    return { dayStartMs, received, expected, share: expected > 0 ? Math.min(1, received / expected) : null };
  });
}

function totalShare(days) {
  const expected = days.reduce((total, day) => total + day.expected, 0);
  const received = days.reduce((total, day) => total + Math.min(day.received, day.expected), 0);
  return expected > 0 ? received / expected : null;
}

function withOngoingGap(gaps, lastMs, nowMs, gapMs = GAP_MS) {
  const isSilentNow = lastMs !== null && lastMs !== undefined && nowMs - lastMs > gapMs;
  return isSilentNow ? [...gaps, { startMs: lastMs, endMs: nowMs, ongoing: true }] : gaps;
}

/*
 * A gap is shared when every other place that already existed was also silent at that time.
 * Then the cause is probably the PC or the server (switched off), not the ESP32 or its Wi-Fi.
 */
function markSharedGaps(gapsByNode, firstMsByNode) {
  const covers = (gap, other) => other.startMs <= gap.startMs + SHARED_GAP_SLACK_MS
    && other.endMs >= gap.endMs - SHARED_GAP_SLACK_MS;
  const marked = new Map();
  for (const [nodeId, gaps] of gapsByNode) {
    marked.set(nodeId, gaps.map((gap) => {
      const others = [...gapsByNode.keys()].filter((otherId) => otherId !== nodeId
        && (firstMsByNode.get(otherId) ?? Infinity) < gap.startMs);
      const shared = others.length > 0
        && others.every((otherId) => gapsByNode.get(otherId).some((other) => covers(gap, other)));
      return { ...gap, shared };
    }));
  }
  return marked;
}

function gapSummary(gaps) {
  const durations = gaps.map((gap) => gap.endMs - gap.startMs);
  return {
    count: gaps.length,
    sharedCount: gaps.filter((gap) => gap.shared).length,
    ownCount: gaps.filter((gap) => !gap.shared).length,
    longestMs: durations.length ? Math.max(...durations) : null,
    totalMs: durations.reduce((total, ms) => total + ms, 0),
    recent: [...gaps].sort((a, b) => b.startMs - a.startMs).slice(0, RECENT_GAPS),
  };
}

module.exports = {
  localDayStarts,
  dailyCoverage,
  totalShare,
  withOngoingGap,
  markSharedGaps,
  gapSummary,
  READING_INTERVAL_MS,
  HEALTH_DAYS,
  GAP_MS,
};
