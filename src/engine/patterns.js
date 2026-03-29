export const MIGRATION_PATTERNS = Object.freeze({
  apiContractRename: {
    description: "Cross-language API contract field rename.",
    id: "api-contract-rename",
    previewOnly: false,
    supported: true,
  },
  restToGrpcPreview: {
    description: "Preview-only REST to gRPC migration pattern for future work.",
    id: "rest-to-grpc-preview",
    previewOnly: true,
    supported: false,
  },
  observabilityUpgrade: {
    description: "Preview-only tracing and logging upgrade pattern.",
    id: "observability-upgrade",
    previewOnly: true,
    supported: false,
  },
});

export function detectMigrationPattern(plan, verificationSnapshot = {}) {
  const hasGo = verificationSnapshot.languages?.has("go");
  const hasPython = verificationSnapshot.languages?.has("python");
  const hasHttpClient = verificationSnapshot.http?.client === true;
  const hasHttpServer = verificationSnapshot.http?.server === true;

  if (plan?.transformation === "field_rename" && hasGo && hasPython) {
    return {
      ...MIGRATION_PATTERNS.apiContractRename,
      confidence: "high",
      reason: "Go and Python contract fields are linked through a stable boundary key.",
    };
  }

  if (hasGo && hasPython && (hasHttpClient || hasHttpServer)) {
    return {
      ...MIGRATION_PATTERNS.restToGrpcPreview,
      confidence: "medium",
      reason: "HTTP client/server clues suggest a transport migration preview.",
    };
  }

  if (verificationSnapshot.observability?.traces === true || verificationSnapshot.observability?.logs === true) {
    return {
      ...MIGRATION_PATTERNS.observabilityUpgrade,
      confidence: "medium",
      reason: "Tracing or logging signals suggest an observability upgrade preview.",
    };
  }

  return {
    ...MIGRATION_PATTERNS.apiContractRename,
    confidence: "low",
    reason: "No specific migration pattern was proven.",
  };
}
