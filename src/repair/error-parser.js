function matchFirst(text, pattern, group = 1) {
  const match = String(text ?? "").match(pattern);
  return match ? match[group] : null;
}

export function classifyCompilationIssue(issue) {
  if (!issue) {
    return null;
  }
  const message = String(issue.message ?? "");
  const category = issue.category ?? "Unknown";
  if (category === "ImportError") {
    return {
      ...issue,
      importName: issue.importName ?? matchFirst(message, /Missing import ([^.\s]+(?:\.[^.\s]+)*)/i) ?? matchFirst(message, /Import "([^"]+)"/i),
      kind: "missing_import",
      symbol: issue.symbol ?? matchFirst(message, /undefined:\s*([A-Za-z_][A-Za-z0-9_]*)/i),
    };
  }
  if (category === "TypeMismatch") {
    return {
      ...issue,
      expectedType: issue.expectedType ?? matchFirst(message, /as type ([A-Za-z0-9_.]+)/i) ?? matchFirst(message, /expected ([A-Za-z0-9_.]+)/i),
      kind: "type_mismatch",
      sourceType: issue.sourceType ?? matchFirst(message, /cannot use .*? as ([A-Za-z0-9_.]+)/i) ?? matchFirst(message, /got ([A-Za-z0-9_.]+)/i),
    };
  }
  if (category === "UndefinedSymbol") {
    return {
      ...issue,
      kind: "undefined_symbol",
      symbol: issue.symbol ?? matchFirst(message, /undefined:\s*([A-Za-z_][A-Za-z0-9_]*)/i) ?? matchFirst(message, /method ([A-Za-z_][A-Za-z0-9_]*)/i),
    };
  }
  if (category === "ProtoConflict") {
    return {
      ...issue,
      conflictNumber: Number(matchFirst(message, /Field number\s+(\d+)/i) ?? 0) || null,
      kind: "proto_conflict",
    };
  }
  if (category === "SyntaxError") {
    return {
      ...issue,
      kind: "syntax_error",
    };
  }
  return {
    ...issue,
    kind: "unknown",
  };
}

export function parseCompilationIssues(issues) {
  return (issues ?? []).map(classifyCompilationIssue).filter(Boolean);
}
