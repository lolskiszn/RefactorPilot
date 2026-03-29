import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { main as runCli } from "../../src/cli/index.js";
import { previewPatternMigration, transformPatternMigration } from "../../src/patterns/index.js";

async function createWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "refactorpilot-rest-grpc-full-"));
  await fs.mkdir(path.join(root, "go-server"), { recursive: true });
  await fs.mkdir(path.join(root, "python-client"), { recursive: true });
  await fs.writeFile(
    path.join(root, "go-server", "main.go"),
    `package main

import (
  "encoding/json"
  "net/http"
)

type UserPayload struct {
  UserID string \`json:"user_id"\`
  Name string \`json:"name"\`
}

func getUser(w http.ResponseWriter, r *http.Request) {
  payload := UserPayload{UserID: "1", Name: "Alice"}
  json.NewEncoder(w).Encode(payload)
}

func main() {
  http.HandleFunc("/user", getUser)
}
`,
    "utf8",
  );
  await fs.writeFile(
    path.join(root, "python-client", "client.py"),
    `import requests

def fetch_user():
    response = requests.get("http://localhost/user")
    return response.json()
`,
    "utf8",
  );
  return root;
}

async function captureStdout(run) {
  const lines = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => lines.push(args.join(" "));
  console.error = (...args) => lines.push(args.join(" "));
  try {
    await run();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return lines.join("\n");
}

export async function run() {
  const workspace = await createWorkspace();
  const preview = await previewPatternMigration("rest-to-grpc-full", workspace);
  assert.equal(preview.demoOnly, false);
  assert.ok(preview.changeSet.outputs.some((entry) => entry.path.endsWith(".proto")));
  assert.equal(preview.deploymentGuidance.recommendedStrategy, "bluegreen");
  assert.ok(preview.verifiedTransformation);
  assert.ok(["verified", "assisted", "manual-review"].includes(preview.verifiedTransformation.status));

  const transform = await transformPatternMigration("rest-to-grpc-full", workspace);
  assert.equal(transform.safeToApply, true);
  assert.ok(transform.outputs.some((entry) => entry.path.endsWith("grpc_client.py")));

  const output = await captureStdout(() => runCli([
    "apply",
    workspace,
    "--pattern",
    "rest-to-grpc-full",
    "--strategy",
    "bluegreen",
    "--confirm-production",
  ]));
  assert.ok(output.includes("Apply status: applied"));
  assert.ok(output.includes("Verified transformation:"));
  assert.ok(output.includes("Deployment strategy: bluegreen"));

  const proto = await fs.readFile(path.join(workspace, "proto", "user.proto"), "utf8");
  const workflow = await fs.readFile(path.join(workspace, ".github", "workflows", "bluegreen-deploy.yml"), "utf8");
  const pythonClient = await fs.readFile(path.join(workspace, "python-client", "client.py"), "utf8");
  assert.ok(proto.includes("service UserService"));
  assert.ok(workflow.includes("Blue Green Deploy"));
  assert.ok(pythonClient.includes("build_default_client"));

  console.log("rest-to-grpc full checks passed");
}

if (import.meta.main) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
