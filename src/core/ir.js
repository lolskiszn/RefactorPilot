export const NodeKind = Object.freeze({
  FILE: "file",
  SYMBOL: "symbol",
  FIELD: "field",
  ENDPOINT: "endpoint",
  CALLSITE: "callsite",
  DATA_FLOW: "data_flow",
});

export const EdgeKind = Object.freeze({
  DEFINES: "defines",
  REFERENCES: "references",
  EXPOSES: "exposes",
  CONSUMES: "consumes",
  FLOWS_TO: "flows_to",
  CO_LOCATED_WITH: "co_located_with",
});

export class IRGraph {
  constructor() {
    this.nodes = [];
    this.edges = [];
    this.nodeIndex = new Map();
  }

  addNode(node) {
    const existing = this.nodeIndex.get(node.id);
    if (existing) {
      return existing;
    }

    const normalized = {
      attributes: {},
      location: null,
      ...node,
    };

    this.nodes.push(normalized);
    this.nodeIndex.set(normalized.id, normalized);
    return normalized;
  }

  addEdge(edge) {
    this.edges.push(edge);
    return edge;
  }

  getNode(id) {
    return this.nodeIndex.get(id) ?? null;
  }

  toJSON() {
    return {
      nodes: this.nodes,
      edges: this.edges,
    };
  }
}

export function createFileNode(file) {
  return {
    id: `file:${file.path}`,
    kind: NodeKind.FILE,
    name: file.path,
    language: file.language,
    location: {
      filePath: file.path,
      line: 1,
      column: 1,
    },
    attributes: {
      absolutePath: file.absolutePath,
    },
  };
}

export function liftAnalysisToIR(analysisResults) {
  const graph = new IRGraph();

  for (const result of analysisResults) {
    const fileNode = graph.addNode(
      createFileNode({
        path: result.path,
        absolutePath: result.absolutePath,
        language: result.language,
      }),
    );

    for (const symbol of result.symbols) {
      graph.addNode({
        id: `${result.language}:symbol:${result.path}:${symbol.name}:${symbol.line}`,
        kind: NodeKind.SYMBOL,
        name: symbol.name,
        language: result.language,
        location: {
          filePath: result.path,
          line: symbol.line,
          column: symbol.column,
        },
        attributes: symbol,
      });

      graph.addEdge({
        kind: EdgeKind.DEFINES,
        from: fileNode.id,
        to: `${result.language}:symbol:${result.path}:${symbol.name}:${symbol.line}`,
      });
    }

    for (const field of result.fields) {
      const fieldId = `${result.language}:field:${result.path}:${field.name}:${field.line}`;

      graph.addNode({
        id: fieldId,
        kind: NodeKind.FIELD,
        name: field.name,
        language: result.language,
        location: {
          filePath: result.path,
          line: field.line,
          column: field.column,
        },
        attributes: field,
      });

      graph.addEdge({
        kind: EdgeKind.DEFINES,
        from: fileNode.id,
        to: fieldId,
      });
    }

    for (const endpoint of result.endpoints) {
      const endpointId = `${result.language}:endpoint:${result.path}:${endpoint.method}:${endpoint.route}:${endpoint.line}`;

      graph.addNode({
        id: endpointId,
        kind: NodeKind.ENDPOINT,
        name: `${endpoint.method} ${endpoint.route}`,
        language: result.language,
        location: {
          filePath: result.path,
          line: endpoint.line,
          column: endpoint.column,
        },
        attributes: endpoint,
      });

      graph.addEdge({
        kind: EdgeKind.EXPOSES,
        from: fileNode.id,
        to: endpointId,
      });
    }

    for (const usage of result.fieldUsages) {
      const usageId = `${result.language}:usage:${result.path}:${usage.name}:${usage.line}:${usage.column}`;
      graph.addNode({
        id: usageId,
        kind: NodeKind.DATA_FLOW,
        name: usage.name,
        language: result.language,
        location: {
          filePath: result.path,
          line: usage.line,
          column: usage.column,
        },
        attributes: usage,
      });

      graph.addEdge({
        kind: EdgeKind.REFERENCES,
        from: fileNode.id,
        to: usageId,
      });

      const matchingField = result.fields.find(
        (field) => field.name === usage.name || field.jsonName === usage.name,
      );

      if (matchingField) {
        graph.addEdge({
          kind: EdgeKind.FLOWS_TO,
          from: `${result.language}:field:${result.path}:${matchingField.name}:${matchingField.line}`,
          to: usageId,
        });
      }
    }
  }

  linkBoundaryFields(graph);
  return graph;
}

function linkBoundaryFields(graph) {
  const fieldsByBoundaryName = new Map();

  for (const node of graph.nodes) {
    if (node.kind !== NodeKind.FIELD) {
      continue;
    }

    const keys = new Set([node.name]);
    const jsonName = node.attributes?.jsonName;
    if (jsonName) {
      keys.add(jsonName);
    }

    for (const key of keys) {
      if (!fieldsByBoundaryName.has(key)) {
        fieldsByBoundaryName.set(key, []);
      }
      fieldsByBoundaryName.get(key).push(node.id);
    }
  }

  for (const ids of fieldsByBoundaryName.values()) {
    if (ids.length < 2) {
      continue;
    }

    for (let index = 0; index < ids.length - 1; index += 1) {
      for (let other = index + 1; other < ids.length; other += 1) {
        graph.addEdge({
          kind: EdgeKind.CO_LOCATED_WITH,
          from: ids[index],
          to: ids[other],
        });
      }
    }
  }
}
