import {
  cloneValue,
  ensureArray,
  ensurePlainObject,
  stableStringify,
  ValidationError,
} from '../shared/index.js';
import { EDGE_KINDS } from './kinds.js';
import { normalizeEdge } from './edge.js';
import { normalizeNode } from './node.js';

function indexBucket(map, key) {
  let bucket = map.get(key);
  if (!bucket) {
    bucket = new Set();
    map.set(key, bucket);
  }
  return bucket;
}

export class IRGraph {
  constructor({ edges = [], metadata = {}, nodes = [], version = 1 } = {}) {
    this.version = version;
    this.metadata = cloneValue(ensurePlainObject(metadata, 'graph.metadata'));
    this._nodes = new Map();
    this._edges = new Map();
    this._incoming = new Map();
    this._outgoing = new Map();

    ensureArray(nodes, 'graph.nodes');
    ensureArray(edges, 'graph.edges');

    for (const node of nodes) {
      this.addNode(node);
    }

    for (const edge of edges) {
      this.addEdge(edge);
    }
  }

  addNode(nodeInput) {
    const node = normalizeNode(nodeInput);
    if (this._nodes.has(node.id)) {
      throw new ValidationError(`Duplicate node id: ${node.id}`, {
        nodeId: node.id,
      });
    }

    this._nodes.set(node.id, node);
    return node;
  }

  addEdge(edgeInput) {
    const edge = normalizeEdge(edgeInput);

    if (!this._nodes.has(edge.from)) {
      throw new ValidationError(`Edge source node not found: ${edge.from}`, {
        edgeId: edge.id ?? null,
        from: edge.from,
      });
    }

    if (!this._nodes.has(edge.to)) {
      throw new ValidationError(`Edge target node not found: ${edge.to}`, {
        edgeId: edge.id ?? null,
        to: edge.to,
      });
    }

    if (edge.id !== undefined && this._edges.has(edge.id)) {
      throw new ValidationError(`Duplicate edge id: ${edge.id}`, {
        edgeId: edge.id,
      });
    }

    const edgeId = edge.id ?? `${edge.kind}:${edge.from}->${edge.to}:${this._edges.size}`;
    const storedEdge = { ...edge, id: edgeId };

    this._edges.set(edgeId, storedEdge);
    indexBucket(this._outgoing, storedEdge.from).add(edgeId);
    indexBucket(this._incoming, storedEdge.to).add(edgeId);

    return storedEdge;
  }

  getNode(id) {
    return this._nodes.get(id) ?? null;
  }

  getEdge(id) {
    return this._edges.get(id) ?? null;
  }

  hasNode(id) {
    return this._nodes.has(id);
  }

  hasEdge(id) {
    return this._edges.has(id);
  }

  nodes() {
    return [...this._nodes.values()];
  }

  edges() {
    return [...this._edges.values()];
  }

  findNodes(predicate) {
    return this.nodes().filter(predicate);
  }

  findNodesByKind(kind) {
    return this.findNodes((node) => node.kind === kind);
  }

  findNodesByLanguage(language) {
    return this.findNodes((node) => node.language === language);
  }

  findEdges(predicate) {
    return this.edges().filter(predicate);
  }

  findEdgesByKind(kind) {
    return this.findEdges((edge) => edge.kind === kind);
  }

  boundaryEdges() {
    return this.findEdgesByKind(EDGE_KINDS.CROSSES_BOUNDARY);
  }

  outgoing(nodeId, kind) {
    const ids = [...(this._outgoing.get(nodeId) ?? [])];
    return ids
      .map((edgeId) => this._edges.get(edgeId))
      .filter((edge) => edge && (kind === undefined || edge.kind === kind));
  }

  incoming(nodeId, kind) {
    const ids = [...(this._incoming.get(nodeId) ?? [])];
    return ids
      .map((edgeId) => this._edges.get(edgeId))
      .filter((edge) => edge && (kind === undefined || edge.kind === kind));
  }

  neighbors(nodeId, { direction = 'both', kind } = {}) {
    const results = [];

    if (direction === 'out' || direction === 'both') {
      results.push(...this.outgoing(nodeId, kind));
    }

    if (direction === 'in' || direction === 'both') {
      results.push(...this.incoming(nodeId, kind));
    }

    return results;
  }

  validate() {
    const issues = [];

    for (const edge of this._edges.values()) {
      if (!this._nodes.has(edge.from)) {
        issues.push({
          edgeId: edge.id,
          kind: 'missing-source-node',
          nodeId: edge.from,
        });
      }

      if (!this._nodes.has(edge.to)) {
        issues.push({
          edgeId: edge.id,
          kind: 'missing-target-node',
          nodeId: edge.to,
        });
      }
    }

    return {
      issues,
      valid: issues.length === 0,
    };
  }

  assertValid() {
    const report = this.validate();
    if (!report.valid) {
      throw new ValidationError('IR graph is invalid', report);
    }
    return report;
  }

  toJSON() {
    return {
      edges: this.edges(),
      metadata: cloneValue(this.metadata),
      nodes: this.nodes(),
      version: this.version,
    };
  }

  toJSONString() {
    return stableStringify(this.toJSON());
  }

  static fromJSON(payload) {
    ensurePlainObject(payload, 'graph payload');
    if (payload.nodes !== undefined) {
      ensureArray(payload.nodes, 'graph payload.nodes');
    }

    if (payload.edges !== undefined) {
      ensureArray(payload.edges, 'graph payload.edges');
    }

    return new IRGraph({
      edges: payload.edges ?? [],
      metadata: payload.metadata ?? {},
      nodes: payload.nodes ?? [],
      version: payload.version ?? 1,
    });
  }
}

export function createGraph(options) {
  return new IRGraph(options);
}
