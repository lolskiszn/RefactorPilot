import fs from "node:fs/promises";
import path from "node:path";

import { detectMigrationPattern } from "./patterns.js";
import { inspectWorkspaceEnvironment } from "./verify.js";

function toSet(items) {
  return new Set(items);
}

function unique(values) {
  return [...new Set(values)];
}

async function safeReadDir(dirPath) {
  try {
    return await fs.readdir(dirPath);
  } catch {
    return [];
  }
}

function inferLanguages(plan) {
  const files = [
    ...(plan.impactedFiles ?? []).map((entry) => entry.path),
    ...(plan.replacements ?? []).map((replacement) => replacement.path),
  ];

  const languages = new Set();
  for (const filePath of files) {
    if (filePath.endsWith(".go")) {
      languages.add("go");
    }
    if (filePath.endsWith(".py")) {
      languages.add("python");
    }
    if (filePath.endsWith(".js") || filePath.endsWith(".mjs") || filePath.endsWith(".cjs")) {
      languages.add("node");
    }
  }

  return languages;
}

function detectHttpSignals(plan) {
  const paths = [
    ...(plan.impactedFiles ?? []).map((entry) => entry.path),
    ...(plan.replacements ?? []).map((replacement) => replacement.path),
  ];
  const joined = paths.join(" ").toLowerCase();
  return {
    client: joined.includes("client.py") || joined.includes("requests"),
    server: joined.includes("server.go") || joined.includes("handler"),
  };
}

function detectObservabilitySignals(plan) {
  const joined = JSON.stringify(plan ?? {}).toLowerCase();
  return {
    logs: joined.includes("log"),
    traces: joined.includes("trace"),
  };
}

function buildHook({ id, kind, command, reason, required }) {
  return {
    command,
    id,
    kind,
    reason,
    required,
  };
}

export async function collectVerificationSnapshot(workspaceRoot, plan, options = {}) {
  const rootEntries = toSet(await safeReadDir(workspaceRoot));
  const environment = options.environment ?? (await inspectWorkspaceEnvironment(workspaceRoot));
  const gitState =
    options.gitState ??
    environment.git ??
    (rootEntries.has(".git") ? { detected: true, state: "unknown" } : { detected: false, state: "absent" });
  const languages = inferLanguages(plan);
  const manifests = environment.manifests ?? {
    goMod: rootEntries.has("go.mod"),
    packageJson: rootEntries.has("package.json"),
    pyprojectToml: rootEntries.has("pyproject.toml"),
    setupPy: rootEntries.has("setup.py"),
  };
  const http = detectHttpSignals(plan);
  const observability = detectObservabilitySignals(plan);
  const hooks = buildVerificationHooks({
    environment,
    gitState,
    languages,
    manifests,
    http,
    observability,
  });

  return {
    environment,
    git: gitState,
    hooks,
    http,
    languages,
    manifests,
    observability,
  };
}

export function buildVerificationHooks(context) {
  const hooks = [];
  const buildCommands = context.environment?.build ?? [];
  const testCommands = context.environment?.tests ?? [];

  if (context.gitState?.detected) {
    hooks.push(
      buildHook({
        command: ["git", "status", "--porcelain"],
        id: "git-clean",
        kind: "git",
        reason: "Write mode should avoid dirty working trees.",
        required: true,
      }),
    );
  }

  if (context.languages?.has("go") || context.manifests?.goMod) {
    hooks.push(
      buildHook({
        command: ["go", "test", "./..."],
        id: "go-test",
        kind: "build",
        reason: "Go changes should pass the Go test suite when Go files or modules are present.",
        required: true,
      }),
    );
    hooks.push(
      buildHook({
        command: ["go", "build", "./..."],
        id: "go-build",
        kind: "build",
        reason: "Go workspaces should remain buildable after a write.",
        required: true,
      }),
    );
  }

  if (context.languages?.has("python") || context.manifests?.pyprojectToml || context.manifests?.setupPy) {
    hooks.push(
      buildHook({
        command: ["python", "-m", "py_compile"],
        id: "python-syntax",
        kind: "build",
        reason: "Python sources should remain syntax-valid after a write.",
        required: true,
      }),
    );
    hooks.push(
      buildHook({
        command: ["python", "-m", "pytest"],
        id: "python-test",
        kind: "test",
        reason: "Python workspaces should keep their test suite green when available.",
        required: true,
      }),
    );
  }

  if (context.languages?.has("node") || context.manifests?.packageJson) {
    hooks.push(
      buildHook({
        command: ["npm", "run", "build"],
        id: "node-build",
        kind: "build",
        reason: "Node workspaces should keep the local build entrypoint green when present.",
        required: false,
      }),
    );
    hooks.push(
      buildHook({
        command: ["npm", "test"],
        id: "node-test",
        kind: "test",
        reason: "Node workspaces should keep the local test entrypoint green.",
        required: false,
      }),
    );
  }

  if (buildCommands.length > 0 || testCommands.length > 0) {
    hooks.push(
      buildHook({
        command: buildCommands[0]?.command ? buildCommands[0].command.split(/\s+/) : ["echo", "no-build-commands"],
        id: "workspace-build",
        kind: "build",
        reason: "Workspace discovery surfaced build commands for local verification.",
        required: false,
      }),
    );
    hooks.push(
      buildHook({
        command: testCommands[0]?.command ? testCommands[0].command.split(/\s+/) : ["echo", "no-test-commands"],
        id: "workspace-test",
        kind: "test",
        reason: "Workspace discovery surfaced test commands for local verification.",
        required: false,
      }),
    );
  }

  return hooks;
}

export function assessVerificationReadiness(plan, snapshot, outcomes = {}, options = {}) {
  const issues = [];
  const warnings = [];
  const hookStatuses = [];
  const strict = Boolean(options.strict);

  if (plan.validation && !plan.validation.valid) {
    issues.push({
      code: "plan-invalid",
      message: "Plan validation failed before verification hooks were evaluated.",
    });
  }

  if (options.mode === "write" && plan.migrationPattern?.previewOnly) {
    issues.push({
      code: "preview-only-pattern",
      message: `Migration pattern ${plan.migrationPattern.id} is preview-only and cannot be applied directly.`,
    });
  }

  if (snapshot?.git?.detected && snapshot.git.state === "dirty") {
    issues.push({
      code: "dirty-git-tree",
      message: "Working tree must be clean for a write operation.",
    });
  }

  for (const hook of snapshot?.hooks ?? []) {
    const status = normalizeOutcomeStatus(outcomes[hook.id]);
    hookStatuses.push({
      ...hook,
      status,
    });

    if (status === "failed") {
      issues.push({
        code: hook.id,
        message: `${hook.id} failed.`,
      });
      continue;
    }

    if (status === "unknown") {
      warnings.push(`${hook.id} was not executed; using preview-only safety.`);
      if (strict && hook.required) {
        issues.push({
          code: `${hook.id}-not-run`,
          message: `${hook.id} must run before write mode.`,
        });
      }
    }
  }

  return {
    canWrite: issues.length === 0,
    hookStatuses,
    issues,
    warnings: unique(warnings),
  };
}

function normalizeOutcomeStatus(outcome) {
  if (outcome === true || outcome === "passed" || outcome === "success") {
    return "passed";
  }

  if (outcome === false || outcome === "failed" || outcome === "error") {
    return "failed";
  }

  if (outcome === "skipped") {
    return "skipped";
  }

  return "unknown";
}

export function summarizeMigrationPattern(plan, snapshot) {
  return detectMigrationPattern(plan, snapshot);
}
