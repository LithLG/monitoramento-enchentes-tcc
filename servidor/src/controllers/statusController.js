'use strict';
const { renderStatusPage } = require('../views/statusPage');

function createStatusController({ readingRepository, pingDatabase }) {
  async function page(req, res) {
    res.type('html').send(renderStatusPage(await readingRepository.nodeOverview()));
  }

  async function nodes(req, res) {
    res.json(await readingRepository.nodeOverview());
  }

  async function health(req, res) {
    try {
      await pingDatabase();
      res.json({ ok: true, banco: 'ok' });
    } catch (error) {
      res.status(503).json({ ok: false, banco: error.message });
    }
  }

  return { page, nodes, health };
}

module.exports = { createStatusController };
