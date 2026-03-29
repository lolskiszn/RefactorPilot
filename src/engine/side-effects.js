function detectDatabaseSideEffects(file, targetField) {
  const source = String(file.source ?? "");
  if (!/(gorm:|db:|bson:|sql\.|SELECT\s|INSERT\s|UPDATE\s|DELETE\s)/i.test(source)) {
    return [];
  }
  return [{
    category: "database",
    file: file.path,
    severity: "high",
    suggestedVerificationTest: "Run schema and migration contract checks before apply.",
  }];
}

function detectCacheSideEffects(file) {
  const source = String(file.source ?? "");
  if (!/redis|cache|fmt\.Sprintf\(|f["'].*\{.*\}/.test(source)) {
    return [];
  }
  return [{
    category: "cache",
    file: file.path,
    severity: "medium",
    suggestedVerificationTest: "Check cache key compatibility and invalidation behavior.",
  }];
}

function detectExternalApiSideEffects(file) {
  const source = String(file.source ?? "");
  if (!/http\.Client|requests\.|httpx\.|webhook|webhooks/.test(source)) {
    return [];
  }
  return [{
    category: "external-api",
    file: file.path,
    severity: "high",
    suggestedVerificationTest: "Replay API contract tests or webhook fixtures before apply.",
  }];
}

function detectLoggingSideEffects(file, targetField) {
  const source = String(file.source ?? "");
  if (!/log\.|logging\.|slog\.|zap\./.test(source) || !new RegExp(targetField).test(source)) {
    return [];
  }
  return [{
    category: "logging",
    file: file.path,
    severity: "low",
    suggestedVerificationTest: "Confirm log/search pipelines still index the renamed field.",
  }];
}

export function detectSideEffects(scanResult, targetField) {
  const findings = [];

  for (const file of scanResult.files ?? []) {
    findings.push(...detectDatabaseSideEffects(file, targetField));
    findings.push(...detectCacheSideEffects(file));
    findings.push(...detectExternalApiSideEffects(file));
    findings.push(...detectLoggingSideEffects(file, targetField));
  }

  return findings;
}
