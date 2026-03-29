export { scanWorkspace } from "./workspace.js";
export { buildGraph, linkContracts } from "./graph.js";
export { planFieldRename, validatePlan } from "./planner.js";
export { applyPlan } from "./apply.js";
export { confidenceLevel, defaultApplyThreshold, scorePlanConfidence } from "./confidence.js";
export { inspectWorkspaceEnvironment } from "./verify.js";
export {
  assessVerificationReadiness,
  buildVerificationHooks,
  collectVerificationSnapshot,
  summarizeMigrationPattern,
} from "./verification.js";
export { detectMigrationPattern, MIGRATION_PATTERNS } from "./patterns.js";
