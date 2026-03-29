import { cloneValue } from "../shared/index.js";
import { IRGraph } from "../core/graph.js";
import { EDGE_KINDS, NODE_KINDS } from "../core/kinds.js";

function nodeId(parts) {
  return parts.join(":");
}

function normalizeKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function fileNodeId(file) {
  return nodeId(["file", file.path]);
}

function symbolNodeId(file, symbol) {
  return nodeId(["symbol", file.path, symbol.kind, symbol.name, symbol.line ?? 0, symbol.column ?? 0]);
}

function fieldNodeId(file, field) {
  return nodeId(["field", file.path, field.kind, field.name, field.line ?? 0, field.column ?? 0]);
}

function endpointNodeId(file, endpoint) {
  return nodeId([
    "endpoint",
    file.path,
    endpoint.framework ?? "unknown",
    endpoint.method ?? "unknown",
    endpoint.route ?? "unknown",
    endpoint.line ?? 0,
    endpoint.column ?? 0,
  ]);
}

function usageNodeId(file, usage) {
  return nodeId(["usage", file.path, usage.kind ?? "usage", usage.name, usage.line ?? 0, usage.column ?? 0]);
}

function mapSymbolKind(kind) {
  switch (kind) {
    case "class":
      return NODE_KINDS.CLASS;
    case "struct":
      return NODE_KINDS.STRUCT;
    case "function":
    case "method":
      return NODE_KINDS.FUNCTION;
    default:
      return NODE_KINDS.SYMBOL;
  }
}

function createFileNode(file) {
  return {
    attributes: {
      absolutePath: file.absolutePath,
    },
    id: fileNodeId(file),
    kind: NODE_KINDS.FILE,
    language: file.language,
    name: file.path,
  };
}

function createSymbolNode(file, symbol) {
  return {
    attributes: {
      ...cloneValue(symbol),
      filePath: file.path,
    },
    id: symbolNodeId(file, symbol),
    kind: mapSymbolKind(symbol.kind),
    language: file.language,
    name: symbol.name,
  };
}

function createFieldNode(file, field) {
  return {
    attributes: {
      ...cloneValue(field),
      filePath: file.path,
    },
    id: fieldNodeId(file, field),
    kind: NODE_KINDS.DATA_FIELD,
    language: file.language,
    name: field.name,
  };
}

function createEndpointNode(file, endpoint) {
  return {
    attributes: {
      ...cloneValue(endpoint),
      filePath: file.path,
    },
    id: endpointNodeId(file, endpoint),
    kind: NODE_KINDS.API_ENDPOINT,
    language: file.language,
    name: `${endpoint.method ?? "UNKNOWN"} ${endpoint.route ?? "unknown"}`,
  };
}

function createUsageNode(file, usage) {
  return {
    attributes: {
      ...cloneValue(usage),
      filePath: file.path,
    },
    id: usageNodeId(file, usage),
    kind: NODE_KINDS.VARIABLE,
    language: file.language,
    name: usage.name,
  };
}

export function buildGraph(scanResult, options = {}) {
  const compactMetadata = Boolean(options.compactMetadata);
  const irGraph = new IRGraph({
    metadata: {
      overlayPasses: [],
      rootDir: scanResult.rootDir,
      ...(compactMetadata
        ? {
            scanSummary: {
              fileCount: scanResult.files.length,
              files: scanResult.files.map((file) => ({
                absolutePath: file.absolutePath,
                language: file.language,
                path: file.path,
              })),
            },
          }
        : {
            scanResult: {
              files: scanResult.files.map((file) => ({
                absolutePath: file.absolutePath,
                fieldUsages: cloneValue(file.fieldUsages ?? []),
                fields: cloneValue(file.fields ?? []),
                language: file.language,
                path: file.path,
                ...(file.source !== undefined ? { source: file.source } : {}),
                symbols: cloneValue(file.symbols ?? []),
                endpoints: cloneValue(file.endpoints ?? []),
              })),
            },
          }),
    },
  });

  const index = {
    fieldsByKey: new Map(),
    usagesByKey: new Map(),
  };

  for (const file of scanResult.files) {
    const fileNode = irGraph.addNode(createFileNode(file));

    for (const symbol of file.symbols ?? []) {
      const symbolNode = irGraph.addNode(createSymbolNode(file, symbol));
      irGraph.addEdge({
        from: fileNode.id,
        kind: EDGE_KINDS.CONTAINS,
        to: symbolNode.id,
        attributes: { symbolKind: symbol.kind },
      });
    }

    for (const field of file.fields ?? []) {
      const fieldNode = irGraph.addNode(createFieldNode(file, field));
      irGraph.addEdge({
        from: fileNode.id,
        kind: EDGE_KINDS.CONTAINS,
        to: fieldNode.id,
        attributes: { fieldKind: field.kind },
      });

      const keys = new Set([normalizeKey(field.name)]);
      if (field.jsonName) {
        keys.add(normalizeKey(field.jsonName));
      }

      for (const key of keys) {
        if (!index.fieldsByKey.has(key)) {
          index.fieldsByKey.set(key, []);
        }
        index.fieldsByKey.get(key).push(fieldNode.id);
      }
    }

    for (const endpoint of file.endpoints ?? []) {
      const endpointNode = irGraph.addNode(createEndpointNode(file, endpoint));
      irGraph.addEdge({
        from: fileNode.id,
        kind: EDGE_KINDS.CONTAINS,
        to: endpointNode.id,
        attributes: { framework: endpoint.framework },
      });
    }

    for (const usage of file.fieldUsages ?? []) {
      const usageNode = irGraph.addNode(createUsageNode(file, usage));
      irGraph.addEdge({
        from: fileNode.id,
        kind: EDGE_KINDS.CONTAINS,
        to: usageNode.id,
        attributes: { usageKind: usage.kind },
      });

      const key = normalizeKey(usage.name);
      if (!index.usagesByKey.has(key)) {
        index.usagesByKey.set(key, []);
      }
      index.usagesByKey.get(key).push(usageNode.id);
    }
  }

  const contractLinks = [];
  for (const [key, fieldIds] of index.fieldsByKey.entries()) {
    const usageIds = index.usagesByKey.get(key) ?? [];
    if (fieldIds.length === 0 || usageIds.length === 0) {
      continue;
    }

    for (const fieldId of fieldIds) {
      const fieldNode = irGraph.getNode(fieldId);
      if (!fieldNode) {
        continue;
      }

      for (const usageId of usageIds) {
        const usageNode = irGraph.getNode(usageId);
        if (!usageNode) {
          continue;
        }

        const sameLanguage = fieldNode.language === usageNode.language;
        const edgeKind = sameLanguage ? EDGE_KINDS.MAPS_TO : EDGE_KINDS.CROSSES_BOUNDARY;
        const link = {
          consumer: {
            filePath: usageNode.attributes?.filePath ?? null,
            id: usageNode.id,
            language: usageNode.language,
            name: usageNode.name,
          },
          field: {
            id: fieldNode.id,
            jsonName: fieldNode.attributes?.jsonName ?? fieldNode.name,
            language: fieldNode.language,
            name: fieldNode.name,
          },
          key,
          path: buildExplanationPath(fieldNode, usageNode, key),
        };

        contractLinks.push(link);
        irGraph.addEdge({
          from: fieldNode.id,
          kind: edgeKind,
          to: usageNode.id,
          attributes: {
            contractKey: key,
            explanation: link.path,
            sameLanguage,
          },
        });
      }
    }
  }

  irGraph.metadata.overlayPasses.push("base", "contracts", "flow");
  irGraph.metadata.contractLinks = contractLinks;
  irGraph.metadata.index = {
    fieldKeys: [...index.fieldsByKey.keys()],
    usageKeys: [...index.usagesByKey.keys()],
  };

  return createGraphView(irGraph);
}

function buildExplanationPath(fieldNode, usageNode, key) {
  const sourcePath = fieldNode.attributes?.parent ?? fieldNode.name;
  const targetPath = usageNode.attributes?.kind ?? usageNode.name;
  return [
    `${fieldNode.language}:${sourcePath}`,
    `json:${key}`,
    `${usageNode.language}:${targetPath}`,
  ];
}

export function linkContracts(graph) {
  return {
    contractLinks: graph.metadata.contractLinks ?? [],
    graph,
  };
}

function createGraphView(irGraph) {
  const nodes = irGraph.nodes();
  const edges = irGraph.edges();

  return {
    assertValid: irGraph.assertValid.bind(irGraph),
    boundaryEdges: irGraph.boundaryEdges.bind(irGraph),
    edges,
    getEdge: irGraph.getEdge.bind(irGraph),
    getNode: irGraph.getNode.bind(irGraph),
    hasEdge: irGraph.hasEdge.bind(irGraph),
    hasNode: irGraph.hasNode.bind(irGraph),
    ir: irGraph,
    metadata: irGraph.metadata,
    neighbors: irGraph.neighbors.bind(irGraph),
    nodes,
    outgoing: irGraph.outgoing.bind(irGraph),
    incoming: irGraph.incoming.bind(irGraph),
    toJSON: irGraph.toJSON.bind(irGraph),
    toJSONString: irGraph.toJSONString.bind(irGraph),
    validate: irGraph.validate.bind(irGraph),
  };
}
