import { applyPlan } from "../engine/apply.js";
import { inspectWorkspaceEnvironment } from "../engine/verify.js";
import { buildMultiRepoGraph, planCoordinatedMigration } from "./multi-repo-graph.js";
import { scanWorkspace } from "./scan-workspace.js";
import { planFieldRename, validatePlan } from "./plan-field-rename.js";
import { buildApiContractMigrationDetails, formatPreviewReport, previewFieldRename } from "./preview-report.js";

export {
  applyPlan,
  buildApiContractMigrationDetails,
  buildMultiRepoGraph,
  formatPreviewReport,
  inspectWorkspaceEnvironment,
  planCoordinatedMigration,
  planFieldRename,
  previewFieldRename,
  scanWorkspace,
  validatePlan,
};

export async function applyFieldRename(workspace, fromField, toField, options = {}) {
  const report = await previewFieldRename(workspace, fromField, toField, options);
  const apply = await applyPlan(report.plan, {
    differentialMode: options.differentialMode,
    mode: options.mode ?? "write",
    replayFixturePath: options.replayFixturePath,
    requireDifferential: options.requireDifferential,
    workspaceRoot: workspace,
    writeFile: options.writeFile,
  });

  return {
    ...report,
    migration: {
      ...(report.migration ??
        buildApiContractMigrationDetails({
          fromField,
          mode: options.mode ?? "write",
          plan: report.plan,
          toField,
          workspace: report.workspace,
        })),
      mode: apply.mode,
    },
    apply,
  };
}

export async function migrateApiContract(workspace, fromField, toField, options = {}) {
  const mode = options.mode ?? "preview";
  if (mode === "write" || mode === "dry-run") {
    return applyFieldRename(workspace, fromField, toField, {
      allowSchemaChange: options.allowSchemaChange,
      autoResolve: options.autoResolve,
      differentialMode: options.differentialMode,
      dynamicAnalysis: options.dynamicAnalysis,
      includeAllAmbiguous: options.includeAllAmbiguous,
      mode,
      replayFixturePath: options.replayFixturePath,
      requireDifferential: options.requireDifferential,
      targetContext: options.targetContext,
      writeFile: options.writeFile,
    });
  }

  const report = await previewFieldRename(workspace, fromField, toField, options);
  return {
    ...report,
    migration: {
      ...(report.migration ??
        buildApiContractMigrationDetails({
          fromField,
          mode: "preview",
          plan: report.plan,
          toField,
          workspace: report.workspace,
        })),
      mode: "preview",
    },
  };
}
