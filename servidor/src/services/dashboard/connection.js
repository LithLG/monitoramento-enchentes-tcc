'use strict';

const CONNECTION = Object.freeze({
  ONLINE: 'ONLINE',
  LATE: 'ATRASADO',
  OFFLINE: 'SEM_SINAL',
  NEVER: 'NUNCA_ENVIOU',
});

// The nodes send every 15 s. Three lost readings make the node late; five minutes make it offline.
const LATE_AFTER_MS = 45 * 1000;
const OFFLINE_AFTER_MS = 5 * 60 * 1000;

function connectionState(lastReadingMs, nowMs) {
  if (lastReadingMs === null || lastReadingMs === undefined) return CONNECTION.NEVER;
  const ageMs = nowMs - lastReadingMs;
  if (ageMs > OFFLINE_AFTER_MS) return CONNECTION.OFFLINE;
  if (ageMs > LATE_AFTER_MS) return CONNECTION.LATE;
  return CONNECTION.ONLINE;
}

module.exports = { CONNECTION, connectionState, LATE_AFTER_MS, OFFLINE_AFTER_MS };
