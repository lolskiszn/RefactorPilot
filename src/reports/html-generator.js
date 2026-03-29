function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderList(items) {
  if (!items || items.length === 0) {
    return "<p class=\"muted\">None</p>";
  }
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderReplacements(report) {
  const replacements = report.plan?.replacements ?? [];
  if (replacements.length === 0) {
    return "<p class=\"muted\">No replacement candidates.</p>";
  }

  return replacements
    .slice(0, 20)
    .map((replacement) => `<div class="change">
  <div class="change-title">${escapeHtml(`${replacement.path}:${replacement.line}:${replacement.column}`)}</div>
  <div class="diff"><span class="before">${escapeHtml(replacement.before)}</span> &rarr; <span class="after">${escapeHtml(replacement.after)}</span></div>
</div>`)
    .join("");
}

function renderImpactedFiles(report) {
  const impacted = report.plan?.impactedFiles ?? [];
  if (impacted.length === 0) {
    return "<p class=\"muted\">No impacted files.</p>";
  }

  return impacted
    .map((entry) => {
      const subtitle = `${entry.language} | fields ${(entry.fieldMatches ?? []).length} | usages ${(entry.usageMatches ?? []).length}`;
      return `<div class="change">
  <div class="change-title">${escapeHtml(entry.path)}</div>
  <div class="muted">${escapeHtml(subtitle)}</div>
</div>`;
    })
    .join("");
}

function renderDisambiguation(report) {
  const disambiguation = report.plan?.disambiguation;
  if (!disambiguation?.ambiguous) {
    return "<p class=\"muted\">No ambiguity detected.</p>";
  }

  return (disambiguation.groups ?? [])
    .map((group) => `<div class="change">
  <div class="change-title">${escapeHtml(group.title)}</div>
  ${renderList(group.options.map((option) => `${option.label} (${option.filePath}) - ${option.reasoning}`))}
</div>`)
    .join("");
}

export function renderPreviewHtml(report) {
  if (!report.plan && report.generatedArtifacts) {
    return renderPatternHtml(report);
  }
  const migration = report.migration ?? {};
  const confidence = report.plan?.confidenceScore ?? report.summary?.confidenceScore ?? 0;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(migration.title ?? "RefactorPilot Preview")}</title>
  <style>
    :root {
      --paper: #f7f3eb;
      --ink: #1f2a31;
      --accent: #0f766e;
      --warn: #a16207;
      --danger: #b42318;
      --card: #fffdf8;
      --line: #d7d0c2;
      --mono: "IBM Plex Mono", "Consolas", monospace;
      --serif: "Georgia", "Times New Roman", serif;
    }
    body {
      margin: 0;
      background: radial-gradient(circle at top left, rgba(15,118,110,.12), transparent 24rem), linear-gradient(180deg, #fbfaf7 0%, var(--paper) 100%);
      color: var(--ink);
      font-family: var(--serif);
    }
    main {
      max-width: 1080px;
      margin: 0 auto;
      padding: 32px 20px 60px;
    }
    .hero {
      background: linear-gradient(135deg, #103c3a 0%, #0f766e 55%, #69b8ae 100%);
      color: white;
      border-radius: 24px;
      padding: 28px;
      box-shadow: 0 24px 60px rgba(16,60,58,.18);
    }
    .hero h1 {
      margin: 0 0 8px;
      font-size: 2.4rem;
      line-height: 1.05;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 14px;
      margin: 24px 0 28px;
    }
    .stat-card, .panel {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 18px;
      box-shadow: 0 10px 30px rgba(31,42,49,.06);
    }
    .stat-card {
      padding: 18px;
    }
    .stat-card strong {
      display: block;
      font-family: var(--mono);
      font-size: 1.9rem;
      margin-bottom: 8px;
    }
    .grid {
      display: grid;
      grid-template-columns: 1.3fr .9fr;
      gap: 18px;
    }
    .panel {
      padding: 20px;
      margin-bottom: 18px;
    }
    h2 {
      margin: 0 0 14px;
      font-size: 1.2rem;
    }
    .change {
      padding: 14px 0;
      border-top: 1px solid var(--line);
    }
    .change:first-child {
      border-top: 0;
      padding-top: 0;
    }
    .change-title {
      font-family: var(--mono);
      font-size: .96rem;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .diff {
      font-family: var(--mono);
      background: #f0ece1;
      border-radius: 12px;
      padding: 12px 14px;
      overflow-x: auto;
    }
    .before { color: var(--danger); }
    .after { color: var(--accent); }
    .muted { color: #5f6b71; }
    .confidence {
      font-family: var(--mono);
      color: ${confidence >= 0.8 ? "var(--accent)" : confidence >= 0.5 ? "var(--warn)" : "var(--danger)"};
    }
    ul {
      margin: 0;
      padding-left: 18px;
    }
    @media (max-width: 860px) {
      .grid {
        grid-template-columns: 1fr;
      }
      .hero h1 {
        font-size: 1.9rem;
      }
    }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <h1>${escapeHtml(migration.title ?? "RefactorPilot Preview")}</h1>
      <p>Preview-first migration planning with explainable confidence, impact surface, and guarded apply.</p>
    </section>
    <section class="stats">
      <div class="stat-card"><strong>${escapeHtml(String(report.summary?.impactedFiles ?? 0))}</strong><span>Impacted Files</span></div>
      <div class="stat-card"><strong>${escapeHtml(String(report.summary?.replacementCount ?? 0))}</strong><span>Replacement Candidates</span></div>
      <div class="stat-card"><strong class="confidence">${escapeHtml(String(report.summary?.confidenceScore ?? 0))}</strong><span>Confidence Score</span></div>
      <div class="stat-card"><strong>${escapeHtml(String(migration.impactSurface?.boundaryPaths ?? 0))}</strong><span>Boundary Paths</span></div>
    </section>
    <section class="grid">
      <div>
        <section class="panel">
          <h2>Impact Surface</h2>
          ${renderImpactedFiles(report)}
        </section>
        <section class="panel">
          <h2>Replacement Preview</h2>
          ${renderReplacements(report)}
        </section>
      </div>
      <div>
        <section class="panel">
          <h2>Risk Assessment</h2>
          ${renderList((migration.riskAssessment?.warnings ?? []).map((item) => `Warning: ${item}`))}
          ${renderList((migration.riskAssessment?.blockingIssues ?? []).map((item) => `Blocker: ${item.message}`))}
        </section>
        <section class="panel">
          <h2>Why It Matters</h2>
          ${renderList(migration.whyItMatters ?? [])}
        </section>
        <section class="panel">
          <h2>Ambiguity Review</h2>
          ${renderDisambiguation(report)}
        </section>
      </div>
    </section>
  </main>
</body>
</html>`;
}

function renderPatternHtml(report) {
  const artifacts = report.generatedArtifacts ?? [];
  const outputs = report.changeSet?.outputs ?? [];
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(report.patternTitle ?? report.patternId ?? "RefactorPilot Pattern Preview")}</title>
  <style>
    body { font-family: Georgia, serif; background: #f6f4ee; color: #1f2a31; margin: 0; }
    main { max-width: 1024px; margin: 0 auto; padding: 32px 18px 48px; }
    .hero { background: linear-gradient(135deg, #173d5b 0%, #2c6d94 100%); color: white; border-radius: 20px; padding: 24px; }
    .panel { background: white; border: 1px solid #d6d0c3; border-radius: 16px; padding: 18px; margin-top: 18px; }
    .artifact { border-top: 1px solid #ece7dc; padding: 12px 0; }
    .artifact:first-child { border-top: 0; }
    pre { background: #f2efe8; padding: 12px; border-radius: 12px; overflow-x: auto; }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <h1>${escapeHtml(report.patternTitle ?? report.patternId ?? "Pattern Preview")}</h1>
      <p>Confidence: ${escapeHtml(String(report.confidenceScore ?? 0))} (${escapeHtml(report.confidence ?? "unknown")})</p>
    </section>
    <section class="panel">
      <h2>Generated Artifacts</h2>
      ${artifacts.map((artifact) => `<div class="artifact"><strong>${escapeHtml(artifact.kind)}</strong> ${escapeHtml(artifact.path)}</div>`).join("")}
    </section>
    <section class="panel">
      <h2>Output Preview</h2>
      ${outputs.slice(0, 6).map((output) => `<div class="artifact"><strong>${escapeHtml(output.action)}</strong> ${escapeHtml(output.path)}<pre>${escapeHtml(output.content)}</pre></div>`).join("")}
    </section>
  </main>
</body>
</html>`;
}
