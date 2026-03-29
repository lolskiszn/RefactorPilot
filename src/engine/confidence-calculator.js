export function applyAmbiguityConfidenceAdjustment(baseScore, resolution = {}) {
  if (resolution.mode === "user") {
    return Number(baseScore.toFixed(3));
  }

  if (resolution.mode === "auto") {
    return Number((baseScore * Math.min(1, resolution.resolutionConfidence ?? 0.9)).toFixed(3));
  }

  if (resolution.mode === "unresolved") {
    return Math.min(0.49, Number(baseScore.toFixed(3)));
  }

  return Number(baseScore.toFixed(3));
}
