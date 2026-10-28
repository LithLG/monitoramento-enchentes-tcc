'use strict';
const { ValidationError } = require('../errors');
const { validateReadingPayload } = require('./readingValidation');
const { convertReading } = require('./conversion');

const MYSQL_DUPLICATE_ENTRY = 'ER_DUP_ENTRY';
const MYSQL_UNKNOWN_FOREIGN_KEY_CODES = new Set(['ER_NO_REFERENCED_ROW', 'ER_NO_REFERENCED_ROW_2']);

function createReadingService({
  readingRepository,
  calibrationRepository,
  onReadingStored = () => {},
  onUnknownNode = () => {},
}) {
  async function store(payload, { sourceIp = null } = {}) {
    const reading = validateReadingPayload(payload);
    const calibration = await calibrationRepository.findActiveByNode(reading.node_id);
    const converted = convertReading(reading, calibration);

    let id;
    try {
      id = await readingRepository.insert({ ...reading, ...converted });
    } catch (error) {
      const isResentReading = error.code === MYSQL_DUPLICATE_ENTRY;
      if (isResentReading) return { id: null, duplicate: true, reading, converted };

      const isUnknownNode = MYSQL_UNKNOWN_FOREIGN_KEY_CODES.has(error.code);
      if (isUnknownNode) {
        onUnknownNode({ nodeId: reading.node_id, sourceIp });
        throw new ValidationError(`nó ${reading.node_id} não está cadastrado na tabela node`);
      }

      throw error;
    }

    onReadingStored(id);
    return { id, duplicate: false, reading, converted };
  }

  return { store };
}

module.exports = { createReadingService };
