'use strict';
const { NotFoundError } = require('../../errors');

function createAnnotationService({ fieldNotesRepository, nodeRepository }) {
  async function add({ nodeId, timeMs, text }) {
    if (nodeId !== null && !(await nodeRepository.findById(nodeId))) {
      throw new NotFoundError(`local ${nodeId} não encontrado`);
    }
    const id = await fieldNotesRepository.addAnnotation({ nodeId, timeMs, text });
    return { id, nodeId, timeMs, text };
  }

  async function remove(annotationId) {
    const removed = await fieldNotesRepository.removeAnnotation(annotationId);
    if (!removed) throw new NotFoundError(`anotação ${annotationId} não encontrada`);
  }

  const list = (range) => fieldNotesRepository.annotations({ nodeId: null, ...range });

  return { add, remove, list };
}

module.exports = { createAnnotationService };
