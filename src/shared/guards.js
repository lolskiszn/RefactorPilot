export function isPlainObject(value) {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function ensureString(value, name, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') {
    throw new TypeError(`${name} must be a string`);
  }

  if (!allowEmpty && value.trim() === '') {
    throw new TypeError(`${name} must not be empty`);
  }

  return value;
}

export function ensureArray(value, name) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${name} must be an array`);
  }

  return value;
}

export function ensurePlainObject(value, name) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${name} must be a plain object`);
  }

  return value;
}

export function cloneValue(value) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof globalThis.structuredClone === 'function') {
    try {
      return globalThis.structuredClone(value);
    } catch {
      // Fall through to the JSON-safe clone below.
    }
  }

  return JSON.parse(JSON.stringify(value));
}
