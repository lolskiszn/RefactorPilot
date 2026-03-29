import { createPatternPlugin } from "../../../../packages/language-sdk/src/index.js";

function detectDjangoSignals(source) {
  const warnings = [];
  const routes = [];
  const views = [];

  if (/from\s+django\./.test(source)) {
    warnings.push("Django imports detected.");
  }
  if (/path\(|re_path\(|url\(/.test(source)) {
    routes.push("django-urlconf");
  }
  if (/APIView|ViewSet|django\.views/.test(source)) {
    views.push("django-view");
  }

  return { routes, views, warnings };
}

export const manifest = {
  description: "Preview Django-to-FastAPI migrations for Python web projects.",
  id: "pattern:django-to-fastapi",
  language: "python",
  name: "Django to FastAPI",
  type: "pattern",
  version: "1.0.0",
};

export function preview(project = {}) {
  const files = Array.isArray(project.files) ? project.files : [];
  const analysis = files.map((file) => {
    const source = String(file.source ?? "");
    const signal = detectDjangoSignals(source);
    return {
      file: file.path ?? null,
      language: file.language ?? "python",
      ...signal,
    };
  });

  const matchedFiles = analysis.filter((entry) => entry.routes.length > 0 || entry.views.length > 0);

  return {
    confidence: matchedFiles.length > 0 ? "medium" : "low",
    confidenceScore: matchedFiles.length > 0 ? 0.74 : 0.31,
    generatedArtifacts: [
      {
        kind: "md",
        path: "preview/django-to-fastapi/notes.md",
        preview: "# Django to FastAPI Preview\n\nThis plugin is a local example package.",
      },
    ],
    manifest,
    patternId: manifest.id,
    summary: {
      matchedFiles: matchedFiles.length,
      totalFiles: files.length,
    },
    warnings: [
      ...new Set(matchedFiles.flatMap((entry) => entry.warnings)),
    ],
  };
}

export default createPatternPlugin(manifest, {
  preview,
});
