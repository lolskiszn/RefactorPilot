import path from "node:path";

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function basenameWithoutExtension(filePath) {
  return path.basename(filePath, path.extname(filePath));
}

function buildProducerOptions(plan) {
  return uniqueBy(
    (plan.impactedFiles ?? [])
      .filter((entry) => (entry.fieldMatches?.length ?? 0) > 0)
      .map((entry) => {
        const parent = entry.fieldMatches.find((field) => field.parent)?.parent ?? basenameWithoutExtension(entry.path);
        const score = Number(
          Math.min(
            0.95,
            0.45 + (entry.explanationPaths?.length ?? 0) * 0.15 + (entry.fieldMatches?.length ?? 0) * 0.08,
          ).toFixed(2),
        );
        return {
          confidence: score,
          filePath: entry.path,
          id: `producer:${normalize(parent)}`,
          kind: "producer",
          label: parent,
          reasoning: entry.explanationPaths?.length
            ? `Linked to ${entry.explanationPaths.length} boundary path(s) from ${entry.path}.`
            : `Detected as a producer candidate in ${entry.path}.`,
          recommended: false,
        };
      }),
    (item) => item.id,
  );
}

function buildConsumerOptions(plan) {
  return uniqueBy(
    (plan.impactedFiles ?? [])
      .filter((entry) => (entry.usageMatches?.length ?? 0) > 0)
      .map((entry) => {
        const label = basenameWithoutExtension(entry.path);
        const score = Number(
          Math.min(
            0.88,
            0.4 + (entry.explanationPaths?.length ?? 0) * 0.12 + (entry.usageMatches?.length ?? 0) * 0.08,
          ).toFixed(2),
        );
        return {
          confidence: score,
          filePath: entry.path,
          id: `consumer:${normalize(label)}`,
          kind: "consumer",
          label,
          reasoning: entry.explanationPaths?.length
            ? `Consumes the contract through ${entry.explanationPaths.length} inferred path(s).`
            : `Detected as a consumer candidate in ${entry.path}.`,
          recommended: false,
        };
      }),
    (item) => item.id,
  );
}

function finalizeGroup(kind, title, options) {
  if (options.length <= 1) {
    return null;
  }

  const ranked = [...options].sort((left, right) => right.confidence - left.confidence || left.label.localeCompare(right.label));
  if (ranked[0]) {
    ranked[0].recommended = true;
  }

  return {
    kind,
    options: ranked,
    recommendedOptionId: ranked[0]?.id ?? null,
    title,
  };
}

export function buildDisambiguation(plan, options = {}) {
  const producerGroup = finalizeGroup("producer", "Producer context", buildProducerOptions(plan));
  const consumerGroup = finalizeGroup("consumer", "Consumer context", buildConsumerOptions(plan));
  const groups = [producerGroup, consumerGroup].filter(Boolean);
  const targetContext = options.targetContext ?? null;
  const includeAll = Boolean(options.includeAllAmbiguous);

  return {
    ambiguous: groups.length > 0,
    groups,
    includeAll,
    recommendation: groups.map((group) => group.recommendedOptionId).filter(Boolean),
    strategy: includeAll
      ? "migrate_all_with_review"
      : targetContext
        ? "targeted_context"
        : groups.length > 0
          ? "context_selection_required"
          : "resolved",
    targetContext,
  };
}

export function applyDisambiguationSelection(plan, options = {}) {
  const disambiguation = buildDisambiguation(plan, options);
  const targets = new Set(
    [options.targetContext, ...(options.selectedContexts ?? [])]
      .filter(Boolean)
      .map((value) => normalize(value)),
  );
  const selected = [];

  if (!disambiguation.ambiguous || (targets.size === 0 && !disambiguation.includeAll)) {
    return {
      ...plan,
      disambiguation,
    };
  }

  for (const group of disambiguation.groups) {
    const match = group.options.find((option) => {
      return (
        targets.has(normalize(option.id)) ||
        targets.has(normalize(option.label)) ||
        targets.has(normalize(option.filePath))
      );
    });
    if (match) {
      selected.push(match);
    }
  }

  const selectedProducerPaths = new Set(selected.filter((entry) => entry.kind === "producer").map((entry) => entry.filePath));
  const selectedConsumerPaths = new Set(selected.filter((entry) => entry.kind === "consumer").map((entry) => entry.filePath));

  let impactedFiles = [...(plan.impactedFiles ?? [])];
  if (!disambiguation.includeAll && (selectedProducerPaths.size > 0 || selectedConsumerPaths.size > 0)) {
    impactedFiles = impactedFiles.filter((entry) => {
      const hasProducerMatches = (entry.fieldMatches?.length ?? 0) > 0;
      const hasConsumerMatches = (entry.usageMatches?.length ?? 0) > 0;

      if (hasProducerMatches && selectedProducerPaths.size > 0 && !selectedProducerPaths.has(entry.path)) {
        return false;
      }
      if (hasConsumerMatches && selectedConsumerPaths.size > 0 && !selectedConsumerPaths.has(entry.path)) {
        return false;
      }
      return true;
    });
  }

  const impactedPaths = new Set(impactedFiles.map((entry) => entry.path));
  const replacements = (plan.replacements ?? []).filter((replacement) => impactedPaths.has(replacement.path));
  const warnings = [...(plan.warnings ?? [])];

  if (selected.length > 0) {
    warnings.push(`Disambiguated preview with context: ${selected.map((entry) => entry.label).join(", ")}.`);
  } else if (disambiguation.includeAll) {
    warnings.push("Ambiguous matches were kept in the preview for manual review.");
  }

  const unresolvedProducerDuplicates =
    selectedProducerPaths.size > 0 || (disambiguation.includeAll && disambiguation.groups.some((group) => group.kind === "producer"))
      ? 0
      : Math.max(0, (disambiguation.groups.find((group) => group.kind === "producer")?.options.length ?? 1) - 1);
  const unresolvedConsumerDuplicates =
    selectedConsumerPaths.size > 0 || (disambiguation.includeAll && disambiguation.groups.some((group) => group.kind === "consumer"))
      ? 0
      : Math.max(0, (disambiguation.groups.find((group) => group.kind === "consumer")?.options.length ?? 1) - 1);
  const ambiguousMatches = unresolvedProducerDuplicates + unresolvedConsumerDuplicates;

  return {
    ...plan,
    disambiguation: {
      ...disambiguation,
      groups: disambiguation.groups.map((group) => ({
        ...group,
        selectedOptionId:
          selected.find((entry) => entry.kind === group.kind)?.id ??
          (disambiguation.includeAll ? "all" : null),
      })),
    },
    impactedFiles,
    replacements,
    summary: {
      ...(plan.summary ?? {}),
      impactedFileCount: impactedFiles.length,
      replacementCount: replacements.length,
    },
    impactSummary: {
      ...(plan.impactSummary ?? {}),
      ambiguousMatches,
      duplicateMatches: ambiguousMatches,
    },
    warnings: uniqueBy(warnings, (item) => item),
  };
}
