'use strict';
const path = require('node:path');
const express = require('express');
const { createRouter } = require('./routes');
const { notFound, createErrorHandler } = require('./middlewares/errorHandler');

const PANEL_DIRECTORY = path.join(__dirname, '..', 'public');

function createApp({ readingController, statusController, dashboardController, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));
  app.use(createRouter({ readingController, statusController, dashboardController }));
  app.use(express.static(PANEL_DIRECTORY));
  app.use(notFound);
  app.use(createErrorHandler(logger));
  return app;
}

module.exports = { createApp };
