'use strict';
const { ValidationError, NotFoundError, ConflictError, ForbiddenError, NotReadyError } = require('../errors');

const STATUS_BY_ERROR = new Map([
  [ValidationError, 400],
  [ForbiddenError, 403],
  [NotFoundError, 404],
  [ConflictError, 409],
  [NotReadyError, 503],
]);

function statusForKnownError(error) {
  for (const [ErrorClass, status] of STATUS_BY_ERROR) {
    if (error instanceof ErrorClass) return status;
  }
  return null;
}

function notFound(req, res) {
  res.status(404).json({ ok: false, erro: 'rota não encontrada' });
}

function createErrorHandler(logger = console) {
  // Express finds error middleware by its 4 parameters, so "next" must stay even when unused.
  // eslint-disable-next-line no-unused-vars
  return function errorHandler(error, req, res, next) {
    if (error.type === 'entity.parse.failed') {
      res.status(400).json({ ok: false, erro: 'JSON inválido' });
      return;
    }
    if (error.type === 'entity.too.large') {
      res.status(413).json({ ok: false, erro: 'corpo grande demais' });
      return;
    }

    const knownStatus = statusForKnownError(error);
    if (knownStatus !== null) {
      if (error instanceof ValidationError) logger.warn(`[rejeitada] ${error.message}`);
      res.status(knownStatus).json({ ok: false, erro: error.message });
      return;
    }

    logger.error('[erro]', error);
    res.status(500).json({ ok: false, erro: 'erro interno' });
  };
}

module.exports = { notFound, createErrorHandler };
