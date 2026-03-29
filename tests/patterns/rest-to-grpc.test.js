import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { previewRestToGrpcMigration } from "../../src/patterns/index.js";

export async function run() {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "refactorpilot-protocol-"));
  await fs.writeFile(
    path.join(workspace, "server.go"),
    `package main
import "net/http"

func GetUsers(w http.ResponseWriter, r *http.Request) {}
`,
    "utf8",
  );
  await fs.writeFile(
    path.join(workspace, "client.py"),
    `import requests
def fetch():
    return requests.get("http://localhost:8080/users")
`,
    "utf8",
  );

  const artifact = await previewRestToGrpcMigration(workspace);
  assert.equal(artifact.patternId, "rest-to-grpc");
  assert.ok(artifact.generatedArtifacts.length >= 1);
  assert.ok(artifact.transportMap.serverEndpoints.length >= 1);
  assert.ok(artifact.transportMap.clientCalls.length >= 1);
  console.log("pattern rest-to-grpc checks passed");
}

run().catch((error) => {
  if (process.argv[1]?.endsWith("rest-to-grpc.test.js")) {
    console.error(error);
    process.exitCode = 1;
  }
});
