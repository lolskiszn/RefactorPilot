import { IRGraph } from './graph.js';
import { stableStringify } from '../shared/index.js';

export function serializeGraph(graph) {
  if (!(graph instanceof IRGraph)) {
    throw new TypeError('serializeGraph expects an IRGraph instance');
  }

  return stableStringify(graph.toJSON());
}

export function deserializeGraph(jsonOrObject) {
  const payload =
    typeof jsonOrObject === 'string' ? JSON.parse(jsonOrObject) : jsonOrObject;

  return IRGraph.fromJSON(payload);
}
