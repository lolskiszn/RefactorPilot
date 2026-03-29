function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function tokenize(value) {
  return String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function buildDomainTokens(fromField) {
  const tokens = tokenize(fromField);
  if (tokens.length > 1) {
    return new Set(tokens.filter((token) => token !== "id" && token !== "name" && token !== "code"));
  }
  return new Set(tokens);
}

function countOverlap(left, right) {
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) {
      overlap += 1;
    }
  }
  return overlap;
}

function fileRoleScore(file) {
  const haystack = `${file.path} ${(file.symbols ?? []).map((symbol) => symbol.name).join(" ")}`.toLowerCase();
  if (/\b(server|handler|service|endpoint|route|controller|client|fetch|request)\b/.test(haystack)) {
    return 1;
  }
  if ((file.endpoints ?? []).length > 0) {
    return 0.9;
  }
  return 0.2;
}

function documentationScore(file, option) {
  const source = String(file.source ?? "");
  if (!source) {
    return 0;
  }
  const lines = source.split(/\r?\n/);
  const pivot = Math.max(0, option.line - 2);
  const window = lines.slice(Math.max(0, pivot - 2), pivot + 1).join("\n").toLowerCase();
  return /\/\/|#|"""|'''/.test(window) ? 1 : 0;
}

function usageFrequencyScore(option, maxCount) {
  if (maxCount <= 0) {
    return 0;
  }
  return Number((option.referenceCount / maxCount).toFixed(3));
}

function typeConsistencyScore(optionTokens, domainTokens, counterpartTokens) {
  const domainOverlap = domainTokens.size > 0 ? countOverlap(optionTokens, domainTokens) / domainTokens.size : 0;
  const counterpartOverlap =
    counterpartTokens.size > 0 ? countOverlap(optionTokens, counterpartTokens) / counterpartTokens.size : 0;
  return Number(Math.max(domainOverlap, counterpartOverlap).toFixed(3));
}

function namingConventionScore(optionTokens, domainTokens) {
  if (domainTokens.size === 0) {
    return 0;
  }
  return Number((countOverlap(optionTokens, domainTokens) / domainTokens.size).toFixed(3));
}

function collectCounterpartTokens(plan, groupKind) {
  const entries =
    groupKind === "producer"
      ? (plan.impactedFiles ?? []).filter((entry) => (entry.usageMatches?.length ?? 0) > 0)
      : (plan.impactedFiles ?? []).filter((entry) => (entry.fieldMatches?.length ?? 0) > 0);
  const tokens = new Set();

  for (const entry of entries) {
    tokenize(entry.path).forEach((token) => tokens.add(token));
    for (const usage of entry.usageMatches ?? []) {
      tokenize(usage.name).forEach((token) => tokens.add(token));
    }
    for (const field of entry.fieldMatches ?? []) {
      tokenize(field.parent ?? field.name).forEach((token) => tokens.add(token));
    }
  }

  return tokens;
}

function buildOptionRecords(plan, scanResult, group) {
  const records = [];
  for (const option of group.options) {
    const entry = (plan.impactedFiles ?? []).find((item) => item.path === option.filePath);
    const file = (scanResult.files ?? []).find((item) => item.path === option.filePath);
    if (!entry || !file) {
      continue;
    }

    const referenceCount = group.kind === "producer"
      ? (entry.fieldMatches?.length ?? 0) + (entry.explanationPaths?.length ?? 0)
      : (entry.usageMatches?.length ?? 0) + (entry.explanationPaths?.length ?? 0);
    const label = group.kind === "producer"
      ? entry.fieldMatches?.[0]?.parent ?? option.label
      : option.label;
    records.push({
      entry,
      file,
      label,
      line: group.kind === "producer"
        ? entry.fieldMatches?.[0]?.line ?? 1
        : entry.usageMatches?.[0]?.line ?? 1,
      option,
      optionTokens: new Set([
        ...tokenize(label),
        ...tokenize(option.filePath),
        ...(file.symbols ?? []).flatMap((symbol) => tokenize(symbol.name)),
      ]),
      referenceCount,
    });
  }
  return records;
}

/**
 * Rank ambiguous candidates using lightweight property-graph-style signals:
 * - API boundary proximity
 * - local/cross-language usage frequency
 * - type/name consistency with the other side of the boundary
 * - naming convention overlap with the requested field
 * - nearby documentation/comments
 *
 * The weights mirror the product requirement and intentionally fail safe when
 * the top choice is not clearly stronger than the runner-up.
 */
export function rankAmbiguities(plan, scanResult) {
  const groups = plan.disambiguation?.groups ?? [];
  const domainTokens = buildDomainTokens(plan.fromField);
  const rankedGroups = [];

  for (const group of groups) {
    const records = buildOptionRecords(plan, scanResult, group);
    const maxCount = Math.max(1, ...records.map((record) => record.referenceCount));
    const counterpartTokens = collectCounterpartTokens(plan, group.kind);

    const ranked = records
      .map((record) => {
        const signals = {
          api_boundary_proximity: fileRoleScore(record.file),
          usage_frequency: usageFrequencyScore(record, maxCount),
          type_consistency_across_languages: typeConsistencyScore(record.optionTokens, domainTokens, counterpartTokens),
          naming_convention_match: namingConventionScore(record.optionTokens, domainTokens),
          documentation_presence: documentationScore(record.file, record),
        };
        const score = Number((
          signals.api_boundary_proximity * 0.35 +
          signals.usage_frequency * 0.25 +
          signals.type_consistency_across_languages * 0.2 +
          signals.naming_convention_match * 0.15 +
          signals.documentation_presence * 0.05
        ).toFixed(3));

        return {
          ...record.option,
          score,
          reasoning: [
            `api_boundary_proximity=${signals.api_boundary_proximity}`,
            `usage_frequency=${signals.usage_frequency}`,
            `type_consistency=${signals.type_consistency_across_languages}`,
            `naming_match=${signals.naming_convention_match}`,
            `documentation=${signals.documentation_presence}`,
          ],
          signals,
        };
      })
      .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label));

    const top = ranked[0] ?? null;
    const runnerUp = ranked[1] ?? null;
    const margin = Number(((top?.score ?? 0) - (runnerUp?.score ?? 0)).toFixed(3));
    const autoResolvable = Boolean(top) && top.score >= 0.8 && margin >= 0.12;

    rankedGroups.push({
      autoResolvable,
      kind: group.kind,
      margin,
      recommendedOptionId: top?.id ?? null,
      rankedOptions: ranked,
      resolutionConfidence: top?.score ?? 0,
      title: group.title,
    });
  }

  return {
    autoResolvable: rankedGroups.length > 0 && rankedGroups.every((group) => group.autoResolvable),
    groups: rankedGroups,
  };
}
