'use strict';
const { rulerReading } = require('./levelGeometry');

// Excel in Portuguese opens ";" columns with "," decimals directly. The BOM tells it the file is UTF-8.
const BOM = '﻿';
const SEPARATOR = ';';
const HEADER = ['data_hora', 'seq', 'nivel_mv', 'chuva_mv', 'solo_mv', 'faixa_nivel', 'lamina_mm', 'regua_cm',
  'chuva', 'indice_solo', 'classe', 'regra'];

const pad = (value) => String(value).padStart(2, '0');

function localDateTime(timeMs) {
  const d = new Date(timeMs);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
    + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const decimal = (value) => (value === null || value === undefined ? '' : String(value).replace('.', ','));
const text = (value) => (value === null || value === undefined ? '' : String(value).replaceAll(SEPARATOR, ','));

function readingsToCsv(rows, geometry) {
  const lines = rows.map((row) => {
    const level = rulerReading({ levelRange: row.level_range, levelDepthMm: row.level_depth_mm }, geometry);
    return [
      localDateTime(row.time_ms), row.seq, row.level_mv, row.rain_mv, row.soil_mv, text(row.level_range),
      decimal(row.level_depth_mm), decimal(level.rulerCm), text(row.rain_class), decimal(row.soil_index),
      text(row.status), text(row.rule),
    ].join(SEPARATOR);
  });
  return `${BOM}${HEADER.join(SEPARATOR)}\r\n${lines.join('\r\n')}\r\n`;
}

module.exports = { readingsToCsv, localDateTime };
