const TIMEOUT_MS = 8000;

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ApiError('Sem conexão com o servidor. Ele está ligado?', 0);
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(body?.erro ?? `Erro ${response.status}`, response.status);
  return body;
}

export const api = {
  overview: () => request('api/overview'),
  history: (nodeId, { fromMs, toMs }) => request(`api/nodes/${nodeId}/history?from=${fromMs}&to=${toMs}`),
  createNode: (data) => request('api/nodes', { method: 'POST', body: JSON.stringify(data) }),
  updateNode: (nodeId, data) => request(`api/nodes/${nodeId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  csvUrl: (nodeId, { fromMs, toMs }) => `api/nodes/${nodeId}/readings.csv?from=${fromMs}&to=${toMs}`,
  rulerPreview: (nodeId, rulerCm) => request(`api/nodes/${nodeId}/ruler-adjustment?rulerCm=${encodeURIComponent(rulerCm)}`),
  applyRuler: (nodeId, rulerCm) => request(`api/nodes/${nodeId}/ruler-adjustment`, { method: 'POST', body: JSON.stringify({ rulerCm }) }),
  recordRuler: (nodeId, rulerCm) => request(`api/nodes/${nodeId}/ruler-checks`, { method: 'POST', body: JSON.stringify({ rulerCm }) }),
  removeRulerCheck: (checkId) => request(`api/ruler-checks/${checkId}`, { method: 'DELETE' }),
  annotations: ({ fromMs, toMs }) => request(`api/annotations?from=${fromMs}&to=${toMs}`),
  addAnnotation: (data) => request('api/annotations', { method: 'POST', body: JSON.stringify(data) }),
  removeAnnotation: (annotationId) => request(`api/annotations/${annotationId}`, { method: 'DELETE' }),
  decision: () => request('api/decision'),
  simulate: (data) => request('api/decision/simulate', { method: 'POST', body: JSON.stringify(data) }),
  sensorHealth: () => request('api/sensors/health'),
};
