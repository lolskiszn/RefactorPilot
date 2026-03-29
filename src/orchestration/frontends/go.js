const STRUCT_RE = /^\s*type\s+([A-Z][A-Za-z0-9_]*)\s+struct\s*\{/;
const FUNC_RE = /^\s*func\s*(?:\([^)]+\)\s*)?([A-Z_a-z][A-Za-z0-9_]*)\s*\(/;
const FIELD_RE = /^\s*([A-Z][A-Za-z0-9_]*)\s+([^\s`]+)(?:\s+`([^`]+)`)?/;
const ROUTE_RE = /["'`](GET|POST|PUT|PATCH|DELETE)\s+([^"'`]+)["'`]/g;
const JSON_TAG_RE = /json:"([^",]+)[^"]*"/;
const KEY_ACCESS_RE = /(?:\.\s*([A-Za-z0-9_]+)|\[\s*["']([A-Za-z0-9_]+)["']\s*\])/g;

export function analyzeGoSource(source, path) {
  const lines = source.split(/\r?\n/);
  const symbols = [];
  const fields = [];
  const fieldUsages = [];
  const endpoints = [];
  let currentStruct = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;

    const structMatch = line.match(STRUCT_RE);
    if (structMatch) {
      currentStruct = structMatch[1];
      symbols.push({
        name: currentStruct,
        kind: "struct",
        line: lineNumber,
        column: line.indexOf(currentStruct) + 1,
      });
      continue;
    }

    if (currentStruct && line.trim() === "}") {
      currentStruct = null;
    }

    const funcMatch = line.match(FUNC_RE);
    if (funcMatch) {
      symbols.push({
        name: funcMatch[1],
        kind: "function",
        line: lineNumber,
        column: line.indexOf(funcMatch[1]) + 1,
      });
    }

    if (currentStruct) {
      const fieldMatch = line.match(FIELD_RE);
      if (fieldMatch) {
        const tag = fieldMatch[3] ?? "";
        const jsonTagMatch = tag.match(JSON_TAG_RE);
        fields.push({
          name: fieldMatch[1],
          jsonName: jsonTagMatch?.[1] ?? null,
          type: fieldMatch[2],
          parent: currentStruct,
          kind: "struct_field",
          line: lineNumber,
          column: line.indexOf(fieldMatch[1]) + 1,
        });
      }
    }

    for (const match of line.matchAll(ROUTE_RE)) {
      endpoints.push({
        method: match[1],
        route: match[2],
        line: lineNumber,
        column: match.index + 1,
        framework: "go-http",
      });
    }

    for (const match of line.matchAll(KEY_ACCESS_RE)) {
      const name = match[1] || match[2];
      if (!name || /^[A-Z]/.test(name)) {
        continue;
      }

      fieldUsages.push({
        name,
        kind: "field_access",
        line: lineNumber,
        column: match.index + 1,
      });
    }
  }

  return {
    language: "go",
    path,
    symbols: dedupeByLocation(symbols),
    fields: dedupeByLocation(fields),
    fieldUsages: dedupeByLocation(fieldUsages),
    endpoints: dedupeByLocation(endpoints),
  };
}

function dedupeByLocation(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.kind ?? ""}:${item.name ?? item.route}:${item.line}:${item.column}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
