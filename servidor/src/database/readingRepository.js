'use strict';

function createReadingRepository(pool) {
  async function insert(r) {
    const [result] = await pool.execute(
      `INSERT INTO reading
         (node_id, seq, uptime_ms, level_mv, level_raw, rain_mv, rain_raw, soil_mv, soil_raw,
          calibration_id, level_range, level_depth_mm, rain_class, soil_index)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.node_id, r.seq, r.uptime_ms, r.level_mv, r.level_raw, r.rain_mv, r.rain_raw, r.soil_mv, r.soil_raw,
        r.calibrationId, r.levelRange, r.levelDepthMm, r.rainClass, r.soilIndex],
    );
    return result.insertId;
  }

  async function findUnclassified(limit) {
    const isPositiveInteger = Number.isInteger(limit) && limit >= 1;
    if (!isPositiveInteger) throw new Error('limit deve ser inteiro >= 1');

    const [rows] = await pool.query(
      `SELECT r.id, r.node_id, r.level_range, r.level_depth_mm, r.rain_class, r.soil_index,
              cal.bankfull_depth_mm
         FROM reading r
         JOIN calibration cal ON cal.id = r.calibration_id
         LEFT JOIN classification c ON c.reading_id = r.id
        WHERE c.reading_id IS NULL
        ORDER BY r.id
        LIMIT ?`,
      [limit],
    );
    return rows;
  }

  async function findPreviousStatus(nodeId, readingId) {
    const [rows] = await pool.execute(
      `SELECT c.status
         FROM classification c
         JOIN reading r ON r.id = c.reading_id
        WHERE r.node_id = ? AND r.id < ?
        ORDER BY r.id DESC
        LIMIT 1`,
      [nodeId, readingId],
    );
    return rows[0]?.status ?? null;
  }

  async function insertClassification({ readingId, thresholdSetId, status, rule }) {
    await pool.execute(
      'INSERT INTO classification (reading_id, threshold_set_id, status, rule) VALUES (?, ?, ?, ?)',
      [readingId, thresholdSetId, status, rule],
    );
  }

  async function nodeOverview() {
    const [rows] = await pool.query(
      `SELECT n.id AS node_id, n.name,
              r.id AS reading_id, r.recorded_at, r.seq,
              r.level_mv, r.rain_mv, r.soil_mv,
              r.level_range, r.level_depth_mm, r.rain_class, r.soil_index,
              c.status, c.rule,
              (SELECT COUNT(*) FROM reading x WHERE x.node_id = n.id) AS total_readings,
              (SELECT COUNT(*)
                 FROM reading x
                 LEFT JOIN classification y ON y.reading_id = x.id
                WHERE x.node_id = n.id AND x.calibration_id IS NOT NULL AND y.reading_id IS NULL) AS unclassified
         FROM node n
         LEFT JOIN reading r ON r.id = (SELECT MAX(id) FROM reading WHERE node_id = n.id)
         LEFT JOIN classification c ON c.reading_id = r.id
        ORDER BY n.id`,
    );
    return rows;
  }

  return { insert, findUnclassified, findPreviousStatus, insertClassification, nodeOverview };
}

module.exports = { createReadingRepository };
