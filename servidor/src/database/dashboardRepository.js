'use strict';

// UNIX_TIMESTAMP gives the same instant for any time zone of Node or MySQL, so all times leave here as epoch ms.
const EPOCH_MS = (column) => `ROUND(UNIX_TIMESTAMP(${column}) * 1000)`;

function createDashboardRepository(pool) {
  async function activeThresholds() {
    const [rows] = await pool.query(
      `SELECT id, name, attention_fraction, risk_fraction, soil_saturated_index,
              level_hysteresis_mm, dry_depth_mm, rationale
         FROM threshold_set
        WHERE is_active`,
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      attentionFraction: Number(row.attention_fraction),
      riskFraction: Number(row.risk_fraction),
      soilSaturatedIndex: Number(row.soil_saturated_index),
      hysteresisMm: Number(row.level_hysteresis_mm),
      dryDepthMm: Number(row.dry_depth_mm),
      rationale: row.rationale,
    };
  }

  async function latestReadingPerNode() {
    const [rows] = await pool.query(
      `SELECT n.id AS node_id, last.id, last.time_ms, last.level_mv, last.rain_mv, last.soil_mv,
              last.level_range, last.level_depth_mm, last.rain_class, last.soil_index
         FROM node n
         LEFT JOIN LATERAL (
           SELECT r.id, ${EPOCH_MS('r.recorded_at')} AS time_ms, r.level_mv, r.rain_mv, r.soil_mv,
                  r.level_range, r.level_depth_mm, r.rain_class, r.soil_index
             FROM reading r
            WHERE r.node_id = n.id
            ORDER BY r.recorded_at DESC, r.id DESC
            LIMIT 1
         ) AS last ON TRUE`,
    );
    return rows;
  }

  async function latestClassificationPerNode() {
    const [rows] = await pool.query(
      `SELECT n.id AS node_id, last.reading_id, last.time_ms, last.status, last.rule
         FROM node n
         JOIN LATERAL (
           SELECT r.id AS reading_id, ${EPOCH_MS('r.recorded_at')} AS time_ms, c.status, c.rule
             FROM reading r
             JOIN classification c ON c.reading_id = r.id
            WHERE r.node_id = n.id
            ORDER BY r.recorded_at DESC, r.id DESC
            LIMIT 1
         ) AS last ON TRUE`,
    );
    return rows;
  }

  async function statusSince(nodeId, status) {
    const [rows] = await pool.execute(
      `SELECT ${EPOCH_MS('MIN(r.recorded_at)')} AS since_ms
         FROM reading r
         JOIN classification c ON c.reading_id = r.id
        WHERE r.node_id = ? AND c.status = ?
          AND r.id > COALESCE((
                SELECT MAX(r2.id)
                  FROM reading r2
                  JOIN classification c2 ON c2.reading_id = r2.id
                 WHERE r2.node_id = ? AND c2.status <> ?), 0)`,
      [nodeId, status, nodeId, status],
    );
    return rows[0]?.since_ms ?? null;
  }

  async function lastRainMs(nodeId, sinceMs) {
    const [rows] = await pool.execute(
      `SELECT ${EPOCH_MS('MAX(recorded_at)')} AS time_ms
         FROM reading
        WHERE node_id = ? AND recorded_at >= FROM_UNIXTIME(? / 1000) AND rain_class IN ('CHUVA', 'CHUVA_INTENSA')`,
      [nodeId, sinceMs],
    );
    return rows[0]?.time_ms ?? null;
  }

  async function recentLevels(nodeId, sinceMs) {
    const [rows] = await pool.execute(
      `SELECT ${EPOCH_MS('recorded_at')} AS time_ms, level_range, level_depth_mm
         FROM reading
        WHERE node_id = ? AND recorded_at >= FROM_UNIXTIME(? / 1000)
        ORDER BY recorded_at, id`,
      [nodeId, sinceMs],
    );
    return rows.map((r) => ({ timeMs: r.time_ms, levelRange: r.level_range, depthMm: r.level_depth_mm }));
  }

  async function recentLevelMv(nodeId, sinceMs) {
    const [rows] = await pool.execute(
      `SELECT level_mv FROM reading
        WHERE node_id = ? AND recorded_at >= FROM_UNIXTIME(? / 1000)
        ORDER BY recorded_at, id`,
      [nodeId, sinceMs],
    );
    return rows.map((row) => row.level_mv);
  }

  async function driftBuckets(nodeId, calibrationId, sinceMs, bucketSeconds) {
    const [rows] = await pool.query(
      `SELECT FLOOR(UNIX_TIMESTAMP(recorded_at) / ?) * ? * 1000 AS bucket_ms,
              AVG(level_depth_mm) AS avg_mm,
              SUM(level_range <> 'DENTRO') AS outside,
              SUM(rain_class IN ('CHUVA', 'CHUVA_INTENSA')) AS rainy
         FROM reading
        WHERE node_id = ? AND calibration_id = ? AND recorded_at >= FROM_UNIXTIME(? / 1000)
        GROUP BY bucket_ms
        ORDER BY bucket_ms`,
      [bucketSeconds, bucketSeconds, nodeId, calibrationId, sinceMs],
    );
    return rows;
  }

  async function historyBuckets(nodeId, { fromMs, toMs }, bucketSeconds) {
    const [rows] = await pool.query(
      `SELECT FLOOR(UNIX_TIMESTAMP(r.recorded_at) / ?) * ? * 1000 AS bucket_ms,
              COUNT(*) AS readings,
              AVG(r.level_depth_mm) AS avg_mm, MIN(r.level_depth_mm) AS min_mm, MAX(r.level_depth_mm) AS max_mm,
              SUM(r.level_range = 'ACIMA') AS above, SUM(r.level_range = 'ABAIXO') AS below,
              SUM(r.rain_class IN ('CHUVA', 'CHUVA_INTENSA')) AS rainy,
              AVG(r.soil_index) AS soil_index,
              AVG(r.level_mv) AS level_mv, AVG(r.rain_mv) AS rain_mv, AVG(r.soil_mv) AS soil_mv,
              SUM(c.status = 'NORMAL') AS n_normal, SUM(c.status = 'ATENCAO') AS n_atencao,
              SUM(c.status = 'RISCO') AS n_risco
         FROM reading r
         LEFT JOIN classification c ON c.reading_id = r.id
        WHERE r.node_id = ? AND r.recorded_at >= FROM_UNIXTIME(? / 1000) AND r.recorded_at < FROM_UNIXTIME(? / 1000)
        GROUP BY bucket_ms
        ORDER BY bucket_ms`,
      [bucketSeconds, bucketSeconds, nodeId, fromMs, toMs],
    );
    return rows;
  }

  async function changeRows(nodeId, { fromMs, toMs }, gapMs) {
    const [rows] = await pool.query(
      `SELECT time_ms, prev_time_ms, status, prev_status, rule, prev_rule, level_range, level_depth_mm
         FROM (
           SELECT ${EPOCH_MS('r.recorded_at')} AS time_ms,
                  ${EPOCH_MS('LAG(r.recorded_at) OVER w')} AS prev_time_ms,
                  c.status, LAG(c.status) OVER w AS prev_status,
                  c.rule, LAG(c.rule) OVER w AS prev_rule,
                  r.level_range, r.level_depth_mm
             FROM reading r
             LEFT JOIN classification c ON c.reading_id = r.id
            WHERE r.node_id = ? AND r.recorded_at >= FROM_UNIXTIME(? / 1000) AND r.recorded_at < FROM_UNIXTIME(? / 1000)
           WINDOW w AS (ORDER BY r.recorded_at, r.id)
         ) AS ordered
        WHERE prev_time_ms IS NULL
           OR NOT (status <=> prev_status)
           OR NOT (rule <=> prev_rule)
           OR time_ms - prev_time_ms > ?
        ORDER BY time_ms`,
      [nodeId, fromMs, toMs, gapMs],
    );
    return rows;
  }

  async function exportRows(nodeId, { fromMs, toMs }) {
    const [rows] = await pool.query(
      `SELECT ${EPOCH_MS('r.recorded_at')} AS time_ms, r.seq, r.level_mv, r.rain_mv, r.soil_mv,
              r.level_range, r.level_depth_mm, r.rain_class, r.soil_index, c.status, c.rule
         FROM reading r
         LEFT JOIN classification c ON c.reading_id = r.id
        WHERE r.node_id = ? AND r.recorded_at >= FROM_UNIXTIME(? / 1000) AND r.recorded_at < FROM_UNIXTIME(? / 1000)
        ORDER BY r.recorded_at, r.id`,
      [nodeId, fromMs, toMs],
    );
    return rows;
  }

  // The same inputs the classifier got for the last classified reading, with the class before it (hysteresis).
  async function latestClassifiedInputs() {
    const [rows] = await pool.query(
      `SELECT n.id AS node_id, last.reading_id, last.time_ms, last.level_mv, last.level_range, last.level_depth_mm,
              last.rain_class, last.soil_index, last.bankfull_depth_mm, last.status, last.rule,
              previous.status AS previous_status
         FROM node n
         JOIN LATERAL (
           SELECT r.id AS reading_id, ${EPOCH_MS('r.recorded_at')} AS time_ms, r.level_mv, r.level_range,
                  r.level_depth_mm, r.rain_class, r.soil_index, cal.bankfull_depth_mm, c.status, c.rule
             FROM reading r
             JOIN classification c ON c.reading_id = r.id
             JOIN calibration cal ON cal.id = r.calibration_id
            WHERE r.node_id = n.id
            ORDER BY r.recorded_at DESC, r.id DESC
            LIMIT 1
         ) AS last ON TRUE
         LEFT JOIN LATERAL (
           SELECT c2.status
             FROM reading r2
             JOIN classification c2 ON c2.reading_id = r2.id
            WHERE r2.node_id = n.id AND r2.id < last.reading_id
            ORDER BY r2.id DESC
            LIMIT 1
         ) AS previous ON TRUE`,
    );
    return rows;
  }

  async function hourlyReadingCounts(sinceMs) {
    const [rows] = await pool.query(
      `SELECT node_id, FLOOR(UNIX_TIMESTAMP(recorded_at) / 3600) * 3600000 AS hour_ms, COUNT(*) AS readings
         FROM reading
        WHERE recorded_at >= FROM_UNIXTIME(? / 1000)
        GROUP BY node_id, hour_ms`,
      [sinceMs],
    );
    return rows.map((row) => ({ nodeId: row.node_id, hourMs: Number(row.hour_ms), readings: Number(row.readings) }));
  }

  async function readingGaps(sinceMs, gapMs) {
    const [rows] = await pool.query(
      `SELECT node_id, start_ms, end_ms
         FROM (
           SELECT node_id, ${EPOCH_MS('recorded_at')} AS end_ms,
                  ${EPOCH_MS('LAG(recorded_at) OVER (PARTITION BY node_id ORDER BY recorded_at, id)')} AS start_ms
             FROM reading
            WHERE recorded_at >= FROM_UNIXTIME(? / 1000)
         ) AS ordered
        WHERE end_ms - start_ms > ?
        ORDER BY start_ms`,
      [sinceMs, gapMs],
    );
    return rows.map((row) => ({ nodeId: row.node_id, startMs: Number(row.start_ms), endMs: Number(row.end_ms) }));
  }

  async function readingSpanPerNode() {
    const [rows] = await pool.query(
      `SELECT node_id, ${EPOCH_MS('MIN(recorded_at)')} AS first_ms, ${EPOCH_MS('MAX(recorded_at)')} AS last_ms
         FROM reading
        GROUP BY node_id`,
    );
    return rows.map((row) => ({ nodeId: row.node_id, firstMs: Number(row.first_ms), lastMs: Number(row.last_ms) }));
  }

  return {
    latestClassifiedInputs,
    hourlyReadingCounts,
    readingGaps,
    readingSpanPerNode,
    activeThresholds,
    latestReadingPerNode,
    latestClassificationPerNode,
    statusSince,
    lastRainMs,
    recentLevels,
    historyBuckets,
    changeRows,
    recentLevelMv,
    driftBuckets,
    exportRows,
  };
}

module.exports = { createDashboardRepository };
