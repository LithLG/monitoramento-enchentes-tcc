'use strict';
const { PermanentClassificationError } = require('./classifierClient');

function toClassifierInput(reading, previousStatus) {
  return {
    reading_id: reading.id,
    node_id: reading.node_id,
    level_range: reading.level_range,
    level_depth_mm: reading.level_depth_mm,
    bankfull_depth_mm: reading.bankfull_depth_mm,
    rain_class: reading.rain_class,
    soil_index: reading.soil_index,
    previous_status: previousStatus,
  };
}

function createClassificationService({ readingRepository, classifierClient, batchSize = 50, logger = console }) {
  let running = false;
  let rerunRequested = false;

  // Pending readings go in arrival order, so each one gets the correct previous class for hysteresis.
  async function classifyBatch() {
    let classified = 0;
    const pending = await readingRepository.findUnclassified(batchSize);
    for (const reading of pending) {
      const previousStatus = await readingRepository.findPreviousStatus(reading.node_id, reading.id);

      let result;
      try {
        result = await classifierClient.classify(toClassifierInput(reading, previousStatus));
      } catch (error) {
        if (error instanceof PermanentClassificationError) {
          logger.warn(`[classificação] leitura ${reading.id} recusada: ${error.message}`);
          continue;
        }
        logger.warn(`[classificação] Python indisponível (${error.message}); pendentes ficam para o próximo ciclo`);
        return { classified, pythonAvailable: false };
      }

      await readingRepository.insertClassification({ readingId: reading.id, ...result });
      classified += 1;
    }
    return { classified, pythonAvailable: true };
  }

  // The three nodes send at almost the same time. A reading that arrives during a run must not
  // wait for the next timer tick, so the run repeats once more when a new reading arrived.
  async function classifyPending() {
    if (!classifierClient) return 0;
    if (running) {
      rerunRequested = true;
      return 0;
    }

    running = true;
    let classified = 0;
    try {
      let shouldRunAgain = true;
      while (shouldRunAgain) {
        rerunRequested = false;
        const batch = await classifyBatch();
        classified += batch.classified;
        shouldRunAgain = batch.pythonAvailable && rerunRequested;
      }
    } finally {
      running = false;
    }
    return classified;
  }

  return { classifyPending };
}

module.exports = { createClassificationService };
