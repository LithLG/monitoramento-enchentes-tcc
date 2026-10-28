'use strict';

const KEEP_MS = 10 * 60 * 1000;

// A node that is not in the "node" table sends readings that the server refuses.
// The panel shows these nodes, so that the user can register them.
function createUnknownNodeTracker({ now = Date.now, keepMs = KEEP_MS } = {}) {
  const seen = new Map();

  function record({ nodeId, sourceIp }) {
    const previous = seen.get(nodeId);
    seen.set(nodeId, {
      nodeId,
      sourceIp: sourceIp ?? previous?.sourceIp ?? null,
      firstSeenMs: previous?.firstSeenMs ?? now(),
      lastSeenMs: now(),
      attempts: (previous?.attempts ?? 0) + 1,
    });
  }

  function list() {
    const oldestKept = now() - keepMs;
    for (const [nodeId, entry] of seen) {
      if (entry.lastSeenMs < oldestKept) seen.delete(nodeId);
    }
    return [...seen.values()].sort((a, b) => a.nodeId - b.nodeId);
  }

  function forget(nodeId) {
    seen.delete(nodeId);
  }

  return { record, list, forget };
}

module.exports = { createUnknownNodeTracker };
