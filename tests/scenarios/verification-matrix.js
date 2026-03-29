import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  assessVerificationReadiness,
  collectVerificationSnapshot,
  detectMigrationPattern,
} from "../../src/engine/index.js";

const PATTERNS = [
  "api-contract-rename",
  "rest-to-grpc-preview",
  "observability-upgrade",
];

const WORKSPACE_PROFILES = [
  "contract",
  "transport",
  "observability",
  "node",
];

const GIT_STATES = [
  { detected: false, state: "absent" },
  { detected: true, state: "clean" },
  { detected: true, state: "dirty" },
];

const TOOL_PROFILES = [
  {
    id: "all-pass",
    outcomes: {
      "git-clean": true,
      "go-build": true,
      "go-test": true,
      "node-build": true,
      "node-test": true,
      "python-syntax": true,
      "python-test": true,
      "workspace-build": true,
      "workspace-test": true,
    },
  },
  {
    id: "go-fail",
    outcomes: {
      "git-clean": true,
      "go-build": false,
      "go-test": false,
      "node-build": true,
      "node-test": true,
      "python-syntax": true,
      "python-test": true,
      "workspace-build": true,
      "workspace-test": true,
    },
  },
  {
    id: "python-fail",
    outcomes: {
      "git-clean": true,
      "go-build": true,
      "go-test": true,
      "node-build": true,
      "node-test": true,
      "python-syntax": false,
      "python-test": false,
      "workspace-build": true,
      "workspace-test": true,
    },
  },
  {
    id: "node-fail",
    outcomes: {
      "git-clean": true,
      "go-build": true,
      "go-test": true,
      "node-build": false,
      "node-test": false,
      "python-syntax": true,
      "python-test": true,
      "workspace-build": true,
      "workspace-test": true,
    },
  },
];

export async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "refactorpilot-verification-matrix-"));
  const scenarios = buildScenarios();
  const results = [];

  for (const scenario of scenarios) {
    const workspace = path.join(root, scenario.id);
    await fs.mkdir(workspace, { recursive: true });
    await writeWorkspace(workspace, scenario);

    const plan = buildPlan(scenario);
    const snapshot = await collectVerificationSnapshot(workspace, plan, {
      gitState: scenario.gitState,
    });
    const pattern = detectMigrationPattern(plan, snapshot);
    const readiness = assessVerificationReadiness(plan, snapshot, scenario.toolProfile.outcomes, {
      mode: scenario.strict ? "write" : "preview",
      strict: scenario.strict,
    });

    results.push({
      id: scenario.id,
      pattern: pattern.id,
      patternPreviewOnly: pattern.previewOnly,
      gitState: scenario.gitState.state,
      workspaceProfile: scenario.workspaceProfile,
      toolProfile: scenario.toolProfile.id,
      strict: scenario.strict,
      canWrite: readiness.canWrite,
      blockerCount: readiness.issues.length,
      hookCount: snapshot.hooks.length,
      hasGoBuildHook: snapshot.hooks.some((hook) => hook.id === "go-build"),
      hasGoHook: snapshot.hooks.some((hook) => hook.id === "go-test"),
      hasPythonBuildHook: snapshot.hooks.some((hook) => hook.id === "python-test"),
      hasPythonHook: snapshot.hooks.some((hook) => hook.id === "python-syntax"),
      hasNodeBuildHook: snapshot.hooks.some((hook) => hook.id === "node-build"),
      hasNodeHook: snapshot.hooks.some((hook) => hook.id === "node-test"),
    });

    if (scenario.pattern === "api-contract-rename" && scenario.workspaceProfile === "contract" && scenario.gitState.state === "clean" && scenario.toolProfile.id === "all-pass") {
      assert.equal(pattern.id, "api-contract-rename");
      assert.equal(pattern.supported, true);
      assert.equal(readiness.canWrite, true);
    }

    if (scenario.pattern === "rest-to-grpc-preview" && scenario.workspaceProfile === "transport") {
      assert.equal(pattern.id, "rest-to-grpc-preview");
      assert.equal(pattern.previewOnly, true);
    }

    if (scenario.pattern === "observability-upgrade" && scenario.workspaceProfile === "observability") {
      assert.equal(pattern.id, "observability-upgrade");
      assert.equal(pattern.previewOnly, true);
    }

    if (scenario.gitState.state === "dirty" && scenario.strict) {
      assert.equal(readiness.canWrite, false);
    }

    if (scenario.strict) {
      const failedHookIds =
        scenario.toolProfile.id === "go-fail"
          ? ["go-build", "go-test"]
          : scenario.toolProfile.id === "python-fail"
            ? ["python-syntax", "python-test"]
            : scenario.toolProfile.id === "node-fail"
              ? ["node-build", "node-test"]
              : [];

      if (failedHookIds.some((hookId) => snapshot.hooks.some((hook) => hook.id === hookId))) {
        assert.equal(readiness.canWrite, false);
      }
    }
  }

  assert.ok(results.length >= 200, `expected at least 200 scenarios, got ${results.length}`);
  assert.ok(results.some((result) => result.pattern === "api-contract-rename" && result.canWrite));
  assert.ok(results.some((result) => result.pattern === "rest-to-grpc-preview" && result.patternPreviewOnly));
  assert.ok(results.some((result) => result.pattern === "observability-upgrade" && result.hasNodeHook));
  assert.ok(results.some((result) => result.hasGoBuildHook && result.hasPythonBuildHook));

  console.log(JSON.stringify({
    scenarios: results.length,
    previews: results.filter((result) => result.patternPreviewOnly).length,
    writeable: results.filter((result) => result.canWrite).length,
  }, null, 2));
}

function buildScenarios() {
  const scenarios = [];
  let counter = 0;

  for (const pattern of PATTERNS) {
    for (const workspaceProfile of WORKSPACE_PROFILES) {
      for (const gitState of GIT_STATES) {
        for (const toolProfile of TOOL_PROFILES) {
          for (const strict of [false, true]) {
            scenarios.push({
              id: `scenario-${String(++counter).padStart(3, "0")}`,
              gitState,
              pattern,
              strict,
              toolProfile,
              workspaceProfile,
            });
          }
        }
      }
    }
  }

  return scenarios;
}

async function writeWorkspace(root, scenario) {
  if (scenario.workspaceProfile === "contract" || scenario.workspaceProfile === "transport") {
    await fs.writeFile(
      path.join(root, "server.go"),
      scenario.workspaceProfile === "transport"
        ? `package main

import (
    "encoding/json"
    "net/http"
)

type UserPayload struct {
    UserID string \`json:"user_id"\`
}

func HandleUser(w http.ResponseWriter, r *http.Request) {
    json.NewEncoder(w).Encode(UserPayload{})
}
`
        : `package main

type UserPayload struct {
    UserID string \`json:"user_id"\`
}
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "client.py"),
      scenario.workspaceProfile === "transport"
        ? `import requests

def fetch_user():
    return requests.get("http://example.com/user").json()["user_id"]
`
        : `def fetch_user(payload):
    return payload["user_id"]
`,
      "utf8",
    );
    if (scenario.workspaceProfile === "transport") {
      await fs.writeFile(path.join(root, "go.mod"), "module example.com/demo\n", "utf8");
      await fs.writeFile(path.join(root, "pyproject.toml"), "[project]\nname = \"demo\"\n", "utf8");
    }
  }

  if (scenario.workspaceProfile === "observability") {
    await fs.writeFile(
      path.join(root, "server.go"),
      `package main

import "log"

func Handler() {
    log.Println("trace start")
}
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "client.py"),
      `def emit():
    trace_id = "abc123"
    return trace_id
`,
      "utf8",
    );
  }

  if (scenario.workspaceProfile === "node") {
    await fs.writeFile(
      path.join(root, "app.js"),
      `export function trace() {
  return "observability";
}
`,
      "utf8",
    );
    await fs.writeFile(path.join(root, "package.json"), "{\n  \"name\": \"demo\"\n}\n", "utf8");
  }
}

function buildPlan(scenario) {
  const basePlan = {
    confidenceScore: scenario.pattern === "api-contract-rename" ? 1 : 0.72,
    impactedFiles: [],
    migrationPattern: {
      id: scenario.pattern,
      previewOnly: scenario.pattern !== "api-contract-rename",
      supported: scenario.pattern === "api-contract-rename",
    },
    replacements: [],
    summary: {
      impactedFileCount: 0,
      replacementCount: 0,
    },
    transformation: scenario.pattern === "api-contract-rename" ? "field_rename" : scenario.pattern,
    validation: {
      valid: true,
    },
  };

  if (scenario.workspaceProfile !== "node") {
    basePlan.impactedFiles.push({ path: "server.go" });
    basePlan.replacements.push({ path: "server.go", line: 4, column: 26, before: "user_id", after: "account_id" });
  }

  if (scenario.workspaceProfile === "contract" || scenario.workspaceProfile === "transport") {
    basePlan.impactedFiles.push({ path: "client.py" });
    basePlan.replacements.push({ path: "client.py", line: 2, column: 21, before: "user_id", after: "account_id" });
  }

  if (scenario.workspaceProfile === "node") {
    basePlan.impactedFiles.push({ path: "app.js" });
    basePlan.replacements.push({ path: "app.js", line: 2, column: 10, before: "observability", after: "migration" });
  }

  basePlan.summary = {
    impactedFileCount: basePlan.impactedFiles.length,
    replacementCount: basePlan.replacements.length,
  };

  if (scenario.pattern === "observability-upgrade") {
    basePlan.notes = ["trace propagation", "log instrumentation"];
  }

  return basePlan;
}

if (import.meta.main) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
