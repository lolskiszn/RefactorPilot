import { SerializationError } from './errors.js';
import { isPlainObject } from './guards.js';

function normalize(value) {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalize(item));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (isPlainObject(value)) {
    const normalized = {};
    for (const key of Object.keys(value).sort()) {
      const next = normalize(value[key]);
      if (next !== undefined) {
        normalized[key] = next;
      }
    }
    return normalized;
  }

  if (value && typeof value.toJSON === 'function') {
    return normalize(value.toJSON());
  }

  throw new SerializationError('Value is not JSON serializable', {
    valueType: typeof value,
  });
}

export function stableStringify(value) {
  return JSON.stringify(normalize(value));
}
