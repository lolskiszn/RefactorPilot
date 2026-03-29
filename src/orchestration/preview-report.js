import { scanWorkspace } from "./scan-workspace.js";
import { planFieldRename } from "./plan-field-rename.js";

export async function previewFieldRename(workspace, fromField, toField, options = {}) {
  const scan = await scanWorkspace(workspace);
  const plan = await planFieldRename(scan, fromField, toField, options);

  return {
    migration: buildApiContractMigrationDetails({
      mode: "preview",
      fromField,
      plan,
      toField,
      workspace: scan.rootDir,
    }),
    workspace: scan.rootDir,
    transformation: plan.transformation,
    fromField,
    toField,
    scan,
    plan,
    summary: {
      scannedFiles: scan.files.length,
      graphNodes: scan.graph.nodes.length,
      graphEdges: scan.graph.edges.length,
      impactedFiles: plan.summary.impactedFileCount,
      replacementCount: plan.summary.replacementCount,
      confidence: plan.confidence,
      confidenceScore: plan.confidenceScore,
    },
  };
}

export function buildApiContractMigrationDetails(report) {
  const impactedFiles = report.plan.impactedFiles ?? [];
  const files = impactedFiles.map((entry) => entry.path);
  const languages = [...new Set(impactedFiles.map((entry) => entry.language))];
  const boundaryPaths = report.plan.explanations?.length ?? 0;
  const estimatedManualMinutes = Math.max(10, impactedFiles.length * 12 + (report.plan.replacements?.length ?? 0) * 3);

  return {
    title: "API Contract Migration",
    kind: "api-contract",
    mode: report.mode ?? "preview",
    impactSurface: {
      affectedFiles: impactedFiles.length,
      affectedLanguages: languages,
      boundaryPaths,
      files,
      replacementCandidates: report.plan.replacements?.length ?? 0,
      estimatedManualMinutes,
    },
    riskAssessment: {
      confidence: report.plan.confidence,
      confidenceScore: report.plan.confidenceScore,
      safeToApply: Boolean(report.plan.validation?.valid),
      warnings: report.plan.warnings ?? [],
      blockingIssues: report.plan.validation?.issues ?? [],
    },
    whyItMatters: [
      "Keeps the Go producer and Python consumer aligned on the same contract.",
      "Shows the blast radius before any write so review stays fast and safe.",
      "Reuses one migration plan for preview and apply, so the diff matches the action.",
    ],
  };
}

export function formatPreviewReport(report) {
  const lines = [];
  const migration = report.migration ?? buildApiContractMigrationDetails({
    fromField: report.fromField,
    mode: "preview",
    plan: report.plan,
    toField: report.toField,
    workspace: report.workspace,
  });

  lines.push(migration.title);
  lines.push(`Mode: ${migration.mode}`);
  lines.push(`Workspace: ${report.workspace}`);
  lines.push(`Contract: ${report.fromField} -> ${report.toField}`);
  lines.push(`Scanned files: ${report.summary.scannedFiles}`);
  lines.push(`Graph: ${report.summary.graphNodes} nodes, ${report.summary.graphEdges} edges`);
  lines.push("");
  lines.push("Preview Summary");
  lines.push(`  Risk level: ${report.plan.confidence === "high" ? "low" : report.plan.confidence === "medium" ? "moderate" : "elevated"}`);
  lines.push(`  Safe preview-first mode: ${report.plan.validation.valid ? "ready" : "review required"}`);
  lines.push("");
  lines.push("Impact Surface");
  lines.push(`  Affected files: ${migration.impactSurface.affectedFiles}`);
  lines.push(`  Affected languages: ${migration.impactSurface.affectedLanguages.join(", ") || "none"}`);
  lines.push(`  Boundary paths: ${migration.impactSurface.boundaryPaths}`);
  lines.push(`  Replacement candidates: ${migration.impactSurface.replacementCandidates}`);
  lines.push(`  Estimated manual effort: ~${migration.impactSurface.estimatedManualMinutes} min`);
  if (migration.impactSurface.files.length > 0) {
    lines.push(`  Files: ${migration.impactSurface.files.join(", ")}`);
  }

  lines.push("");
  lines.push("Risk Assessment");
  lines.push(`  Confidence: ${migration.riskAssessment.confidence} (${migration.riskAssessment.confidenceScore})`);
  lines.push(`  Safe to apply: ${migration.riskAssessment.safeToApply ? "yes" : "no"}`);
  if (report.plan.confidenceReasons?.length > 0) {
    lines.push(`  Reasons: ${report.plan.confidenceReasons.join("; ")}`);
  }
  if (migration.riskAssessment.warnings.length > 0) {
    lines.push(`  Warnings: ${migration.riskAssessment.warnings.join("; ")}`);
  }
  if (migration.riskAssessment.blockingIssues.length > 0) {
    lines.push(
      `  Blocking issues: ${migration.riskAssessment.blockingIssues.map((issue) => issue.message).join("; ")}`,
    );
  }

  if (report.plan.disambiguation?.ambiguous) {
    lines.push("");
    lines.push("Conflict Resolution");
    for (const group of report.plan.disambiguation.groups ?? []) {
      lines.push(`  ${group.title}:`);
      for (const option of group.options) {
        const markers = [
          option.recommended ? "recommended" : null,
          group.selectedOptionId === option.id ? "selected" : null,
        ].filter(Boolean);
        lines.push(
          `    - ${option.label} (${option.filePath}) confidence ${option.confidence}${markers.length ? ` [${markers.join(", ")}]` : ""}`,
        );
        lines.push(`      ${option.reasoning}`);
      }
    }
  }

  if (report.plan.ambiguityResolution) {
    lines.push("");
    lines.push("Auto Resolution");
    lines.push(`  Mode: ${report.plan.ambiguityResolution.mode}`);
    if (report.plan.ambiguityResolution.selected) {
      lines.push(`  Selected: ${report.plan.ambiguityResolution.selected}`);
    }
    if (report.plan.ambiguityResolution.resolutionConfidence !== undefined) {
      lines.push(`  Resolution confidence: ${report.plan.ambiguityResolution.resolutionConfidence}`);
    }
    if (report.plan.ambiguityResolution.reasoning?.length > 0) {
      lines.push(`  Reasoning: ${report.plan.ambiguityResolution.reasoning.join("; ")}`);
    }
  }

  if (report.plan.dynamicAnalysis?.enabled) {
    lines.push("");
    lines.push("Dynamic Analysis");
    lines.push(`  Trace hints: ${report.plan.dynamicAnalysis.traceEvents}`);
    lines.push(`  Runtime-expanded impacts: ${report.plan.impactSummary?.dynamicRuntimeImpacts ?? 0}`);
  }

  if ((report.plan.sideEffects?.length ?? 0) > 0) {
    lines.push("");
    lines.push("Side Effects");
    for (const entry of report.plan.sideEffects) {
      lines.push(`  - ${entry.category} [${entry.severity}] ${entry.file}`);
      lines.push(`    ${entry.suggestedVerificationTest}`);
    }
  }

  if (report.apply?.differential) {
    lines.push("");
    lines.push("Behavioral Verification");
    lines.push(`  Checked: ${report.apply.differential.checked ? "yes" : "no"}`);
    lines.push(
      `  Equivalent: ${
        report.apply.differential.equivalent === null
          ? "not-run"
          : report.apply.differential.equivalent
            ? "yes"
            : "no"
      }`,
    );
    if (report.apply.differential.fixturePath) {
      lines.push(`  Fixture: ${report.apply.differential.fixturePath}`);
    }
    if ((report.apply.differential.divergences ?? []).length > 0) {
      for (const divergence of report.apply.differential.divergences) {
        lines.push(`  - divergence[${divergence.index}]: ${divergence.reason}`);
      }
    }
  }

  lines.push("");
  lines.push("Why It Matters");
  for (const note of migration.whyItMatters) {
    lines.push(`- ${note}`);
  }

  lines.push("");
  lines.push(`Impacted files: ${report.summary.impactedFiles}`);
  lines.push(`Replacement candidates: ${report.summary.replacementCount}`);
  lines.push("");
  lines.push("Impacted files");

  if (report.plan.impactedFiles.length === 0) {
    lines.push("  None found");
  } else {
    report.plan.impactedFiles.forEach((entry, index) => {
      const fieldMatches = entry.fieldMatches.map(formatFieldMatch).join("; ") || "none";
      const usageMatches = entry.usageMatches.map((usage) => `${usage.name}@${usage.line}:${usage.column}`).join("; ") || "none";
      lines.push(`${index + 1}. ${entry.path} [${entry.language}]`);
      lines.push(`   field matches: ${fieldMatches}`);
      lines.push(`   usage matches: ${usageMatches}`);
      if (entry.explanationPaths.length > 0) {
        lines.push(`   explanation paths: ${entry.explanationPaths.map(formatPath).join(" | ")}`);
      }
    });
  }

  lines.push("");
  lines.push("Replacement sample");
  if (report.plan.replacements.length === 0) {
    lines.push("  None found");
  } else {
    report.plan.replacements.slice(0, 10).forEach((replacement, index) => {
      lines.push(`${index + 1}. ${replacement.path}:${replacement.line}:${replacement.column} ${replacement.before} -> ${replacement.after}`);
    });
    if (report.plan.replacements.length > 10) {
      lines.push(`  ... and ${report.plan.replacements.length - 10} more`);
    }
  }

  lines.push("");
  lines.push("Validation");
  lines.push(report.plan.validation.valid ? "  valid" : "  invalid");
  for (const issue of report.plan.validation.issues) {
    lines.push(`- ${issue.code}: ${issue.message}`);
  }

  lines.push("");
  lines.push("Warnings");
  if (report.plan.warnings.length === 0) {
    lines.push("  None");
  } else {
    for (const warning of report.plan.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  lines.push("");
  lines.push("Explanation paths");
  if (report.plan.explanations.length === 0) {
    lines.push("  None");
  } else {
    for (const entry of report.plan.explanations) {
      lines.push(`- ${entry.path.join(" -> ")}`);
    }
  }

  lines.push("");
  lines.push("Notes");
  report.plan.notes.forEach((note) => {
    lines.push(`- ${note}`);
  });

  return lines.join("\n");
}

function formatFieldMatch(field) {
  const pieces = [field.kind, field.name];
  if (field.jsonName) {
    pieces.push(`json=${field.jsonName}`);
  }
  if (field.parent) {
    pieces.push(`parent=${field.parent}`);
  }
  if (field.line) {
    pieces.push(`line=${field.line}`);
  }
  return pieces.join(" ");
}

function formatPath(pathParts) {
  return pathParts.path.join(" -> ");
}
