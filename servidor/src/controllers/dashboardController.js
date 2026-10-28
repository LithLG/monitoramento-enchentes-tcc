'use strict';
const { ForbiddenError } = require('../errors');
const {
  parseNodeId, parseNewNode, parseNodeChanges, parseRulerCm, parseRecordId, parseAnnotation, parseSimulation,
} = require('../services/dashboard/nodeInput');
const { parseTimeRange } = require('../services/dashboard/timeRange');
const { localDateTime } = require('../services/dashboard/csv');

function csvFileName(nodeId, range) {
  const stamp = localDateTime(range.toMs).replace(' ', '_').replaceAll(':', '').slice(0, 15);
  return `local-${nodeId}_${stamp}.csv`;
}

function createDashboardController({
  dashboardService,
  rulerService,
  decisionService,
  annotationService,
  sensorHealthService,
  isServerComputer,
  now = Date.now,
}) {
  function requireServerComputer(req) {
    if (!isServerComputer(req)) {
      throw new ForbiddenError('cadastro e mudanças só pelo computador que roda o servidor');
    }
  }

  async function overview(req, res) {
    res.json({ ...(await dashboardService.overview()), canEdit: isServerComputer(req) });
  }

  async function history(req, res) {
    const nodeId = parseNodeId(req.params.id);
    res.json(await dashboardService.history(nodeId, parseTimeRange(req.query, now())));
  }

  async function exportCsv(req, res) {
    const nodeId = parseNodeId(req.params.id);
    const range = parseTimeRange(req.query, now());
    const { content } = await dashboardService.exportCsv(nodeId, range);
    res.attachment(csvFileName(nodeId, range)).type('text/csv; charset=utf-8').send(content);
  }

  async function createNode(req, res) {
    requireServerComputer(req);
    const node = await dashboardService.createNode(parseNewNode(req.body));
    res.status(201).json({ ok: true, node: { id: node.id, name: node.name, calibrated: node.calibration_id !== null } });
  }

  async function updateNode(req, res) {
    requireServerComputer(req);
    const nodeId = parseNodeId(req.params.id);
    const node = await dashboardService.updateNode(nodeId, parseNodeChanges(req.body));
    res.json({ ok: true, node: { id: node.id, name: node.name, description: node.description, zone: node.zone } });
  }

  async function previewRulerAdjustment(req, res) {
    const nodeId = parseNodeId(req.params.id);
    res.json(await rulerService.plan(nodeId, parseRulerCm(req.query.rulerCm)));
  }

  async function applyRulerAdjustment(req, res) {
    requireServerComputer(req);
    const nodeId = parseNodeId(req.params.id);
    const result = await rulerService.adjust(nodeId, parseRulerCm(req.body?.rulerCm));
    res.status(201).json({ ok: true, ...result });
  }

  async function recordRulerCheck(req, res) {
    requireServerComputer(req);
    const nodeId = parseNodeId(req.params.id);
    res.status(201).json({ ok: true, check: await rulerService.record(nodeId, parseRulerCm(req.body?.rulerCm)) });
  }

  async function removeRulerCheck(req, res) {
    requireServerComputer(req);
    await rulerService.remove(parseRecordId(req.params.id, 'número da medida'));
    res.json({ ok: true });
  }

  async function annotations(req, res) {
    res.json({ annotations: await annotationService.list(parseTimeRange(req.query, now())) });
  }

  async function addAnnotation(req, res) {
    requireServerComputer(req);
    res.status(201).json({ ok: true, annotation: await annotationService.add(parseAnnotation(req.body, now())) });
  }

  async function removeAnnotation(req, res) {
    requireServerComputer(req);
    await annotationService.remove(parseRecordId(req.params.id, 'número da anotação'));
    res.json({ ok: true });
  }

  async function liveDecision(req, res) {
    res.json(await decisionService.live());
  }

  async function simulateDecision(req, res) {
    res.json(await decisionService.simulate(parseSimulation(req.body)));
  }

  async function sensorHealth(req, res) {
    res.json(await sensorHealthService.health());
  }

  return {
    overview,
    history,
    exportCsv,
    createNode,
    updateNode,
    previewRulerAdjustment,
    applyRulerAdjustment,
    recordRulerCheck,
    removeRulerCheck,
    annotations,
    addAnnotation,
    removeAnnotation,
    liveDecision,
    simulateDecision,
    sensorHealth,
  };
}

module.exports = { createDashboardController };
