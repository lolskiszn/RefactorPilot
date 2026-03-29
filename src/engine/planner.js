import { readText } from "../shared/file-system.js";
import { scorePlanConfidence, confidenceLevel, defaultApplyThreshold } from "./confidence.js";
import { collectVerificationSnapshot, summarizeMigrationPattern } from "./verification.js";

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isDynamicAccess(usage) {
  return usage.kind === "dict_key_dynamic" || usage.kind === "dynamic_access" || usage.dynamic === true;
}

function fileHasDynamicAccess(file) {
  const source = String(file.source ?? "");
  if (!source) {
    return false;
  }

  return (
    /\.\s*get\(\s*[A-Za-z_][A-Za-z0-9_]*\s*\)/.test(source) ||
    /\[\s*[A-Za-z_][A-Za-z0-9_]*\s*\]/.test(source)
  );
}

function candidateTargets(fieldName) {
  const snake = fieldName
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
  const camel = snake.replace(/_([a-z])/g, (_, char) => char.toUpperCase());

  return new Set([normalize(fieldName), normalize(snake), normalize(camel)]);
}

function extractFieldUsageSummary(file, targets) {
  const matchedFields = [];
  const matchedUsages = [];

  for (const field of file.fields ?? []) {
    const keyNames = [field.name, field.jsonName].filter(Boolean).map(normalize);
    if (keyNames.some((key) => targets.has(key))) {
      matchedFields.push(field);
    }
  }

  for (const usage of file.fieldUsages ?? []) {
    const usageName = normalize(usage.name);
    if (targets.has(usageName)) {
      matchedUsages.push(usage);
    }
  }

  return { matchedFields, matchedUsages };
}

function buildReplacementCandidates(source, path, fromField, toField) {
  const variants = [
    [fromField, toField],
    [snakeCase(fromField), snakeCase(toField)],
    [camelCase(fromField), camelCase(toField)],
  ].filter(([before, after]) => before && after && before !== after);
  const uniqueVariants = [];
  const seenBefore = new Set();

  for (const [before, after] of variants) {
    if (seenBefore.has(before)) {
      continue;
    }
    seenBefore.add(before);
    uniqueVariants.push([before, after]);
  }

  const replacements = [];
  const seen = new Set();
  const lines = source.split(/\r?\n/);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];

    for (const [before, after] of uniqueVariants) {
      const matcher = new RegExp(`\\b${escapeRegExp(before)}\\b`, "g");
      for (const match of line.matchAll(matcher)) {
        const candidate = {
          after,
          before,
          column: match.index + 1,
          line: lineIndex + 1,
          path,
          preview: line.trim(),
        };
        const key = `${candidate.path}:${candidate.line}:${candidate.column}:${candidate.before}:${candidate.after}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        replacements.push(candidate);
      }
    }
  }

  return replacements;
}

function snakeCase(value) {
  return String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

function camelCase(value) {
  return String(value ?? "").replace(/[_-]([a-z])/g, (_, char) => char.toUpperCase());
}

function escapeRegExp(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function planFieldRename(graph, intent) {
  const fromField = intent.fromField ?? intent.oldName ?? intent.field;
  const toField = intent.toField ?? intent.newName ?? intent.target;

  if (!fromField || !toField) {
    throw new TypeError("planFieldRename requires fromField and toField");
  }

  const targets = candidateTargets(fromField);
  const links = graph.metadata.contractLinks ?? [];
  const files = graph.metadata.scanResult?.files ?? [];
  const impactedFiles = [];
  const replacements = [];
  const warnings = [];
  const producerFiles = new Set();
  const consumerFiles = new Set();

  let duplicateMatches = 0;
  let dynamicAccessCount = 0;
  let unresolvedLinks = 0;
  let hasExactProducerMatch = false;
  let hasExactConsumerMatch = false;
  let hasUniqueBoundaryPath = false;

  const matchedByFile = new Map();

  for (const file of files) {
    const { matchedFields, matchedUsages } = extractFieldUsageSummary(file, targets);
    if (matchedFields.length === 0 && matchedUsages.length === 0) {
      if (fileHasDynamicAccess(file)) {
        dynamicAccessCount += 1;
        warnings.push(`Dynamic access detected in ${file.path}.`);
      }
      continue;
    }

    matchedByFile.set(file.path, { matchedFields, matchedUsages, file });

    if (matchedFields.some((field) => normalize(field.jsonName ?? field.name) === normalize(fromField))) {
      hasExactProducerMatch = true;
      producerFiles.add(file.path);
    }

    if (matchedUsages.some((usage) => normalize(usage.name) === normalize(fromField))) {
      hasExactConsumerMatch = true;
      consumerFiles.add(file.path);
    }

    const source = await readText(file.absolutePath);
    const fileReplacements = buildReplacementCandidates(source, file.path, fromField, toField);
    replacements.push(...fileReplacements);

    for (const usage of matchedUsages) {
      if (isDynamicAccess(usage)) {
        dynamicAccessCount += 1;
      }
    }

    if (fileHasDynamicAccess(file)) {
      dynamicAccessCount += 1;
      warnings.push(`Dynamic access detected in ${file.path}.`);
    }
  }

  for (const [path, entry] of matchedByFile.entries()) {
    const explanationPaths = [];
    for (const field of entry.matchedFields) {
      const relatedLinks = links.filter((link) => normalize(link.field.name) === normalize(field.name) || normalize(link.key) === normalize(field.jsonName ?? field.name));
      if (relatedLinks.length === 0) {
        unresolvedLinks += 1;
        continue;
      }

      if (relatedLinks.length === 1) {
        hasUniqueBoundaryPath = true;
      }

      for (const link of relatedLinks) {
        explanationPaths.push({
          from: link.field,
          key: link.key,
          to: link.consumer,
          path: link.path,
        });
      }
    }

    impactedFiles.push({
      confidence: entry.matchedFields.length && entry.matchedUsages.length ? "high" : "medium",
      fieldMatches: entry.matchedFields,
      explanationPaths,
      language: entry.file.language,
      path,
      usageMatches: entry.matchedUsages,
    });
  }

  const fileMatchCount = impactedFiles.length;
  duplicateMatches = Math.max(0, producerFiles.size - 1) + Math.max(0, consumerFiles.size - 1);

  const confidence = scorePlanConfidence({
    duplicateMatches,
    dynamicAccessCount,
    hasExactConsumerMatch,
    hasExactProducerMatch,
    hasUniqueBoundaryPath,
    unresolvedLinks,
  });

  if (fileMatchCount === 0) {
    warnings.push("No direct field or access match was found for the requested rename.");
  }

  if (dynamicAccessCount > 0) {
    warnings.push("Dynamic access patterns were detected and may require manual review.");
  }

  if (duplicateMatches > 0) {
    warnings.push("Multiple candidate producer or consumer files matched the rename target.");
  }

  const plan = {
    confidence: confidence.level,
    confidenceReasons: confidence.reasons,
    confidenceScore: confidence.score,
    fromField,
    impactedFiles,
    intent: {
      kind: "rename_field",
      newName: toField,
      oldName: fromField,
      target: intent.target ?? null,
    },
    notes: [
      "Preview is the default; apply is guarded by validation.",
      "Cross-language links are inferred from shared contract keys.",
      "Dynamic or ambiguous patterns reduce confidence and can block apply.",
    ],
    replacements,
    impactSummary: {
      duplicateMatches,
      dynamicAccessCount,
      unresolvedLinks,
    },
    summary: {
      impactedFileCount: impactedFiles.length,
      replacementCount: replacements.length,
    },
    toField,
    transformation: "field_rename",
    warnings,
  };

  const verificationSnapshot = await collectVerificationSnapshot(graph.metadata.rootDir ?? process.cwd(), plan);
  plan.verification = verificationSnapshot;
  plan.migrationPattern = summarizeMigrationPattern(plan, verificationSnapshot);
  plan.validation = validatePlan(plan, graph);
  plan.applyThreshold = defaultApplyThreshold();
  plan.explanations = impactedFiles.flatMap((file) => file.explanationPaths);

  return plan;
}

export function validatePlan(plan, graph) {
  const issues = [];
  const seenReplacementKeys = new Set();

  if (!plan.intent || plan.intent.kind !== "rename_field") {
    issues.push({
      code: "invalid-intent",
      message: "Only field rename intents are supported in v1.",
    });
  }

  if (plan.summary.impactedFileCount === 0) {
    issues.push({
      code: "no-impacted-files",
      message: "No impacted files were identified.",
    });
  }

  if (plan.confidenceScore < defaultApplyThreshold()) {
    issues.push({
      code: "low-confidence",
      message: `Confidence ${plan.confidenceScore} is below the apply threshold.`,
    });
  }

  if (plan.verification?.git?.detected && plan.verification.git.state === "dirty") {
    issues.push({
      code: "dirty-git-tree",
      message: "Working tree is dirty; write mode should be blocked.",
    });
  }

  for (const replacement of plan.replacements ?? []) {
    const key = `${replacement.path}:${replacement.line}:${replacement.column}:${replacement.before}:${replacement.after}`;
    if (seenReplacementKeys.has(key)) {
      issues.push({
        code: "duplicate-replacement",
        message: `Duplicate replacement candidate at ${replacement.path}:${replacement.line}:${replacement.column}`,
      });
      continue;
    }
    seenReplacementKeys.add(key);
  }

  const ambiguous = plan.impactSummary?.ambiguousMatches ?? 0;
  if (ambiguous > 0) {
    issues.push({
      code: "ambiguous-match",
      message: "Ambiguous matches remain unresolved.",
    });
  }

  if (graph && typeof graph.validate === "function") {
    const graphReport = graph.validate();
    if (!graphReport.valid) {
      issues.push({
        code: "invalid-graph",
        message: "Underlying graph is invalid.",
        details: graphReport.issues,
      });
    }
  }

  return {
    issues,
    valid: issues.length === 0,
  };
}
