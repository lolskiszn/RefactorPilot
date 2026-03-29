import {
  cloneValue,
  ensurePlainObject,
  ensureString,
  ValidationError,
} from '../shared/index.js';

export function normalizeEdge(input) {
  ensurePlainObject(input, 'edge');

  const id = input.id ?? input.edgeId;
  const kind = input.kind ?? input.type;
  const edge = {
    attributes: cloneValue(input.attributes ?? {}),
    from: ensureString(input.from, 'edge.from'),
    id: id === undefined ? undefined : ensureString(id, 'edge.id'),
    kind: ensureString(kind, 'edge.kind'),
    to: ensureString(input.to, 'edge.to'),
  };

  if (edge.id === undefined) {
    delete edge.id;
  }

  if (input.metadata !== undefined) {
    edge.metadata = cloneValue(ensurePlainObject(input.metadata, 'edge.metadata'));
  }

  return edge;
}

export function assertEdge(edge, context = 'edge') {
  try {
    normalizeEdge(edge);
  } catch (error) {
    throw new ValidationError(`Invalid ${context}`, {
      cause: error.message,
    });
  }
}
