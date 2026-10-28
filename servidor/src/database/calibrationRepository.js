'use strict';

function createCalibrationRepository(pool) {
  async function findActiveByNode(nodeId) {
    const [rows] = await pool.execute(
      `SELECT id, node_id, sensor_tip_above_bed_mm, bankfull_depth_mm, level_range_mm, level_curve,
              soil_dry_mv, soil_saturated_mv, rain_wet_below_mv, rain_heavy_below_mv
         FROM calibration
        WHERE node_id = ? AND is_active`,
      [nodeId],
    );
    return rows[0] ?? null;
  }

  return { findActiveByNode };
}

module.exports = { createCalibrationRepository };
