'use strict';

function required(env, name) {
  const value = env[name];
  const isMissing = value === undefined || value === '';
  if (isMissing) {
    throw new Error(`Variável ${name} não definida. Confira o arquivo .env (modelo em env-exemplo.txt).`);
  }
  return value;
}

function nonNegativeInteger(env, name, fallback) {
  const raw = env[name];
  const isMissing = raw === undefined || raw === '';
  if (isMissing) return fallback;

  const value = Number(raw);
  const isNonNegativeInteger = Number.isInteger(value) && value >= 0;
  if (!isNonNegativeInteger) {
    throw new Error(`Variável ${name} deve ser um número inteiro >= 0 (recebido: "${raw}").`);
  }
  return value;
}

const withoutTrailingSlash = (url) => url.replace(/\/+$/, '');

function loadConfig(env = process.env) {
  return Object.freeze({
    port: nonNegativeInteger(env, 'PORT', 3000),
    db: Object.freeze({
      host: env.DB_HOST || '127.0.0.1',
      port: nonNegativeInteger(env, 'DB_PORT', 3306),
      database: env.DB_NAME || 'tcc_enchentes',
      user: required(env, 'DB_USER'),
      password: required(env, 'DB_PASSWORD'),
    }),
    pythonUrl: env.PYTHON_URL ? withoutTrailingSlash(env.PYTHON_URL) : null,
    classifyIntervalMs: nonNegativeInteger(env, 'CLASSIFY_INTERVAL_MS', 30000),
    discoveryPort: nonNegativeInteger(env, 'DISCOVERY_PORT', 4210),
    discoveryIntervalMs: nonNegativeInteger(env, 'DISCOVERY_INTERVAL_MS', 2000),
    display: Object.freeze({
      bedHeightMm: nonNegativeInteger(env, 'LEITO_ALTURA_MM', 10),
      uncertaintyMm: nonNegativeInteger(env, 'INCERTEZA_NIVEL_MM', 2),
    }),
  });
}

module.exports = { loadConfig };
