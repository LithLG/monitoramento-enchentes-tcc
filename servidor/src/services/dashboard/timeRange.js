'use strict';
const { ValidationError } = require('../../errors');

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_SPAN_MS = HOUR_MS;
const MAX_SPAN_MS = 31 * 24 * HOUR_MS;
const TARGET_POINTS = 600;
const READING_INTERVAL_S = 15;
const BUCKET_STEPS_S = [15, 30, 60, 120, 180, 300, 600, 900, 1200, 1800, 3600, 7200, 10800];

function parseEpochMs(raw, name) {
  const isMissing = raw === undefined || raw === '';
  if (isMissing) return null;

  const value = Number(raw);
  const isValidEpoch = Number.isInteger(value) && value > 0;
  if (!isValidEpoch) throw new ValidationError(`parâmetro "${name}" inválido (milissegundos desde 1970)`);
  return value;
}

function parseTimeRange(query, nowMs) {
  const toMs = parseEpochMs(query.to, 'to') ?? nowMs;
  const fromMs = parseEpochMs(query.from, 'from') ?? toMs - DEFAULT_SPAN_MS;

  if (fromMs >= toMs) throw new ValidationError('o início do período deve ser antes do fim');
  if (toMs - fromMs > MAX_SPAN_MS) throw new ValidationError('período máximo: 31 dias');
  return { fromMs, toMs };
}

function bucketSecondsFor({ fromMs, toMs }) {
  const idealSeconds = (toMs - fromMs) / 1000 / TARGET_POINTS;
  return BUCKET_STEPS_S.find((step) => step >= idealSeconds) ?? BUCKET_STEPS_S[BUCKET_STEPS_S.length - 1];
}

module.exports = { parseTimeRange, bucketSecondsFor, READING_INTERVAL_S, MAX_SPAN_MS };
