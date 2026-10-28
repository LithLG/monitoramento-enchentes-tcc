'use strict';
const express = require('express');

function createRouter({ readingController, statusController, dashboardController }) {
  const router = express.Router();
  router.post('/readings', readingController.create);
  router.get('/status', statusController.page);
  router.get('/api/nodes', statusController.nodes);
  router.get('/health', statusController.health);

  router.get('/api/overview', dashboardController.overview);
  router.post('/api/nodes', dashboardController.createNode);
  router.patch('/api/nodes/:id', dashboardController.updateNode);
  router.get('/api/nodes/:id/history', dashboardController.history);
  router.get('/api/nodes/:id/readings.csv', dashboardController.exportCsv);
  router.get('/api/nodes/:id/ruler-adjustment', dashboardController.previewRulerAdjustment);
  router.post('/api/nodes/:id/ruler-adjustment', dashboardController.applyRulerAdjustment);
  router.post('/api/nodes/:id/ruler-checks', dashboardController.recordRulerCheck);
  router.delete('/api/ruler-checks/:id', dashboardController.removeRulerCheck);
  router.get('/api/annotations', dashboardController.annotations);
  router.post('/api/annotations', dashboardController.addAnnotation);
  router.delete('/api/annotations/:id', dashboardController.removeAnnotation);
  router.get('/api/decision', dashboardController.liveDecision);
  router.post('/api/decision/simulate', dashboardController.simulateDecision);
  router.get('/api/sensors/health', dashboardController.sensorHealth);
  return router;
}

module.exports = { createRouter };
