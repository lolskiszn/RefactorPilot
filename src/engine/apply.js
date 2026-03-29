import fs from "node:fs/promises";
import path from "node:path";

import { readText } from "../shared/file-system.js";
import { defaultApplyThreshold } from "./confidence.js";
import { runDifferentialTest } from "./differential-tester.js";
import { assessVerificationReadiness, collectVerificationSnapshot } from "./verification.js";

function groupByPath(replacements) {
  const grouped = new Map();
  for (const replacement of replacements) {
    if (!grouped.has(replacement.path)) {
      grouped.set(replacement.path, []);
    }
    grouped.get(replacement.path).push(replacement);
  }
  return grouped;
}

function replaceAtLine(content, replacement) {
  const lines = content.split(/\r?\n/);
  const lineIndex = replacement.line - 1;
  const line = lines[lineIndex];
  if (line === undefined) {
    throw new Error(`Line ${replacement.line} not found in ${replacement.path}`);
  }

  const columnIndex = replacement.column - 1;
  const slice = line.slice(columnIndex, columnIndex + replacement.before.length);
  if (slice !== replacement.before) {
    const firstIndex = line.indexOf(replacement.before, columnIndex);
    if (firstIndex === -1) {
      throw new Error(`Replacement text not found at ${replacement.path}:${replacement.line}:${replacement.column}`);
    }
    lines[lineIndex] = `${line.slice(0, firstIndex)}${replacement.after}${line.slice(firstIndex + replacement.before.length)}`;
    return lines.join("\n");
  }

  lines[lineIndex] = `${line.slice(0, columnIndex)}${replacement.after}${line.slice(columnIndex + replacement.before.length)}`;
  return lines.join("\n");
}

function buildBackupPath(workspaceRoot, filePath, backupRoot) {
  const relative = path.relative(workspaceRoot, filePath);
  return path.join(backupRoot, relative);
}

export async function applyPlan(plan, options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? options.rootDir ?? process.cwd());
  const mode = options.mode ?? "write";
  const threshold = options.threshold ?? defaultApplyThreshold();
  const allowLowConfidence = options.allowLowConfidence ?? false;
  const fsApi = options.fsApi ?? fs;
  const backupRoot = options.backupRoot ?? path.join(workspaceRoot, ".refactorpilot-backups", String(Date.now()));
  const writeFile = options.writeFile ?? fsApi.writeFile.bind(fsApi);
  const readFile = options.readFile ?? readText;

  if (mode === "dry-run") {
    return {
      applied: false,
      backupRoot: null,
      mode,
      plan,
      verification: await collectVerificationSnapshot(workspaceRoot, plan, {
        gitState: options.gitState,
      }),
      status: "dry-run",
      writtenFiles: [],
    };
  }

  const verification = options.verification ?? (await collectVerificationSnapshot(workspaceRoot, plan, {
    gitState: options.gitState,
  }));
  const readiness = assessVerificationReadiness(plan, verification, options.verificationOutcomes ?? {}, {
    mode,
    strict: Boolean(options.strictVerification),
  });

  if (plan.validation && !plan.validation.valid) {
    return {
      applied: false,
      mode,
      plan,
      readiness,
      verification,
      status: "rejected",
      validation: plan.validation,
      writtenFiles: [],
    };
  }

  if (!allowLowConfidence && plan.confidenceScore < threshold) {
    return {
      applied: false,
      mode,
      plan,
      readiness,
      verification,
      status: "rejected",
      validation: {
        issues: [
          {
            code: "low-confidence",
            message: `Confidence ${plan.confidenceScore} is below threshold ${threshold}.`,
          },
        ],
        valid: false,
      },
      writtenFiles: [],
    };
  }

  if (!readiness.canWrite) {
    return {
      applied: false,
      mode,
      plan,
      readiness,
      verification,
      status: "blocked",
      validation: {
        issues: readiness.issues,
        valid: false,
      },
      writtenFiles: [],
    };
  }

  const differential = await runDifferentialTest(plan, {
    mode: options.differentialMode ?? "semantic",
    replayFixturePath: options.replayFixturePath,
    workspaceRoot,
  });

  if (options.requireDifferential !== false && differential.checked && !differential.equivalent) {
    return {
      applied: false,
      differential,
      mode,
      plan,
      readiness,
      verification,
      status: "blocked",
      validation: {
        issues: [
          {
            code: "behavioral-divergence",
            message: "Differential testing detected behavioral divergence.",
          },
        ],
        valid: false,
      },
      writtenFiles: [],
    };
  }

  await fsApi.mkdir(backupRoot, { recursive: true });

  const backups = new Map();
  const writeOrder = [];
  const grouped = groupByPath(plan.replacements ?? []);

  try {
    for (const [relativePath, replacements] of grouped.entries()) {
      const filePath = path.isAbsolute(relativePath) ? relativePath : path.join(workspaceRoot, relativePath);
      const backupPath = buildBackupPath(workspaceRoot, filePath, backupRoot);
      await fsApi.mkdir(path.dirname(backupPath), { recursive: true });

      const original = await readFile(filePath);
      backups.set(filePath, original);
      await writeFile(backupPath, original, "utf8");

      let updated = original;
      const ordered = [...replacements].sort((left, right) => {
        if (left.line !== right.line) {
          return right.line - left.line;
        }
        return right.column - left.column;
      });

      for (const replacement of ordered) {
        updated = replaceAtLine(updated, replacement);
      }

      await writeFile(filePath, updated, "utf8");
      writeOrder.push({
        backupPath,
        path: filePath,
        replacements: ordered.length,
      });
    }

    return {
      applied: true,
      backupRoot,
      differential,
      mode,
      plan,
      readiness,
      verification,
      status: "applied",
      writtenFiles: writeOrder,
    };
  } catch (error) {
    const rollbackErrors = [];
    for (const [filePath, original] of backups.entries()) {
      try {
        await writeFile(filePath, original, "utf8");
      } catch (rollbackError) {
        rollbackErrors.push({
          message: rollbackError.message,
          path: filePath,
        });
      }
    }

    return {
      applied: false,
      backupRoot,
      differential,
      mode,
      plan,
      readiness,
      verification,
      rollbackErrors,
      status: "rolled_back",
      error: {
        message: error.message,
      },
      writtenFiles: writeOrder,
    };
  }
}
