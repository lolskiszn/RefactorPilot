import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  assessVerificationReadiness,
  collectVerificationSnapshot,
  detectMigrationPattern,
  summarizeMigrationPattern,
} from "../../src/engine/index.js";

export async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "refactorpilot-verification-"));
  await fs.writeFile(
    path.join(root, "server.go"),
    `package main

type UserPayload struct {
    UserID string \`json:"user_id"\`
}
`,
    "utf8",
  );
  await fs.writeFile(
    path.join(root, "client.py"),
    `def fetch(payload):
    return payload["user_id"]
`,
    "utf8",
  );
  await fs.writeFile(path.join(root, "go.mod"), "module example.com/demo\n", "utf8");
  await fs.writeFile(path.join(root, "pyproject.toml"), "[project]\nname = \"demo\"\n", "utf8");
  await fs.writeFile(path.join(root, "package.json"), "{\n  \"name\": \"demo\"\n}\n", "utf8");

  const plan = {
    confidenceScore: 1,
    impactedFiles: [
      { path: "server.go" },
      { path: "client.py" },
    ],
    migrationPattern: {
      id: "api-contract-rename",
      previewOnly: false,
      supported: true,
    },
    replacements: [
      { path: "server.go", line: 4, column: 26, before: "user_id", after: "account_id" },
      { path: "client.py", line: 2, column: 21, before: "user_id", after: "account_id" },
    ],
    summary: {
      impactedFileCount: 2,
      replacementCount: 2,
    },
    transformation: "field_rename",
    validation: {
      valid: true,
    },
  };

  const snapshot = await collectVerificationSnapshot(root, plan, {
    gitState: {
      detected: true,
      state: "clean",
    },
  });

  assert.ok(snapshot.hooks.some((hook) => hook.id === "git-clean"));
  assert.ok(snapshot.hooks.some((hook) => hook.id === "go-test"));
  assert.ok(snapshot.hooks.some((hook) => hook.id === "go-build"));
  assert.ok(snapshot.hooks.some((hook) => hook.id === "python-syntax"));
  assert.ok(snapshot.hooks.some((hook) => hook.id === "python-test"));
  assert.ok(snapshot.hooks.some((hook) => hook.id === "node-test"));
  assert.ok(snapshot.hooks.some((hook) => hook.id === "node-build"));
  assert.ok(snapshot.hooks.some((hook) => hook.id === "workspace-build"));
  assert.ok(snapshot.hooks.some((hook) => hook.id === "workspace-test"));
  assert.equal(snapshot.environment.manifests.packageJson, true);
  assert.equal(snapshot.environment.git.available, false);

  const pattern = detectMigrationPattern(plan, {
    http: snapshot.http,
    languages: snapshot.languages,
    observability: snapshot.observability,
  });
  assert.equal(pattern.id, "api-contract-rename");
  assert.equal(pattern.supported, true);

  const readinessBlocked = assessVerificationReadiness(
    {
      ...plan,
      migrationPattern: {
        id: "rest-to-grpc-preview",
        previewOnly: true,
        supported: false,
      },
    },
    snapshot,
    {
      "git-clean": true,
      "go-build": true,
      "go-test": true,
      "node-test": true,
      "node-build": true,
      "python-syntax": true,
      "python-test": true,
      "workspace-build": true,
      "workspace-test": true,
    },
    {
      mode: "write",
    },
  );
  assert.equal(readinessBlocked.canWrite, false);
  assert.ok(readinessBlocked.issues.some((issue) => issue.code === "preview-only-pattern"));

  const readinessAllowed = assessVerificationReadiness(plan, snapshot, {
      "git-clean": true,
      "go-build": true,
      "go-test": true,
      "node-test": true,
      "node-build": true,
      "python-syntax": true,
      "python-test": true,
      "workspace-build": true,
      "workspace-test": true,
  }, {
    mode: "write",
  });
  assert.equal(readinessAllowed.canWrite, true);
  assert.ok(readinessAllowed.hookStatuses.length >= 4);

  const summary = summarizeMigrationPattern(plan, {
    http: snapshot.http,
    languages: snapshot.languages,
    observability: snapshot.observability,
  });
  assert.equal(summary.id, "api-contract-rename");

  console.log("verification checks passed");
}

if (import.meta.main) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
