function includesFieldLiteral(source, field) {
  return new RegExp(`["'\`]${field}["'\`]`).test(source);
}

function collectConstraints(source, field) {
  const constraints = [];

  if (/\bif\b/.test(source)) {
    constraints.push("branching logic present");
  }
  if (/switch|match|case/.test(source)) {
    constraints.push("type or value switch present");
  }
  if (/payload\[[A-Za-z_][A-Za-z0-9_]*\]/.test(source) || /\.get\(\s*[A-Za-z_][A-Za-z0-9_]*\s*\)/.test(source)) {
    constraints.push("dynamic field selector present");
  }
  if (!includesFieldLiteral(source, field) && /field_name|key_name|attr_name|column_name/.test(source)) {
    constraints.push("runtime-provided selector present");
  }

  return constraints;
}

function detectSinks(source) {
  const sinks = [];
  if (/http\.|requests\.|httpx\./.test(source)) {
    sinks.push("network");
  }
  if (/sql|gorm:|db:|bson:/.test(source)) {
    sinks.push("database");
  }
  if (/redis|cache|lru/.test(source)) {
    sinks.push("cache");
  }
  if (/log\.|logging\.|zap\.|slog\./.test(source)) {
    sinks.push("logs");
  }
  return sinks;
}

export function executeSymbolicSlice(file, field) {
  const source = String(file.source ?? "");
  const constraints = collectConstraints(source, field);
  const sinks = detectSinks(source);

  return {
    constraints,
    dynamic: constraints.some((entry) => entry.includes("dynamic") || entry.includes("runtime")),
    field,
    file: file.path,
    safe: constraints.length === 0 || (constraints.length === 1 && constraints[0] === "branching logic present"),
    sinks,
    timeoutMs: 5000,
  };
}
