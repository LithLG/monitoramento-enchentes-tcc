'use strict';
const { NotReadyError } = require('../errors');

const MYSQL_NO_SUCH_TABLE = 'ER_NO_SUCH_TABLE';
const EPOCH_MS = (column) => `ROUND(UNIX_TIMESTAMP(${column}) * 1000)`;
const SCRIPT_MISSING = 'rode o banco/14_anotacoes_regua.sql no MySQL e reinicie o sistema';
const READY_RECHECK_MS = 30 * 1000;

/*
 * Field notes of the authors: annotations on the chart and ruler measurements.
 * The app user cannot delete rows, so "remove" only fills removed_at.
 */
function createFieldNotesRepository(pool) {
  // Script 14 creates the tables. Until the authors run it, reads return nothing and writes explain what to do.
  let tablesExist = true;

  async function whenReady(run, fallback) {
    try {
      const result = await run();
      tablesExist = true;
      return result;
    } catch (error) {
      if (error.code !== MYSQL_NO_SUCH_TABLE) throw error;
      tablesExist = false;
      if (fallback === undefined) throw new NotReadyError(SCRIPT_MISSING);
      return fallback;
    }
  }

  let checkedReadyMs = -Infinity;

  // Cheap check for the panel banner. Once the tables exist, they stay.
  async function checkReady(nowMs = Date.now()) {
    const alreadyConfirmed = tablesExist && checkedReadyMs > -Infinity;
    if (alreadyConfirmed) return true;
    if (nowMs - checkedReadyMs < READY_RECHECK_MS) return tablesExist;
    checkedReadyMs = nowMs;
    return whenReady(async () => {
      await pool.query('SELECT 1 FROM annotation LIMIT 0');
      await pool.query('SELECT 1 FROM ruler_check LIMIT 0');
      return true;
    }, false);
  }

  const toAnnotation = (row) => ({ id: row.id, nodeId: row.node_id, timeMs: row.time_ms, text: row.text });

  async function annotations({ nodeId = null, fromMs, toMs }) {
    return whenReady(async () => {
      const [rows] = await pool.query(
        `SELECT id, node_id, ${EPOCH_MS('noted_at')} AS time_ms, text
           FROM annotation
          WHERE removed_at IS NULL
            AND noted_at >= FROM_UNIXTIME(? / 1000) AND noted_at < FROM_UNIXTIME(? / 1000)
            AND (? IS NULL OR node_id IS NULL OR node_id = ?)
          ORDER BY noted_at, id`,
        [fromMs, toMs, nodeId, nodeId],
      );
      return rows.map(toAnnotation);
    }, []);
  }

  async function addAnnotation({ nodeId, timeMs, text }) {
    return whenReady(async () => {
      const [result] = await pool.execute(
        'INSERT INTO annotation (node_id, noted_at, text) VALUES (?, FROM_UNIXTIME(? / 1000), ?)',
        [nodeId, timeMs, text],
      );
      return result.insertId;
    });
  }

  async function removeAnnotation(annotationId) {
    return whenReady(async () => {
      const [result] = await pool.execute(
        'UPDATE annotation SET removed_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND removed_at IS NULL',
        [annotationId],
      );
      return result.affectedRows === 1;
    });
  }

  const toRulerCheck = (row) => ({
    id: row.id,
    nodeId: row.node_id,
    timeMs: row.time_ms,
    rulerCm: Number(row.ruler_cm),
    rulerDepthMm: Number(row.ruler_depth_mm),
    sensorMv: row.sensor_mv,
    sensorRange: row.sensor_range,
    sensorDepthMm: row.sensor_depth_mm === null ? null : Number(row.sensor_depth_mm),
    calibrationId: row.calibration_id,
    adjusted: row.adjusted === 1 || row.adjusted === true,
  });

  async function rulerChecks({ nodeId = null, fromMs = 0, toMs = null, limit = 500 } = {}) {
    return whenReady(async () => {
      const [rows] = await pool.query(
        `SELECT id, node_id, ${EPOCH_MS('measured_at')} AS time_ms, ruler_cm, ruler_depth_mm, sensor_mv,
                sensor_range, sensor_depth_mm, calibration_id, adjusted
           FROM ruler_check
          WHERE removed_at IS NULL
            AND measured_at >= FROM_UNIXTIME(? / 1000)
            AND (? IS NULL OR measured_at < FROM_UNIXTIME(? / 1000))
            AND (? IS NULL OR node_id = ?)
          ORDER BY measured_at DESC, id DESC
          LIMIT ?`,
        [fromMs, toMs, toMs, nodeId, nodeId, limit],
      );
      return rows.map(toRulerCheck);
    }, []);
  }

  async function addRulerCheck(check) {
    return whenReady(async () => {
      const [result] = await pool.execute(
        `INSERT INTO ruler_check
           (node_id, ruler_cm, ruler_depth_mm, sensor_mv, sensor_range, sensor_depth_mm, calibration_id, adjusted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [check.nodeId, check.rulerCm, check.rulerDepthMm, check.sensorMv, check.sensorRange,
          check.sensorDepthMm, check.calibrationId, check.adjusted],
      );
      return result.insertId;
    });
  }

  async function removeRulerCheck(checkId) {
    return whenReady(async () => {
      const [result] = await pool.execute(
        'UPDATE ruler_check SET removed_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND removed_at IS NULL',
        [checkId],
      );
      return result.affectedRows === 1;
    });
  }

  return {
    annotations,
    addAnnotation,
    removeAnnotation,
    rulerChecks,
    addRulerCheck,
    removeRulerCheck,
    checkReady,
  };
}

module.exports = { createFieldNotesRepository, SCRIPT_MISSING };
