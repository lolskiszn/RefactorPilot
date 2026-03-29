import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getPattern, listPatterns, previewPatternMigration, transformPatternMigration } from "../../src/patterns/index.js";

async function createWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "refactorpilot-plugin-pattern-"));
  await fs.mkdir(path.join(root, "go-server"), { recursive: true });
  await fs.mkdir(path.join(root, "python-client"), { recursive: true });
  await fs.writeFile(
    path.join(root, "go-server", "main.go"),
    `package main

import (
  "encoding/json"
  "net/http"
)

type User struct {
  ID string \`json:"id"\`
  Name string \`json:"name"\`
}

func getUser(w http.ResponseWriter, r *http.Request) {
  user := User{ID: "1", Name: "Alice"}
  json.NewEncoder(w).Encode(user)
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
    resp = requests.get("http://localhost/user")
    return resp.json()
`,
    "utf8",
  );
  return root;
}

export async function run() {
  const patterns = listPatterns();
  assert.ok(patterns.some((pattern) => pattern.id === "rest-to-grpc-full"));
  const fullPattern = getPattern("rest-to-grpc-full");
  assert.equal(fullPattern?.supportsApply, true);

  const workspace = await createWorkspace();
  const preview = await previewPatternMigration("rest-to-grpc-full", workspace);
  assert.equal(preview.patternId, "rest-to-grpc-full");
  assert.equal(preview.deploymentGuidance.recommendedStrategy, "bluegreen");
  assert.ok(preview.changeSet.outputs.length >= 3);

  const transform = await transformPatternMigration("rest-to-grpc-full", workspace);
  assert.equal(transform.safeToApply, true);
  assert.equal(transform.outputs[0].action, "create");

  console.log("plugin pattern checks passed");
}

if (import.meta.main) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
