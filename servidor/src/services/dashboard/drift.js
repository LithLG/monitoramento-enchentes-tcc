'use strict';

const DRIFT_WINDOW_MS = 3 * 60 * 60 * 1000;
const DRIFT_BUCKET_S = 20 * 60;
const MIN_BUCKETS = 6;
const MIN_RISE_MM = 1.5;
const MAX_STEP_MM = 3;
const MAX_DROP_STEP_MM = 1;
const MIN_RISING_SHARE = 0.6;

/*
 * In the model the water only rises when somebody adds water or when it rains on the box.
 * A slow and steady rise with no rain and no jump looks like the sensor drift seen in boxes 1 and 2
 * after high water. This is only a warning: the ruler tells the truth.
 */
function driftWarning(buckets) {
  const isComplete = buckets.length >= MIN_BUCKETS;
  const allInsideRange = buckets.every((b) => b.avg_mm !== null && b.outside === 0);
  const hadRain = buckets.some((b) => b.rainy > 0);
  if (!isComplete || !allInsideRange || hadRain) return null;

  const levels = buckets.map((b) => Number(b.avg_mm));
  const steps = levels.slice(1).map((level, i) => level - levels[i]);
  const riseMm = levels[levels.length - 1] - levels[0];
  const hasJump = steps.some((step) => step > MAX_STEP_MM || step < -MAX_DROP_STEP_MM);
  const risingShare = steps.filter((step) => step > 0).length / steps.length;

  const looksLikeDrift = riseMm >= MIN_RISE_MM && !hasJump && risingShare >= MIN_RISING_SHARE;
  if (!looksLikeDrift) return null;

  return {
    riseMm: Number(riseMm.toFixed(1)),
    sinceMs: buckets[0].bucket_ms,
    hours: Number(((buckets[buckets.length - 1].bucket_ms - buckets[0].bucket_ms) / 3600000).toFixed(1)),
  };
}

module.exports = { driftWarning, DRIFT_WINDOW_MS, DRIFT_BUCKET_S };
