const CLASS_RE = /^\s*class\s+([A-Za-z_]\w*)/;
const DEF_RE = /^\s*(?:async\s+def|def)\s+([A-Za-z_]\w*)\s*\(/;
const ASSIGN_RE = /^\s*self\.([A-Za-z_]\w*)\s*=/;
const DICT_KEY_RE = /["']([A-Za-z_]\w*)["']\s*:/g;
const DICT_ACCESS_RE = /\[\s*["']([A-Za-z_]\w*)["']\s*\]/g;
const DYNAMIC_ACCESS_RE = /\[\s*([A-Za-z_]\w*)\s*\]/g;
const GET_ACCESS_RE = /\.get\(\s*["']([A-Za-z_]\w*)["']\s*\)/g;
const IMPORT_RE = /^\s*import\s+(.+)$/;
const FROM_IMPORT_RE = /^\s*from\s+([A-Za-z0-9_.]+)\s+import\s+(.+)$/;

export function analyzePythonSource(source, path) {
  const lines = source.split(/\r?\n/);
  const symbols = [];
  const fields = [];
  const fieldUsages = [];
  const endpoints = [];
  let currentClass = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const lineNumber = index + 1;

    const classMatch = line.match(CLASS_RE);
    if (classMatch) {
      currentClass = classMatch[1];
      symbols.push({
        name: currentClass,
        kind: "class",
        line: lineNumber,
        column: line.indexOf(currentClass) + 1,
      });
      continue;
    }

    const functionMatch = line.match(DEF_RE);
    if (functionMatch) {
      symbols.push({
        name: functionMatch[1],
        kind: "function",
        line: lineNumber,
        column: line.indexOf(functionMatch[1]) + 1,
      });
    }

    if (currentClass && trimmed.startsWith("def ")) {
      currentClass = null;
    }

    if (currentClass) {
      const assignMatch = line.match(ASSIGN_RE);
      if (assignMatch) {
        fields.push({
          name: assignMatch[1],
          jsonName: snakeToCamel(assignMatch[1]),
          kind: "instance_attribute",
          parent: currentClass,
          line: lineNumber,
          column: line.indexOf(assignMatch[1]) + 1,
        });
      }
    }

    const importMatch = line.match(IMPORT_RE) || line.match(FROM_IMPORT_RE);
    if (importMatch && /\brequests\b|\bhttpx\b|\bjson\b/.test(trimmed)) {
      endpoints.push({
        method: "GET",
        route: null,
        line: lineNumber,
        column: 1,
        framework: "python",
      });
    }

    for (const match of line.matchAll(DICT_KEY_RE)) {
      fieldUsages.push({
        name: match[1],
        kind: "dict_key",
        line: lineNumber,
        column: match.index + 1,
      });
    }

    for (const match of line.matchAll(DICT_ACCESS_RE)) {
      fieldUsages.push({
        name: match[1],
        kind: "dict_key",
        line: lineNumber,
        column: match.index + 1,
      });
    }

    for (const match of line.matchAll(GET_ACCESS_RE)) {
      fieldUsages.push({
        name: match[1],
        kind: "dict_get",
        line: lineNumber,
        column: match.index + 1,
      });
    }

    for (const match of line.matchAll(DYNAMIC_ACCESS_RE)) {
      if (line.slice(match.index, match.index + match[0].length).includes("'") || line.slice(match.index, match.index + match[0].length).includes('"')) {
        continue;
      }
      fieldUsages.push({
        name: match[1],
        kind: "dict_key_dynamic",
        dynamic: true,
        line: lineNumber,
        column: match.index + 1,
      });
    }

    if (/json\.(loads?|dumps?)\s*\(/.test(trimmed) || /\.json\s*\(\s*\)/.test(trimmed)) {
      endpoints.push({
        method: "JSON",
        route: null,
        line: lineNumber,
        column: 1,
        framework: "python-json",
      });
    }
  }

  return {
    language: "python",
    path,
    symbols: dedupeByLocation(symbols),
    fields: dedupeByLocation(fields),
    fieldUsages: dedupeByLocation(fieldUsages),
    endpoints: dedupeByLocation(endpoints),
  };
}

function snakeToCamel(value) {
  return value.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
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
