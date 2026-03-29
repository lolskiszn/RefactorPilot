import { readText } from "../shared/file-system.js";
import { confidenceLevel, defaultApplyThreshold, scorePlanConfidence } from "../engine/confidence.js";
import { rankAmbiguities } from "../engine/ambiguity-ranker.js";
import { applyAmbiguityConfidenceAdjustment } from "../engine/confidence-calculator.js";
import { applyDisambiguationSelection } from "../engine/disambiguation.js";
import { detectSideEffects } from "../engine/side-effects.js";
import { buildTaintReport } from "../engine/taint-tracker.js";

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function candidateTargets(fieldName) {
  const snake = snakeCase(fieldName);
  const camel = camelCase(snake);
  return new Set([normalize(fieldName), normalize(snake), normalize(camel)]);
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

function extractFieldUsageSummary(file, targets) {
  const matchedFields = [];
  const matchedUsages = [];

  for (const field of file.fields ?? []) {
    const keys = [field.name, field.jsonName].filter(Boolean).map(normalize);
    if (keys.some((key) => targets.has(key))) {
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

function isProducerField(file, field) {
  if (file.language === "go") {
    return true;
  }
  return field.kind === "payload_field" || field.kind === "struct_field";
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
  const lines = String(source ?? "").split(/\r?\n/);

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

function buildExplanations(scanResult, matchedByFile, fromField) {
  const contractLinks = scanResult.graph?.metadata?.contractLinks ?? [];
  const explanations = [];

  for (const [filePath, entry] of matchedByFile.entries()) {
    for (const field of entry.matchedFields) {
      const fieldName = normalize(field.name);
      const fieldKey = normalize(field.jsonName ?? field.name);
      const relatedLinks = contractLinks.filter((link) => {
        const linkKey = normalize(link.key);
        return linkKey === normalize(fromField) || linkKey === fieldName || linkKey === fieldKey;
      });

      for (const link of relatedLinks) {
        explanations.push({
          boundaryName: link.key,
          consumer: link.consumer,
          from: link.field,
          path: link.path,
          sourceFile: filePath,
        });
      }
    }
  }

  return explanations;
}

function inferDynamicImpactedFiles(scanResult, taintReport, fromField) {
  const inferred = [];

  for (const impact of taintReport.dynamicImpacts ?? []) {
    const file = (scanResult.files ?? []).find((entry) => entry.path === impact.file);
    if (!file) {
      continue;
    }

    inferred.push({
      confidence: "low",
      dynamicImpact: true,
      fieldMatches: [],
      explanationPaths: [
        {
          from: fromField,
          key: fromField,
          to: impact.file,
          path: [
            `dynamic:${fromField}`,
            `runtime:${impact.language}`,
            `file:${impact.file}`,
          ],
        },
      ],
      language: file.language,
      path: file.path,
      taint: impact,
      usageMatches: file.fieldUsages ?? [],
    });
  }

  return inferred;
}

export async function planFieldRename(scanResult, fromField, toField, options = {}) {
  if (!fromField || !toField) {
    throw new TypeError("planFieldRename requires fromField and toField");
  }

  const targets = candidateTargets(fromField);
  const files = scanResult.files ?? [];
  const impactedFiles = [];
  const replacements = [];
  const warnings = [];
  const producerFiles = new Set();
  const consumerFiles = new Set();
  const matchedByFile = new Map();

  let duplicateMatches = 0;
  let dynamicAccessCount = 0;
  let unresolvedLinks = 0;
  let hasExactProducerMatch = false;
  let hasExactConsumerMatch = false;
  let hasUniqueBoundaryPath = false;

  for (const file of files) {
    const { matchedFields, matchedUsages } = extractFieldUsageSummary(file, targets);

    if (matchedFields.length === 0 && matchedUsages.length === 0) {
      if (fileHasDynamicAccess(file)) {
        dynamicAccessCount += 1;
        warnings.push(`Dynamic access detected in ${file.path}.`);
      }
      continue;
    }

    matchedByFile.set(file.path, { file, matchedFields, matchedUsages });

    if (matchedFields.some((field) => isProducerField(file, field) && normalize(field.jsonName ?? field.name) === normalize(fromField))) {
      hasExactProducerMatch = true;
      producerFiles.add(file.path);
    }

    if (matchedUsages.some((usage) => normalize(usage.name) === normalize(fromField))) {
      hasExactConsumerMatch = true;
      consumerFiles.add(file.path);
    }

    const source = file.source ?? (file.absolutePath ? await readText(file.absolutePath) : "");
    replacements.push(...buildReplacementCandidates(source, file.path, fromField, toField));

    for (const usage of matchedUsages) {
      if (usage.kind === "dict_key_dynamic" || usage.dynamic === true) {
        dynamicAccessCount += 1;
      }
    }

    if (fileHasDynamicAccess(file)) {
      dynamicAccessCount += 1;
      warnings.push(`Dynamic access detected in ${file.path}.`);
    }
  }

  for (const [filePath, entry] of matchedByFile.entries()) {
    const explanationPaths = [];

    for (const field of entry.matchedFields) {
      const relatedLinks = (scanResult.graph?.metadata?.contractLinks ?? []).filter((link) => {
        const linkKey = normalize(link.key);
        const fieldName = normalize(field.name);
        const jsonName = normalize(field.jsonName ?? field.name);
        return linkKey === normalize(fromField) || linkKey === fieldName || linkKey === jsonName;
      });

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
      path: filePath,
      usageMatches: entry.matchedUsages,
    });
  }

  duplicateMatches = Math.max(0, producerFiles.size - 1) + Math.max(0, consumerFiles.size - 1);
  const ambiguousMatches = duplicateMatches;
  const confidence = scorePlanConfidence({
    duplicateMatches,
    dynamicAccessCount,
    hasExactConsumerMatch,
    hasExactProducerMatch,
    hasUniqueBoundaryPath,
    unresolvedLinks,
  });

  if (impactedFiles.length === 0) {
    warnings.push("No direct field or access match was found for the requested migration.");
  }

  if (dynamicAccessCount > 0) {
    warnings.push("Dynamic access patterns were detected and may require manual review.");
  }

  if (duplicateMatches > 0) {
    warnings.push("Multiple candidate producer or consumer files matched the migration target.");
  }

  const basePlan = {
    confidence: confidence.level,
    confidenceReasons: confidence.reasons,
    confidenceScore: confidence.score,
    fromField,
    impactedFiles,
    intent: {
      kind: "rename_field",
      newName: toField,
      oldName: fromField,
      target: null,
    },
    notes: [
      "Preview is the default; apply is guarded by validation.",
      "Cross-language links are inferred from shared contract keys.",
      "Dynamic or ambiguous patterns reduce confidence and can block apply.",
    ],
    replacements,
    impactSummary: {
      ambiguousMatches,
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

  basePlan.applyThreshold = defaultApplyThreshold();
  basePlan.explanations = buildExplanations(scanResult, matchedByFile, fromField);

  const plan = applyDisambiguationSelection(basePlan, {
    includeAllAmbiguous: options.includeAllAmbiguous,
    targetContext: options.targetContext,
  });
  const ranking = rankAmbiguities(plan, scanResult);
  let resolutionMode = options.targetContext ? "user" : "none";
  if (
    options.autoResolve &&
    !options.targetContext &&
    !options.includeAllAmbiguous &&
    plan.disambiguation?.ambiguous &&
    ranking.autoResolvable
  ) {
    const selectedContexts = ranking.groups
      .map((group) => group.rankedOptions?.[0]?.label)
      .filter(Boolean);
    const topOption = ranking.groups[0]?.rankedOptions?.[0];
    if (selectedContexts.length > 0) {
      const autoResolved = applyDisambiguationSelection(basePlan, {
        selectedContexts,
        targetContext: topOption?.label ?? null,
      });
      plan.impactedFiles = autoResolved.impactedFiles;
      plan.replacements = autoResolved.replacements;
      plan.summary = autoResolved.summary;
      plan.impactSummary = autoResolved.impactSummary;
      plan.warnings = [
        ...(autoResolved.warnings ?? []),
        `Auto-resolved ambiguity to ${topOption.label} with confidence ${topOption.score}.`,
      ];
      plan.disambiguation = {
        ...(autoResolved.disambiguation ?? {}),
        ranking,
        targetContext: topOption.label,
      };
      plan.ambiguityResolution = {
        mode: "auto",
        reasoning: topOption.reasoning,
        resolutionConfidence: topOption.score,
        selected: topOption.label,
      };
      resolutionMode = "auto";
    }
  } else if (options.targetContext) {
    plan.disambiguation = {
      ...(plan.disambiguation ?? {}),
      ranking,
    };
    plan.ambiguityResolution = {
      mode: "user",
      resolutionConfidence: 1,
      selected: options.targetContext,
    };
  } else if (plan.disambiguation?.ambiguous) {
    plan.disambiguation = {
      ...(plan.disambiguation ?? {}),
      ranking,
    };
    plan.ambiguityResolution = {
      mode: "unresolved",
      resolutionConfidence: ranking.groups[0]?.resolutionConfidence ?? 0,
    };
    resolutionMode = "unresolved";
  }
  if (plan.disambiguation?.groups && ranking.groups.length > 0) {
    plan.disambiguation.groups = plan.disambiguation.groups.map((group) => {
      const rankedGroup = ranking.groups.find((entry) => entry.kind === group.kind);
      if (!rankedGroup) {
        return group;
      }
      return {
        ...group,
        options: rankedGroup.rankedOptions,
        recommendedOptionId: rankedGroup.recommendedOptionId,
      };
    });
  }
  const rescored = scorePlanConfidence({
    duplicateMatches: plan.impactSummary?.duplicateMatches ?? 0,
    dynamicAccessCount,
    hasExactConsumerMatch,
    hasExactProducerMatch,
    hasUniqueBoundaryPath,
    unresolvedLinks,
  });
  plan.confidenceReasons = rescored.reasons;
  plan.confidenceScore = applyAmbiguityConfidenceAdjustment(rescored.score, {
    mode: resolutionMode,
    resolutionConfidence: plan.ambiguityResolution?.resolutionConfidence,
  });
  plan.confidence = confidenceLevel(plan.confidenceScore);

  if (options.dynamicAnalysis) {
    const taintReport = buildTaintReport(scanResult, fromField);
    const dynamicImpacts = inferDynamicImpactedFiles(scanResult, taintReport, fromField);
    const seenPaths = new Set((plan.impactedFiles ?? []).map((entry) => entry.path));
    for (const entry of dynamicImpacts) {
      if (!seenPaths.has(entry.path)) {
        plan.impactedFiles.push(entry);
        seenPaths.add(entry.path);
      } else {
        const existing = plan.impactedFiles.find((item) => item.path === entry.path);
        if (existing) {
          existing.dynamicImpact = true;
          existing.taint = entry.taint;
        }
      }
    }
    plan.summary.impactedFileCount = plan.impactedFiles.length;
    plan.dynamicAnalysis = {
      enabled: true,
      tracePlan: taintReport.trace.plan,
      traceEvents: taintReport.trace.events.length,
    };
    plan.impactSummary.dynamicRuntimeImpacts = dynamicImpacts.length;
    if (dynamicImpacts.length > 0) {
      plan.warnings.push("Dynamic analysis expanded the impact surface for runtime-selected fields.");
    }
    const sideEffects = detectSideEffects(scanResult, fromField);
    plan.sideEffects = sideEffects;
    if (sideEffects.length > 0) {
      plan.warnings.push(`Side effects detected: ${sideEffects.map((entry) => entry.category).join(", ")}.`);
    }
  }

  plan.validation = validatePlan(plan, scanResult);

  return plan;
}

export function validatePlan(plan, scanResult) {
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
  if (ambiguous > 0 && !plan.disambiguation?.includeAll && plan.ambiguityResolution?.mode !== "auto") {
    issues.push({
      code: "ambiguous-match",
      message: "Ambiguous matches remain unresolved.",
    });
  }

  if (scanResult?.graph && typeof scanResult.graph.validate === "function") {
    const graphReport = scanResult.graph.validate();
    if (!graphReport.valid) {
      issues.push({
        code: "invalid-graph",
        message: "Underlying graph is invalid.",
        details: graphReport.issues,
      });
    }
  }

  if ((plan.sideEffects ?? []).some((entry) => entry.category === "database") && !plan.allowSchemaChange) {
    issues.push({
      code: "schema-side-effect",
      message: "Potential database/schema side effects require explicit schema-change approval.",
    });
  }

  return {
    issues,
    valid: issues.length === 0,
  };
}
