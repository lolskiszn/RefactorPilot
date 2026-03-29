export function buildPreviewCommentFromAnalysis(analysis) {
  return analysis.commentBody;
}

export function buildCheckRunPayloadFromAnalysis(analysis, { pullRequest = null } = {}) {
  return {
    ...analysis.checkRun,
    details_url: analysis.checkRun.details_url ?? pullRequest?.html_url ?? null,
  };
}
