const BASE_SCORE = 0.28;

export function scorePlanConfidence(profile) {
  const reasons = [];
  let score = BASE_SCORE;

  if (profile.hasExactProducerMatch) {
    score += 0.32;
    reasons.push("Exact producer field match");
  }

  if (profile.hasExactConsumerMatch) {
    score += 0.22;
    reasons.push("Exact consumer access match");
  }

  if (profile.hasUniqueBoundaryPath) {
    score += 0.18;
    reasons.push("Unique boundary path");
  }

  if (profile.duplicateMatches > 0) {
    score -= Math.min(0.7, profile.duplicateMatches * 0.3);
    reasons.push("Duplicate matches detected");
  }

  if (profile.dynamicAccessCount > 0) {
    score -= Math.min(0.22, profile.dynamicAccessCount * 0.11);
    reasons.push("Dynamic access detected");
  }

  if (profile.unresolvedLinks > 0) {
    score -= Math.min(0.3, profile.unresolvedLinks * 0.1);
    reasons.push("Unresolved boundary links");
  }

  score = Math.max(0, Math.min(1, Number(score.toFixed(3))));

  return {
    reasons,
    score,
    level: confidenceLevel(score),
  };
}

export function confidenceLevel(score) {
  if (score >= 0.8) {
    return "high";
  }

  if (score >= 0.55) {
    return "medium";
  }

  return "low";
}

export function defaultApplyThreshold() {
  return 0.72;
}
