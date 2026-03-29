import fs from 'node:fs/promises';

const STRUCT_RE = /^\s*type\s+([A-Za-z_]\w*)\s+struct\s*\{/;
const FUNC_RE = /^\s*func\s*(?:\(([^)]*)\)\s*)?([A-Za-z_]\w*)\s*\(([^)]*)\)/;
const FIELD_RE = /^\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s+(.+?)\s*(?:`([^`]*)`)?\s*$/;
const CALL_RE = /\b([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+)\s*\(/g;
const HTTP_HANDLER_HINTS = ['http.ResponseWriter', '*http.Request'];
const HTTP_ROUTE_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'Any', 'Handle', 'HandleFunc']);
const JSON_BOUNDARY_METHODS = new Set(['Marshal', 'Unmarshal', 'NewDecoder', 'NewEncoder', 'Decode', 'Encode', 'BindJSON', 'ShouldBindJSON', 'ReadJSON', 'WriteJSON']);
const CONTROL_KEYWORDS = new Set(['if', 'for', 'switch', 'select', 'go', 'return', 'func', 'type', 'var', 'const', 'struct', 'interface', 'map', 'chan', 'range']);

async function analyzeGoFile(filePath, options = {}) {
  const source = await fs.readFile(filePath, 'utf8');
  return analyzeGoSource(source, { ...options, filePath });
}

async function analyzeGoFiles(filePaths, options = {}) {
  const files = [];
  for (const filePath of filePaths) {
    files.push(await analyzeGoFile(filePath, options));
  }

  return {
    language: 'go',
    files,
    summary: {
      files: files.length,
      symbols: files.reduce((count, file) => count + file.symbols.length, 0),
      boundaryClues: files.reduce((count, file) => count + file.boundaryClues.length, 0),
    },
  };
}

function analyzeGoSource(source, options = {}) {
  const filePath = options.filePath || null;
  const lines = source.split(/\r?\n/);
  const lineIndex = buildLineIndex(lines);
  const imports = extractImports(lines);
  const structs = extractStructs(lines, lineIndex);
  const functions = extractFunctions(lines, lineIndex);
  const symbols = [];
  const boundaryClues = [];
  const nodes = [];
  const edges = [];

  for (const item of structs) {
    symbols.push(item.symbol);
    nodes.push(item.node);

    for (const field of item.fields) {
      symbols.push(field.symbol);
      nodes.push(field.node);
      edges.push({
        id: makeEdgeId(item.node.id, field.node.id, 'contains'),
        kind: 'contains',
        from: item.node.id,
        to: field.node.id,
      });

      for (const clue of field.boundaryClues) {
        boundaryClues.push(clue);
        nodes.push(clue.node);
        edges.push({
          id: makeEdgeId(field.node.id, clue.node.id, clue.kind),
          kind: clue.kind,
          from: field.node.id,
          to: clue.node.id,
        });
      }
    }
  }

  for (const fn of functions) {
    symbols.push(fn.symbol);
    nodes.push(fn.node);

    if (fn.isHandler) {
      const clue = createBoundaryClue({
        filePath,
        lineIndex,
        line: fn.line,
        column: fn.column,
        kind: 'http-handler',
        category: 'http',
        name: fn.symbol.name,
        evidence: fn.handlerEvidence,
        relatedSymbolId: fn.node.id,
      });
      boundaryClues.push(clue);
      nodes.push(clue.node);
      edges.push({
        id: makeEdgeId(fn.node.id, clue.node.id, clue.kind),
        kind: clue.kind,
        from: fn.node.id,
        to: clue.node.id,
      });
    }

    for (const call of fn.calls) {
      const classification = classifyBoundaryCall(call.name);
      if (!classification) {
        continue;
      }

      const clue = createBoundaryClue({
        filePath,
        lineIndex,
        line: call.line,
        column: call.column,
        kind: classification.kind,
        category: classification.category,
        name: call.name,
        evidence: call.name,
        relatedSymbolId: fn.node.id,
      });
      boundaryClues.push(clue);
      nodes.push(clue.node);
      edges.push({
        id: makeEdgeId(fn.node.id, clue.node.id, clue.kind),
        kind: clue.kind,
        from: fn.node.id,
        to: clue.node.id,
      });
    }
  }

  return {
    language: 'go',
    filePath,
    imports,
    structs: structs.map((item) => item.summary),
    functions: functions.map((item) => item.summary),
    symbols,
    boundaryClues,
    graph: { nodes, edges },
    summary: {
      symbols: symbols.length,
      boundaryClues: boundaryClues.length,
      handlers: boundaryClues.filter((clue) => clue.kind === 'http-handler').length,
    },
  };
}

function extractImports(lines) {
  const imports = [];
  let inImportBlock = false;

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!inImportBlock) {
      if (/^import\s*\($/.test(line)) {
        inImportBlock = true;
        continue;
      }

      const single = line.match(/^import\s+(?:(?<alias>[A-Za-z_]\w*|_)\s+)?(?:"(?<path>[^"]+)")$/);
      if (single) {
        imports.push({
          alias: single.groups.alias || null,
          path: single.groups.path,
          location: { line: i + 1, column: rawLine.indexOf('import') + 1 },
        });
      }
      continue;
    }

    if (line === ')') {
      inImportBlock = false;
      continue;
    }
    if (!line || line.startsWith('//')) {
      continue;
    }

    const block = line.match(/^(?:(?<alias>[A-Za-z_]\w*|_)\s+)?(?:"(?<path>[^"]+)")$/);
    if (block) {
      imports.push({
        alias: block.groups.alias || null,
        path: block.groups.path,
        location: { line: i + 1, column: rawLine.indexOf(line) + 1 },
      });
    }
  }

  return dedupeByKey(imports, (item) => `${item.alias || ''}:${item.path}`);
}

function extractStructs(lines, lineIndex) {
  const structs = [];
  let current = null;

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    const lineNumber = i + 1;

    if (!current) {
      const match = rawLine.match(STRUCT_RE);
      if (match) {
        current = {
          name: match[1],
          startLine: lineNumber,
          fields: [],
          depth: 1,
        };
      }
      continue;
    }

    current.depth += countBraces(rawLine);
    if (line === '}' || current.depth <= 0) {
      const location = { line: current.startLine, column: lines[current.startLine - 1].indexOf(current.name) + 1 };
      const nodeId = makeNodeId('struct', current.name, location);
      structs.push({
        symbol: {
          id: nodeId,
          kind: 'struct',
          name: current.name,
          location,
          data: {
            exported: isExported(current.name),
            fieldCount: current.fields.length,
          },
        },
        node: {
          id: nodeId,
          kind: 'struct',
          name: current.name,
          location,
          data: {
            exported: isExported(current.name),
            fieldCount: current.fields.length,
          },
        },
        fields: current.fields,
        summary: {
          name: current.name,
          location,
          fields: current.fields.map((field) => field.summary),
        },
      });
      current = null;
      continue;
    }

    const field = parseStructField(rawLine, lineNumber, current.name);
    if (field) {
      current.fields.push(field);
    }
  }

  return structs;
}

function parseStructField(rawLine, lineNumber, parentName = null) {
  const line = stripTrailingComment(rawLine).trim();
  if (!line || line === '}' || line === '{') {
    return null;
  }

  const location = { line: lineNumber, column: rawLine.indexOf(line) + 1 };
  const tagMatch = line.match(/`([^`]*)`/);
  const tagValue = tagMatch ? extractTagValue(tagMatch[1], 'json') : null;
  const withoutTag = line.replace(/`[^`]*`/, '').trim();

  const named = withoutTag.match(FIELD_RE);
  const parsed = named
    ? {
        names: named[1].split(',').map((part) => part.trim()).filter(Boolean),
        type: named[2].trim(),
        embedded: false,
        embeddedType: null,
      }
    : withoutTag
      ? {
          names: [],
          type: withoutTag,
          embedded: true,
          embeddedType: withoutTag,
        }
      : null;

  if (!parsed) {
    return null;
  }

  const fieldName = parsed.names[0] || parsed.embeddedType || 'embedded-field';
  const nodeId = makeNodeId('field', fieldName, location);
  const jsonName = tagValue ? normalizeJSONTagName(tagValue) : null;
  const field = {
    symbol: {
      id: nodeId,
      kind: 'field',
      name: fieldName,
      location,
      data: {
        exported: parsed.names.length > 0 ? isExported(fieldName) : false,
        embedded: parsed.embedded,
        type: parsed.type,
        names: parsed.names,
        parent: parentName,
        jsonTag: tagValue,
        jsonName,
      },
    },
    node: {
      id: nodeId,
      kind: 'field',
      name: fieldName,
      location,
      data: {
        exported: parsed.names.length > 0 ? isExported(fieldName) : false,
        embedded: parsed.embedded,
        type: parsed.type,
        names: parsed.names,
        parent: parentName,
        jsonTag: tagValue,
        jsonName,
      },
    },
    boundaryClues: [],
    summary: {
      name: fieldName,
      type: parsed.type,
      location,
      embedded: parsed.embedded,
      parent: parentName,
      jsonName,
    },
  };

  if (tagValue) {
    field.boundaryClues.push(
      createBoundaryClue({
        filePath: null,
        line: location.line,
        column: location.column,
        kind: 'json-field',
        category: 'json',
        name: fieldName,
        evidence: tagValue,
        relatedSymbolId: nodeId,
      }),
    );
  }

  return field;
}

function extractFunctions(lines, lineIndex) {
  const functions = [];
  let current = null;

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    const lineNumber = i + 1;

    if (!current) {
      const match = rawLine.match(FUNC_RE);
      if (match) {
        const receiver = match[1] || null;
        const name = match[2];
        const params = match[3] || '';
        const location = { line: lineNumber, column: rawLine.indexOf('func') + 1 };
        const symbolName = receiver ? `${receiver}.${name}` : name;
        const nodeId = makeNodeId(receiver ? 'method' : 'function', symbolName, location);
        current = {
          symbol: {
            id: nodeId,
            kind: receiver ? 'method' : 'function',
            name: symbolName,
            location,
            data: {
              receiver,
              params,
              exported: isExported(name),
            },
          },
          node: {
            id: nodeId,
            kind: receiver ? 'method' : 'function',
            name: symbolName,
            location,
            data: {
              receiver,
              params,
              callCount: 0,
            },
          },
          summary: {
            name: symbolName,
            kind: receiver ? 'method' : 'function',
            location,
            handler: isHTTPHandlerSignature(name, params, line),
            callCount: 0,
          },
          calls: [],
          depth: countBraces(rawLine),
          isHandler: isHTTPHandlerSignature(name, params, line),
          handlerEvidence: buildHandlerEvidence(name, params, line),
          line: lineNumber,
          column: location.column,
        };
      }
      continue;
    }

    const calls = extractCallSitesFromLine(rawLine, lineNumber, lineIndex);
    for (const call of calls) {
      current.calls.push(call);
      current.node.data.callCount += 1;
      current.summary.callCount += 1;
    }

    current.depth += countBraces(rawLine);
    if (current.depth <= 0) {
      functions.push(current);
      current = null;
    }
  }

  if (current) {
    functions.push(current);
  }

  return functions;
}

function extractCallSitesFromLine(rawLine, lineNumber, lineIndex) {
  const calls = [];
  const line = stripTrailingComment(rawLine);
  CALL_RE.lastIndex = 0;
  let match;

  while ((match = CALL_RE.exec(line)) !== null) {
    const name = match[1];
    const simple = lastSegment(name);
    if (CONTROL_KEYWORDS.has(simple)) {
      continue;
    }
    calls.push({
      name,
      line: lineNumber,
      column: match.index + 1,
      location: { line: lineNumber, column: match.index + 1 },
    });
  }

  return calls;
}

function classifyBoundaryCall(name) {
  const simple = lastSegment(name);
  if (name === 'http.HandleFunc' || name === 'http.Handle' || name === 'http.NewRequest' || name === 'http.NewRequestWithContext') {
    return { kind: 'http-boundary', category: 'http' };
  }
  if (name === 'json.Marshal' || name === 'json.Unmarshal' || name === 'json.NewDecoder' || name === 'json.NewEncoder') {
    return { kind: 'json-boundary', category: 'json' };
  }
  if (JSON_BOUNDARY_METHODS.has(simple)) {
    return { kind: 'json-boundary', category: 'json' };
  }
  if (simple === 'Do') {
    return { kind: 'http-client-call', category: 'http' };
  }
  if (simple === 'NewRequest') {
    return { kind: 'http-client-request', category: 'http' };
  }
  if (simple === 'Handle' || simple === 'HandleFunc' || HTTP_ROUTE_METHODS.has(simple)) {
    return { kind: 'http-route-registration', category: 'http' };
  }
  if (simple === 'ServeHTTP') {
    return { kind: 'http-handler', category: 'http' };
  }
  return null;
}

function createBoundaryClue({ filePath, lineIndex, line, column, kind, category, name, evidence, relatedSymbolId }) {
  const location = { line, column };
  const nodeId = makeNodeId('boundary', `${kind}-${name || 'unknown'}`, location);
  return {
    kind,
    category,
    name,
    evidence,
    relatedSymbolId,
    location,
    node: {
      id: nodeId,
      kind: 'boundary',
      name,
      location,
      data: {
        boundaryKind: kind,
        category,
        evidence,
        filePath,
        relatedSymbolId,
      },
    },
    data: {
      boundaryKind: kind,
      category,
      evidence,
      filePath,
      relatedSymbolId,
    },
  };
}

function buildLineIndex(lines) {
  const starts = [0];
  let offset = 0;
  for (const line of lines) {
    offset += line.length + 1;
    starts.push(offset);
  }
  return starts;
}

function countBraces(line) {
  const cleaned = stripTrailingComment(line);
  let open = 0;
  let close = 0;
  for (const char of cleaned) {
    if (char === '{') {
      open += 1;
    } else if (char === '}') {
      close += 1;
    }
  }
  return open - close;
}

function stripTrailingComment(line) {
  let inString = false;
  let inRawString = false;
  let inRune = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (inString) {
      if (char === '\\') {
        i += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (inRawString) {
      if (char === '`') {
        inRawString = false;
      }
      continue;
    }
    if (inRune) {
      if (char === '\\') {
        i += 1;
      } else if (char === '\'') {
        inRune = false;
      }
      continue;
    }
    if (char === '/' && next === '/') {
      return line.slice(0, i);
    }
    if (char === '"') {
      inString = true;
    } else if (char === '`') {
      inRawString = true;
    } else if (char === '\'') {
      inRune = true;
    }
  }
  return line;
}

function extractTagValue(tag, key) {
  const regex = new RegExp(`${key}:"((?:\\\\.|[^"])*)"`);
  const match = tag.match(regex);
  return match ? match[1] : null;
}

function extractStructTag(line) {
  const match = line.match(/`([^`]*)`/);
  if (!match) {
    return {};
  }

  const tags = {};
  const tagRegex = /([A-Za-z_]\w*):"((?:\\.|[^"])*)"/g;
  let tagMatch;
  while ((tagMatch = tagRegex.exec(match[1])) !== null) {
    tags[tagMatch[1]] = {
      raw: tagMatch[2],
      value: tagMatch[2],
    };
  }

  return tags;
}

function normalizeJSONTagName(raw) {
  const [name] = raw.split(',');
  const trimmed = name.trim();
  return trimmed === '-' ? null : trimmed || null;
}

function isHTTPHandlerSignature(name, params, bodyOrLine) {
  if (name === 'ServeHTTP') {
    return true;
  }
  if (HTTP_HANDLER_HINTS.every((hint) => params.includes(hint))) {
    return true;
  }
  return bodyOrLine.includes('http.ResponseWriter') && bodyOrLine.includes('*http.Request');
}

function buildHandlerEvidence(name, params, bodyOrLine) {
  if (name === 'ServeHTTP') {
    return 'ServeHTTP method';
  }
  if (HTTP_HANDLER_HINTS.every((hint) => params.includes(hint))) {
    return 'http.ResponseWriter and *http.Request parameters';
  }
  if (bodyOrLine.includes('http.ResponseWriter') && bodyOrLine.includes('*http.Request')) {
    return 'request/response boundary usage';
  }
  return 'handler heuristic';
}

function lastSegment(name) {
  const index = name.lastIndexOf('.');
  return index === -1 ? name : name.slice(index + 1);
}

function makeNodeId(kind, name, location) {
  const safeName = String(name).replace(/[^A-Za-z0-9_]+/g, '_');
  return `${kind}:${safeName}:${location.line}:${location.column}`;
}

function makeEdgeId(from, to, kind) {
  return `${kind}:${from}->${to}`;
}

function isExported(name) {
  return /^[A-Z]/.test(name);
}

function dedupeByKey(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export {
  analyzeGoSource,
  analyzeGoFile,
  analyzeGoFiles,
  classifyBoundaryCall,
  parseStructField as extractStructFields,
  extractStructTag,
};
