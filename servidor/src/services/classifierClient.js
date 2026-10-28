'use strict';

/*
 * Contract with the Python classifier (step 7):
 *   POST {PYTHON_URL}/classify
 *   request:  { reading_id, node_id, level_range, level_depth_mm, bankfull_depth_mm,
 *               rain_class, soil_index, previous_status }
 *   response: 200 { status: "NORMAL" | "ATENCAO" | "RISCO", rule, threshold_set_id }
 * previous_status is the last class of the same node. The tree needs it for hysteresis.
 */

const VALID_STATUSES = new Set(['NORMAL', 'ATENCAO', 'RISCO']);
const MAX_RULE_LENGTH = 40;
const HEALTH_TIMEOUT_MS = 1500;
const CLASSIFIER_STATE = Object.freeze({ ONLINE: 'ONLINE', DOWN: 'FORA_DO_AR', NOT_CONFIGURED: 'NAO_CONFIGURADO' });

class PermanentClassificationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PermanentClassificationError';
  }
}

class ClassifierOutdatedError extends Error {
  constructor() {
    super('o Python ainda não tem a explicação da árvore');
    this.name = 'ClassifierOutdatedError';
  }
}

function parseDecision(value) {
  const isValid = VALID_STATUSES.has(value?.status) && typeof value?.rule === 'string' && value.rule.length > 0;
  if (!isValid) throw new Error('resposta do Python sem a explicação esperada');
  return { status: value.status, rule: value.rule };
}

/*
 * POST {PYTHON_URL}/explain takes the same reading fields as /classify (no reading_id, no node_id)
 * and returns the result of each step of the tree. It does not write to the database.
 */
function parseExplanation(body) {
  const limits = body?.limits ?? {};
  return {
    thresholdSetId: body?.threshold_set_id ?? null,
    byLevel: parseDecision(body?.by_level),
    previousWasHigher: body?.previous_was_higher === true,
    afterHysteresis: parseDecision(body?.after_hysteresis),
    isRaining: body?.is_raining === true,
    soilIsSaturated: body?.soil_is_saturated === true,
    soilSaturatedIndex: Number(body?.soil_saturated_index),
    final: parseDecision(body?.final),
    limitsMm: {
      dry: Number(limits.dry_mm),
      attention: Number(limits.attention_mm),
      attentionExit: Number(limits.attention_exit_mm),
      risk: Number(limits.risk_mm),
      riskExit: Number(limits.risk_exit_mm),
      bankfull: Number(limits.bankfull_mm),
    },
  };
}

function parseClassification(body) {
  const { status, rule, threshold_set_id: thresholdSetId } = body ?? {};

  if (!VALID_STATUSES.has(status)) {
    throw new PermanentClassificationError(`resposta do Python com status inválido: ${status}`);
  }

  const hasValidRule = typeof rule === 'string' && rule.length > 0 && rule.length <= MAX_RULE_LENGTH;
  if (!hasValidRule) throw new PermanentClassificationError('resposta do Python sem "rule" válida');

  const hasValidThresholdSet = Number.isInteger(thresholdSetId) && thresholdSetId >= 1;
  if (!hasValidThresholdSet) {
    throw new PermanentClassificationError('resposta do Python sem "threshold_set_id" válido');
  }

  return { status, rule, thresholdSetId };
}

function createClassifierClient(baseUrl, { timeoutMs = 3000, fetchImpl = fetch } = {}) {
  async function classify(input) {
    const response = await fetchImpl(`${baseUrl}/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const pythonRejectedReading = response.status >= 400 && response.status < 500;
    if (pythonRejectedReading) {
      throw new PermanentClassificationError(`Python recusou a leitura (HTTP ${response.status})`);
    }
    if (!response.ok) throw new Error(`Python respondeu HTTP ${response.status}`);

    return parseClassification(await response.json());
  }

  async function explain(input) {
    const response = await fetchImpl(`${baseUrl}/explain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 404) throw new ClassifierOutdatedError();
    if (!response.ok) throw new Error(`Python respondeu HTTP ${response.status}`);
    return parseExplanation(await response.json());
  }

  async function health() {
    try {
      const response = await fetchImpl(`${baseUrl}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
      return response.ok ? CLASSIFIER_STATE.ONLINE : CLASSIFIER_STATE.DOWN;
    } catch {
      return CLASSIFIER_STATE.DOWN;
    }
  }

  return { classify, explain, health };
}

module.exports = {
  createClassifierClient,
  parseClassification,
  parseExplanation,
  PermanentClassificationError,
  ClassifierOutdatedError,
  CLASSIFIER_STATE,
};
