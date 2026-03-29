function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isIgnoredPath(filename, ignoredPatterns = []) {
  const patterns = Array.isArray(ignoredPatterns) ? ignoredPatterns : [];
  const normalized = normalize(filename).replace(/\\/g, "/");
  return patterns.some((pattern) => {
    const escaped = String(pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*\\\*/g, ".*").replace(/\\\*/g, "[^/]*");
    return new RegExp(`^${escaped}$`, "i").test(normalized);
  });
}

function detectSignal(text) {
  const patterns = [
    {
      id: "rest-to-grpc",
      match: /http\.HandleFunc|requests\.(get|post|put|patch|delete)|httpx\.(get|post|put|patch|delete)/,
      reason: "Transport boundary change detected.",
    },
    {
      id: "api-contract-rename",
      match: /json:"[A-Za-z0-9_]+"/,
      reason: "Cross-language contract field pattern detected.",
    },
    {
      id: "dynamic-access",
      match: /payload\[[A-Za-z_][A-Za-z0-9_]*\]|getattr\(|locals\(\)\[|field_name|key_name/,
      reason: "Dynamic access pattern detected.",
    },
  ];

  return patterns.filter((pattern) => pattern.match.test(text));
}

export function analyzePullRequest({ config, files = [], pullRequest = {} }) {
  const ignoredPaths = config?.ignoredPaths ?? [];
  const candidates = [];

  for (const file of files) {
    if (!file?.filename || isIgnoredPath(file.filename, ignoredPaths)) {
      continue;
    }

    const text = [file.filename, file.patch ?? "", file.status ?? "", file.previous_filename ?? ""].join("\n");
    const signals = detectSignal(text);
    if (signals.length === 0) {
      continue;
    }

    candidates.push({
      filename: file.filename,
      signals,
      summary: buildFileSummary(file, signals),
    });
  }

  const inferredPatterns = [...new Set(candidates.flatMap((entry) => entry.signals.map((signal) => signal.id)))];
  const requiresPreview = inferredPatterns.length > 0;
  const previewUrl = buildPreviewUrl(config, pullRequest, inferredPatterns);
  const commentBody = buildPullRequestComment({
    candidates,
    config,
    previewUrl,
    pullRequest,
  });
  const checkRun = buildCheckRun({
    candidates,
    inferredPatterns,
    pullRequest,
    requiresPreview,
  });

  return {
    candidates,
    checkRun,
    commentBody,
    inferredPatterns,
    previewUrl,
    readOnly: true,
    requiresPreview,
  };
}

export function buildPullRequestComment({ candidates, config, previewUrl, pullRequest }) {
  const lines = [];
  lines.push("RefactorPilot review summary");
  lines.push("");
  if (candidates.length === 0) {
    lines.push("No migration signals detected in the changed files.");
    return lines.join("\n");
  }

  lines.push(`Detected ${candidates.length} migration-related file(s).`);
  lines.push("");
  for (const candidate of candidates.slice(0, 10)) {
    lines.push(`- ${candidate.filename}: ${candidate.summary}`);
  }

  if (candidates.some((candidate) => candidate.signals.some((signal) => signal.id === "api-contract-rename"))) {
    lines.push("");
    lines.push("Detected field change. Preview migration?");
  }

  if (previewUrl) {
    lines.push("");
    lines.push(`[View Migration Preview](${previewUrl})`);
  }

  if (config?.review?.includePreviewCommand !== false) {
    const repoName = pullRequest?.base?.repo?.name ?? "workspace";
    lines.push("");
    lines.push(`Preview locally with: \`refactor-pilot preview ${repoName} --field <old> --to <new>\``);
  }

  if (config?.review?.includeDoctorCommand !== false) {
    lines.push("Run `refactor-pilot doctor` to inspect readiness and trust signals.");
  }

  return lines.join("\n");
}

function buildPreviewUrl(config, pullRequest, inferredPatterns) {
  const baseUrl = config?.previewBaseUrl;
  if (!baseUrl || inferredPatterns.length === 0) {
    return null;
  }

  const url = new URL(baseUrl);
  url.searchParams.set("patterns", inferredPatterns.join(","));
  if (pullRequest?.html_url) {
    url.searchParams.set("pr", pullRequest.html_url);
  }
  return url.toString();
}

export function buildCheckRun({ candidates, inferredPatterns, pullRequest, requiresPreview }) {
  const title = "refactorpilot/impact-analysis";
  const summaryLines = [];
  summaryLines.push(`Patterns: ${inferredPatterns.length ? inferredPatterns.join(", ") : "none"}`);
  summaryLines.push(`Files analyzed: ${candidates.length}`);
  summaryLines.push(`Read-only mode: yes`);

  const conclusion = requiresPreview ? "neutral" : "success";

  return {
    name: title,
    output: {
      summary: summaryLines.join("\n"),
      title: "RefactorPilot impact analysis",
      text: candidates.map((entry) => `${entry.filename}: ${entry.summary}`).join("\n"),
    },
    conclusion,
    details_url: pullRequest?.html_url ?? null,
    status: "completed",
  };
}

function buildFileSummary(file, signals) {
  const signalText = signals.map((signal) => signal.reason).join(" ");
  const parts = [];
  if (file.status) {
    parts.push(file.status);
  }
  parts.push(signalText);
  return parts.join(" ").trim();
}
