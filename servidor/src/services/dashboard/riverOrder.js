'use strict';

// Left to right on the model, the same way the river runs. Places without a position go last.
function inRiverOrder(nodes) {
  const position = (node) => (node.river_position === null || node.river_position === undefined ? Infinity : node.river_position);
  return [...nodes].sort((a, b) => position(a) - position(b) || a.id - b.id);
}

module.exports = { inRiverOrder };
