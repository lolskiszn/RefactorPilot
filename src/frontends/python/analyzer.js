const DEF_RE = /^(\s*)(async\s+def|def|class)\s+([A-Za-z_][A-Za-z0-9_]*)/;
const ROUTE_DECORATOR_RE = /@\w+\.(get|post|put|patch|delete)\((["'`])([^"'`]+)\2/;
const JSON_ACCESS_RE = /(?:\[\s*["']([A-Za-z0-9_]+)["']\s*\]|\.get\(\s*["']([A-Za-z0-9_]+)["'])/g;
const HTTP_CALL_RE = /\b(requests|httpx)\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;
const ASSIGN_DICT_KEY_RE = /["']([A-Za-z0-9_]+)["']\s*:/g;

export function analyzePythonSource(source, path) {
  const lines = source.split(/\r?\n/);
  const symbols = [];
  const fields = [];
  const fieldUsages = [];
  const endpoints = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;

    const defMatch = line.match(DEF_RE);
    if (defMatch) {
      symbols.push({
        name: defMatch[3],
        kind: defMatch[2].includes("class") ? "class" : "function",
        line: lineNumber,
        column: line.indexOf(defMatch[3]) + 1,
        async: defMatch[2].startsWith("async"),
      });
    }

    const routeMatch = line.match(ROUTE_DECORATOR_RE);
    if (routeMatch) {
      endpoints.push({
        method: routeMatch[1].toUpperCase(),
        route: routeMatch[3],
        line: lineNumber,
        column: line.indexOf("@") + 1,
        framework: "python-web",
      });
    }

    for (const match of line.matchAll(JSON_ACCESS_RE)) {
      const name = match[1] || match[2];
      fieldUsages.push({
        name,
        kind: "json_access",
        line: lineNumber,
        column: match.index + 1,
      });
    }

    for (const match of line.matchAll(HTTP_CALL_RE)) {
      endpoints.push({
        method: match[2].toUpperCase(),
        route: match[3],
        line: lineNumber,
        column: match.index + 1,
        framework: match[1],
        role: "client",
      });
    }

    for (const match of line.matchAll(ASSIGN_DICT_KEY_RE)) {
      const name = match[1];
      fields.push({
        name,
        jsonName: name,
        kind: "payload_field",
        line: lineNumber,
        column: match.index + 1,
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
