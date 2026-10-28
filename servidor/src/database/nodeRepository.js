'use strict';

const MYSQL_DUPLICATE_ENTRY = 'ER_DUP_ENTRY';
const MYSQL_UNKNOWN_COLUMN = 'ER_BAD_FIELD_ERROR';
const HISTORY_LIMIT = 10;

class DuplicateNodeError extends Error {
  constructor(nodeId) {
    super(`nó ${nodeId} já existe`);
    this.name = 'DuplicateNodeError';
  }
}

const nodeColumns = (hasZoneColumns) => (hasZoneColumns
  ? 'n.zone, n.river_position'
  : 'NULL AS zone, NULL AS river_position');

function createNodeRepository(pool) {
  // Script 13 adds the zone columns. Until the authors run it, the panel works without zones.
  let hasZoneColumns = true;

  async function withZoneFallback(run) {
    try {
      return await run(hasZoneColumns);
    } catch (error) {
      const zoneColumnsAreMissing = error.code === MYSQL_UNKNOWN_COLUMN && hasZoneColumns;
      if (!zoneColumnsAreMissing) throw error;
      hasZoneColumns = false;
      return run(false);
    }
  }

  async function listWithCalibration() {
    return withZoneFallback(async (zones) => {
      const [rows] = await pool.query(
        `SELECT n.id, n.name, n.description, ${nodeColumns(zones)},
                ROUND(UNIX_TIMESTAMP(n.created_at) * 1000) AS created_ms,
                cal.id AS calibration_id, cal.bankfull_depth_mm, cal.level_range_mm, cal.sensor_tip_above_bed_mm,
                cal.level_curve, cal.soil_dry_mv, cal.soil_saturated_mv, cal.rain_wet_below_mv,
                cal.rain_heavy_below_mv, cal.notes AS calibration_notes,
                ROUND(UNIX_TIMESTAMP(cal.created_at) * 1000) AS calibration_created_ms
           FROM node n
           LEFT JOIN calibration cal ON cal.node_id = n.id AND cal.is_active
          ORDER BY n.id`,
      );
      return rows.map((row) => ({ ...row, river_position: row.river_position === null ? null : Number(row.river_position) }));
    });
  }

  async function findById(nodeId) {
    const nodes = await listWithCalibration();
    return nodes.find((node) => node.id === nodeId) ?? null;
  }

  async function create({ id, name, description, zone, riverPosition, copyCalibrationFrom }) {
    await listWithCalibration();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      if (hasZoneColumns) {
        await connection.execute(
          'INSERT INTO node (id, name, description, zone, river_position) VALUES (?, ?, ?, ?, ?)',
          [id, name, description, zone, riverPosition],
        );
      } else {
        await connection.execute('INSERT INTO node (id, name, description) VALUES (?, ?, ?)', [id, name, description]);
      }

      if (copyCalibrationFrom !== null) {
        await connection.execute(
          `INSERT INTO calibration
             (node_id, is_active, sensor_tip_above_bed_mm, bankfull_depth_mm, level_range_mm, level_curve,
              soil_dry_mv, soil_saturated_mv, rain_wet_below_mv, rain_heavy_below_mv, notes)
           SELECT ?, TRUE, sensor_tip_above_bed_mm, bankfull_depth_mm, level_range_mm, level_curve,
                  soil_dry_mv, soil_saturated_mv, rain_wet_below_mv, rain_heavy_below_mv,
                  CONCAT('Provisoria: copiada do no ', node_id, ' pelo painel. Calibrar no local.')
             FROM calibration
            WHERE node_id = ? AND is_active`,
          [id, copyCalibrationFrom],
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      if (error.code === MYSQL_DUPLICATE_ENTRY) throw new DuplicateNodeError(id);
      throw error;
    } finally {
      connection.release();
    }
  }

  async function update(nodeId, { name, description, zone, riverPosition }) {
    await listWithCalibration();
    if (hasZoneColumns) {
      await pool.execute(
        'UPDATE node SET name = ?, description = ?, zone = ?, river_position = ? WHERE id = ?',
        [name, description, zone, riverPosition, nodeId],
      );
      return;
    }
    await pool.execute('UPDATE node SET name = ?, description = ? WHERE id = ?', [name, description, nodeId]);
  }

  // A new calibration version keeps the old one, so old readings can still be explained.
  async function replaceLevelCurve(nodeId, { levelCurve, notes }) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [active] = await connection.execute(
        'SELECT id FROM calibration WHERE node_id = ? AND is_active FOR UPDATE',
        [nodeId],
      );
      if (!active[0]) throw new Error(`nó ${nodeId} sem calibração ativa`);
      const previousId = active[0].id;
      await connection.execute('UPDATE calibration SET is_active = FALSE WHERE id = ?', [previousId]);
      const [inserted] = await connection.execute(
        `INSERT INTO calibration
           (node_id, is_active, sensor_tip_above_bed_mm, bankfull_depth_mm, level_range_mm, level_curve,
            soil_dry_mv, soil_saturated_mv, rain_wet_below_mv, rain_heavy_below_mv, notes)
         SELECT node_id, TRUE, sensor_tip_above_bed_mm, bankfull_depth_mm, level_range_mm, ?,
                soil_dry_mv, soil_saturated_mv, rain_wet_below_mv, rain_heavy_below_mv, ?
           FROM calibration
          WHERE id = ?`,
        [JSON.stringify(levelCurve), notes, previousId],
      );
      await connection.commit();
      return inserted.insertId;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function calibrationHistory(nodeId) {
    const [rows] = await pool.query(
      `SELECT id, is_active, level_curve, notes, ROUND(UNIX_TIMESTAMP(created_at) * 1000) AS created_ms
         FROM calibration
        WHERE node_id = ?
        ORDER BY id DESC
        LIMIT ?`,
      [nodeId, HISTORY_LIMIT],
    );
    return rows.map((row) => ({
      id: row.id,
      active: Boolean(row.is_active),
      curve: row.level_curve,
      notes: row.notes,
      createdMs: row.created_ms,
    }));
  }

  return {
    listWithCalibration,
    findById,
    create,
    update,
    replaceLevelCurve,
    calibrationHistory,
    supportsZones: () => hasZoneColumns,
  };
}

module.exports = { createNodeRepository, DuplicateNodeError };
