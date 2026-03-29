const INTERFACE_RE = /^\s*(?:export\s+)?interface\s+([A-Za-z_][A-Za-z0-9_]*)/;
const TYPE_ALIAS_RE = /^\s*(?:export\s+)?type\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{/;
const PROPERTY_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\??\s*:\s*([^;]+);?/;
const FETCH_RE = /\bfetch\s*\(\s*["'`]([^"'`]+)["'`]/g;
const JSON_KEY_RE = /["']([A-Za-z_][A-Za-z0-9_]*)["']\s*:/g;
const PROPERTY_ACCESS_RE = /\.(?:data|body|payload)?\.?([A-Za-z_][A-Za-z0-9_]*)\b/g;
const INDEX_ACCESS_RE = /\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]/g;
const AXIOS_RE = /\baxios\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;

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

export function analyzeTypeScriptSource(source, path) {
  const lines = String(source ?? "").split(/\r?\n/);
  const symbols = [];
  const fields = [];
  const fieldUsages = [];
  const endpoints = [];
  let currentType = null;
  let braceDepth = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;

    const interfaceMatch = line.match(INTERFACE_RE) || line.match(TYPE_ALIAS_RE);
    if (interfaceMatch) {
      currentType = interfaceMatch[1];
      braceDepth = (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
      symbols.push({
        name: currentType,
        kind: "interface",
        line: lineNumber,
        column: line.indexOf(currentType) + 1,
      });
    } else if (currentType) {
      braceDepth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
      const propertyMatch = line.match(PROPERTY_RE);
      if (propertyMatch) {
        fields.push({
          name: propertyMatch[1],
          jsonName: propertyMatch[1],
          kind: "interface_property",
          parent: currentType,
          type: propertyMatch[2].trim(),
          line: lineNumber,
          column: line.indexOf(propertyMatch[1]) + 1,
        });
      }
      if (braceDepth <= 0 || line.trim() === "}") {
        currentType = null;
      }
    }

    for (const match of line.matchAll(FETCH_RE)) {
      endpoints.push({
        method: "FETCH",
        route: match[1],
        line: lineNumber,
        column: match.index + 1,
        framework: "typescript-fetch",
        role: "client",
      });
    }

    for (const match of line.matchAll(AXIOS_RE)) {
      endpoints.push({
        method: match[1].toUpperCase(),
        route: match[2],
        line: lineNumber,
        column: match.index + 1,
        framework: "typescript-axios",
        role: "client",
      });
    }

    for (const match of line.matchAll(JSON_KEY_RE)) {
      fieldUsages.push({
        name: match[1],
        kind: "object_key",
        line: lineNumber,
        column: match.index + 1,
      });
    }

    for (const match of line.matchAll(INDEX_ACCESS_RE)) {
      fieldUsages.push({
        name: match[1],
        kind: "index_access",
        line: lineNumber,
        column: match.index + 1,
      });
    }

    for (const match of line.matchAll(PROPERTY_ACCESS_RE)) {
      const propertyName = match[1];
      if (!propertyName || /^[A-Z]/.test(propertyName)) {
        continue;
      }
      fieldUsages.push({
        name: propertyName,
        kind: "property_access",
        line: lineNumber,
        column: match.index + 1,
      });
    }
  }

  return {
    endpoints: dedupeByLocation(endpoints),
    fieldUsages: dedupeByLocation(fieldUsages),
    fields: dedupeByLocation(fields),
    language: "typescript",
    path,
    symbols: dedupeByLocation(symbols),
  };
}
