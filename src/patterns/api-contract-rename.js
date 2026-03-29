import { migrateApiContract } from "../orchestration/index.js";
import { buildApiContractMigrationDetails } from "../orchestration/preview-report.js";

export async function previewApiContractMigration(workspace, options = {}) {
  const fromField = options.fromField ?? options.field ?? options.from;
  const toField = options.toField ?? options.to;
  const preview = await migrateApiContract(workspace, fromField, toField, {
    mode: "preview",
  });
  const normalizedPreview = normalizePreview(preview);
  const migration = normalizedPreview.migration ?? buildApiContractMigrationDetails({
    fromField,
    mode: "preview",
    plan: normalizedPreview.plan,
    toField,
    workspace: normalizedPreview.workspace,
  });

  return {
    confidence: normalizedPreview.plan.confidence,
    confidenceLevel: normalizedPreview.plan.confidence,
    confidenceScore: normalizedPreview.plan.confidenceScore,
    demoOnly: false,
    generatedArtifacts: buildGeneratedArtifacts(normalizedPreview, migration, fromField, toField),
    impactSurface: migration.impactSurface,
    migration,
    notes: [
      ...(normalizedPreview.plan.notes ?? []),
      "Preview uses the current contract-rename engine and does not invent semantic REST to gRPC rewrites.",
    ],
    patternId: "api-contract-rename",
    patternTitle: "API Contract Migration",
    preview: normalizedPreview,
    warnings: normalizedPreview.plan.warnings ?? [],
  };
}

function normalizePreview(preview) {
  const plan = clonePlan(preview.plan);
  const hasAmbiguousUsages = (plan.impactedFiles ?? []).some((entry) => (entry.usageMatches ?? []).length > 1 || (entry.fieldMatches ?? []).length > 1);
  const hasDynamicUsages = (plan.impactedFiles ?? []).some((entry) => (entry.usageMatches ?? []).some((usage) => usage.kind === "dict_key_dynamic" || usage.dynamic === true));

  if (hasAmbiguousUsages && !plan.warnings.some((warning) => /ambiguous/i.test(warning))) {
    plan.warnings = [...plan.warnings, "Ambiguous contract matches were detected and require manual review."];
  }

  if (hasDynamicUsages && !plan.warnings.some((warning) => /dynamic/i.test(warning))) {
    plan.warnings = [...plan.warnings, "Dynamic access patterns were detected and require manual review."];
  }

  if (hasAmbiguousUsages || hasDynamicUsages) {
    plan.confidence = "low";
    plan.confidenceScore = Math.min(plan.confidenceScore, 0.49);
  }

  plan.validation = {
    ...plan.validation,
    issues: [...(plan.validation?.issues ?? [])],
  };

  if (hasAmbiguousUsages && !plan.validation.issues.some((issue) => issue.code === "ambiguous-match")) {
    plan.validation.issues.push({
      code: "ambiguous-match",
      message: "Ambiguous contract matches remain unresolved.",
    });
  }

  if ((hasAmbiguousUsages || hasDynamicUsages) && !plan.validation.issues.some((issue) => issue.code === "low-confidence")) {
    plan.validation.issues.push({
      code: "low-confidence",
      message: `Confidence ${plan.confidenceScore} is below the apply threshold.`,
    });
  }

  plan.validation.valid = plan.validation.issues.length === 0;

  return {
    ...preview,
    plan,
  };
}

function clonePlan(plan) {
  return {
    ...plan,
    impactSummary: plan.impactSummary ? { ...plan.impactSummary } : plan.impactSummary,
    impactedFiles: (plan.impactedFiles ?? []).map((entry) => ({
      ...entry,
      explanationPaths: (entry.explanationPaths ?? []).map((path) => ({
        ...path,
        from: path.from ? { ...path.from } : path.from,
        to: path.to ? { ...path.to } : path.to,
      })),
      fieldMatches: [...(entry.fieldMatches ?? [])],
      usageMatches: [...(entry.usageMatches ?? [])],
    })),
    intent: plan.intent ? { ...plan.intent } : plan.intent,
    notes: [...(plan.notes ?? [])],
    replacements: [...(plan.replacements ?? [])],
    summary: plan.summary ? { ...plan.summary } : plan.summary,
    validation: plan.validation
      ? {
          ...plan.validation,
          issues: [...(plan.validation.issues ?? [])],
        }
      : plan.validation,
    warnings: [...(plan.warnings ?? [])],
  };
}

function buildGeneratedArtifacts(preview, migration, fromField, toField) {
  const safeFrom = normalizeName(fromField);
  const safeTo = normalizeName(toField);

  return [
    {
      kind: "json",
      path: `preview/api-contract-rename/${safeFrom}-to-${safeTo}.plan.json`,
      preview: JSON.stringify(
        {
          fromField,
          toField,
          impactSurface: migration.impactSurface,
          confidenceScore: preview.plan.confidenceScore,
        },
        null,
        2,
      ),
    },
    {
      kind: "md",
      path: `preview/api-contract-rename/${safeFrom}-to-${safeTo}.notes.md`,
      preview: [
        "# API Contract Migration Preview",
        "",
        `Rename: ${fromField} -> ${toField}`,
        `Confidence: ${preview.plan.confidence} (${preview.plan.confidenceScore})`,
        `Affected files: ${migration.impactSurface.affectedFiles}`,
      ].join("\n"),
    },
  ];
}

function normalizeName(value) {
  return String(value ?? "field")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "field";
}
