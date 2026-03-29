import {
  cloneValue,
  ensureArray,
  ensurePlainObject,
  ensureString,
  ValidationError,
} from '../shared/index.js';

export function normalizeNode(input) {
  ensurePlainObject(input, 'node');

  const id = input.id ?? input.nodeId;
  const kind = input.kind ?? input.type;
  const node = {
    attributes: cloneValue(input.attributes ?? {}),
    id: ensureString(id, 'node.id'),
    kind: ensureString(kind, 'node.kind'),
  };

  if (input.language !== undefined) {
    node.language = ensureString(input.language, 'node.language');
  }

  if (input.name !== undefined) {
    node.name = ensureString(input.name, 'node.name', { allowEmpty: true });
  }

  if (input.tags !== undefined) {
    node.tags = ensureArray(input.tags, 'node.tags').map((tag, index) =>
      ensureString(tag, `node.tags[${index}]`)
    );
  }

  if (input.metadata !== undefined) {
    node.metadata = cloneValue(ensurePlainObject(input.metadata, 'node.metadata'));
  }

  if (input.source !== undefined) {
    node.source = cloneValue(ensurePlainObject(input.source, 'node.source'));
  }

  return node;
}

export function assertNode(node, context = 'node') {
  try {
    normalizeNode(node);
  } catch (error) {
    throw new ValidationError(`Invalid ${context}`, {
      cause: error.message,
    });
  }
}
