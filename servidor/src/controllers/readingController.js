'use strict';

function describeLevel(reading, converted) {
  if (converted.levelRange === null) return `${reading.level_mv} mV`;
  if (converted.levelDepthMm === null) return converted.levelRange;
  return `${converted.levelRange} ${converted.levelDepthMm} mm`;
}

function describe({ reading, converted }) {
  const rain = converted.rainClass ?? `${reading.rain_mv} mV`;
  const soil = converted.soilIndex ?? `${reading.soil_mv} mV`;
  return `nó ${reading.node_id} #${reading.seq}  nível ${describeLevel(reading, converted)}  chuva ${rain}  solo ${soil}`;
}

function createReadingController({ readingService, logger = console }) {
  async function create(req, res) {
    const result = await readingService.store(req.body, { sourceIp: req.socket.remoteAddress });
    if (result.duplicate) {
      res.status(200).json({ ok: true, duplicada: true });
      return;
    }
    logger.log(describe(result));
    res.status(201).json({ ok: true, id: result.id });
  }

  return { create };
}

module.exports = { createReadingController, describe };
