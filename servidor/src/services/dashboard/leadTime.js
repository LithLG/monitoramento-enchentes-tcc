'use strict';

const OVERFLOW_RULES = new Set(['TRANSBORDOU', 'NIVEL_ACIMA_DA_FAIXA']);
const MAX_EPISODES = 20;

/*
 * An episode starts when the class leaves NORMAL and ends when it is NORMAL again.
 * Lead time = time from the first alert to the moment the river overflows.
 * An episode that was already in alert at the start of the period has no known start,
 * so it does not give a lead time.
 */
function alertEpisodes(changeRows) {
  const episodes = [];
  let current = null;
  let isFirstClassified = true;

  for (const row of changeRows) {
    if (row.status === null) continue;
    const isAlert = row.status !== 'NORMAL';

    if (!current && isAlert) {
      current = {
        startMs: row.time_ms,
        startedBeforePeriod: isFirstClassified,
        attentionMs: null,
        riskMs: null,
        overflowMs: null,
        endMs: null,
      };
    }
    isFirstClassified = false;
    if (!current) continue;

    if (isAlert) current.attentionMs ??= row.time_ms;
    if (row.status === 'RISCO') current.riskMs ??= row.time_ms;
    if (OVERFLOW_RULES.has(row.rule)) current.overflowMs ??= row.time_ms;
    if (!isAlert) {
      current.endMs = row.time_ms;
      episodes.push(current);
      current = null;
    }
  }
  if (current) episodes.push(current);

  return episodes.slice(-MAX_EPISODES).map((episode) => {
    const hasKnownStart = !episode.startedBeforePeriod;
    const overflowed = episode.overflowMs !== null;
    const leadFrom = (alertMs) => (hasKnownStart && overflowed && alertMs !== null ? episode.overflowMs - alertMs : null);
    return {
      ...episode,
      ongoing: episode.endMs === null,
      overflowed,
      attentionLeadMs: leadFrom(episode.attentionMs),
      riskLeadMs: leadFrom(episode.riskMs),
    };
  });
}

function leadTimeSummary(episodes) {
  const measured = episodes.filter((e) => e.attentionLeadMs !== null);
  const average = (values) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null);
  return {
    episodes: episodes.length,
    overflows: episodes.filter((e) => e.overflowed).length,
    measured: measured.length,
    averageAttentionLeadMs: average(measured.map((e) => e.attentionLeadMs)),
    averageRiskLeadMs: average(measured.map((e) => e.riskLeadMs).filter((v) => v !== null)),
  };
}

module.exports = { alertEpisodes, leadTimeSummary, OVERFLOW_RULES };
