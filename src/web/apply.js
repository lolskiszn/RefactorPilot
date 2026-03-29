import fs from "node:fs/promises";
import path from "node:path";

import { previewFieldRename } from "../orchestration/index.js";

export function validateFieldRenamePlan(plan) {
  const issues = [];

  if (!plan.impactedFiles.length) {
    issues.push({
      kind: "no-impacts",
      message: "No impacted files were detected.",
    });
  }

  if (plan.confidence === "low") {
    issues.push({
      kind: "low-confidence",
      message: "Plan confidence is too low to apply safely.",
    });
  }

  const overlaps = detectOverlaps(plan.replacements);
  for (const overlap of overlaps) {
    issues.push(overlap);
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

export async function applyFieldRename(workspace, fromField, toField) {
  const report = await previewFieldRename(workspace, fromField, toField);
  const validation = await validateFieldRenamePlan(report.plan);

  if (!validation.valid) {
    return {
      ok: false,
      status: "blocked",
      validation,
      report,
    };
  }

  const backupRoot = path.join(report.workspace, ".refactorpilot-backups", timestampToken());
  const changedFiles = [];
  const touchedFiles = groupReplacementsByFile(report.plan.replacements);

  try {
    for (const [relativePath, replacements] of touchedFiles.entries()) {
      const absolutePath = path.join(report.workspace, relativePath);
      const original = await fs.readFile(absolutePath, "utf8");
      const backupPath = path.join(backupRoot, relativePath);
      await fs.mkdir(path.dirname(backupPath), { recursive: true });
      await fs.writeFile(backupPath, original, "utf8");

      const updated = applyReplacementsToText(original, replacements);
      if (updated !== original) {
        await fs.writeFile(absolutePath, updated, "utf8");
        changedFiles.push(relativePath);
      }
    }
  } catch (error) {
    await restoreBackups(report.workspace, backupRoot, touchedFiles.keys());
    return {
      ok: false,
      status: "rolled_back",
      error: error.message,
      validation,
      report,
      backupRoot,
    };
  }

  return {
    ok: true,
    status: "applied",
    backupRoot,
    changedFiles,
    validation,
    report,
  };
}

function groupReplacementsByFile(replacements) {
  const grouped = new Map();
  for (const replacement of replacements) {
    if (!grouped.has(replacement.path)) {
      grouped.set(replacement.path, []);
    }
    grouped.get(replacement.path).push(replacement);
  }

  return grouped;
}

function applyReplacementsToText(source, replacements) {
  const lines = source.split(/\r?\n/);
  const sorted = [...replacements].sort((a, b) => {
    if (a.line !== b.line) {
      return b.line - a.line;
    }
    return b.column - a.column;
  });

  for (const replacement of sorted) {
    const lineIndex = replacement.line - 1;
    const line = lines[lineIndex];
    if (typeof line !== "string") {
      continue;
    }

    const start = Math.max(0, replacement.column - 1);
    const before = replacement.before;
    const current = line.slice(start, start + before.length);
    if (current !== before) {
      continue;
    }
    lines[lineIndex] = `${line.slice(0, start)}${replacement.after}${line.slice(start + before.length)}`;
  }

  return lines.join("\n");
}

async function restoreBackups(workspace, backupRoot, filePaths) {
  for (const relativePath of filePaths) {
    const backupPath = path.join(backupRoot, relativePath);
    const absolutePath = path.join(workspace, relativePath);
    try {
      const backup = await fs.readFile(backupPath, "utf8");
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, backup, "utf8");
    } catch {
      // Best-effort rollback.
    }
  }
}

function detectOverlaps(replacements) {
  const issues = [];
  const byFileAndLine = new Map();

  for (const replacement of replacements) {
    const key = `${replacement.path}:${replacement.line}`;
    if (!byFileAndLine.has(key)) {
      byFileAndLine.set(key, []);
    }
    byFileAndLine.get(key).push(replacement);
  }

  for (const [key, items] of byFileAndLine.entries()) {
    const sorted = items
      .map((item) => ({
        ...item,
        start: item.column,
        end: item.column + item.before.length - 1,
      }))
      .sort((a, b) => a.start - b.start);

    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      if (current.start <= previous.end) {
        issues.push({
          kind: "overlap",
          message: `Overlapping replacement candidates on ${key}`,
        });
        break;
      }
    }
  }

  return issues;
}

function timestampToken() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
