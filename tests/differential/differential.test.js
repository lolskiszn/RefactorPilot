import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { writeReplayFixture } from "../../src/runtime/recorder.js";
import { runDifferentialTest } from "../../src/engine/differential-tester.js";
import { runSandboxApply } from "../../src/cli/apply.js";

export async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "refactorpilot-differential-"));
  const workspace = path.join(root, "workspace");
  await fs.mkdir(path.join(workspace, ".refactorpilot", "replay-traces"), { recursive: true });
  await fs.writeFile(
    path.join(workspace, "server.go"),
    `package main
type UserPayload struct {
  UserID string \`json:"user_id"\`
}
`,
    "utf8",
  );
  await fs.writeFile(
    path.join(workspace, "client.py"),
    `def fetch_user(payload):
    return payload["user_id"]
`,
    "utf8",
  );

  const fixturePath = path.join(workspace, ".refactorpilot", "replay-traces", "baseline.json");
  await writeReplayFixture(fixturePath, [
    {
      id: "req-1",
      request: {
        method: "GET",
        path: "/user",
        headers: { "x-trace-id": "abc" },
      },
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { user_id: "123", created_at: "2026-03-28T00:00:00Z" },
      },
    },
  ]);

  const diff = await runDifferentialTest(
    {
      fromField: "user_id",
      toField: "account_id",
    },
    {
      replayFixturePath: fixturePath,
    },
  );
  assert.equal(diff.checked, true);
  assert.equal(diff.equivalent, true);

  const sandbox = await runSandboxApply(workspace, "user_id", "account_id", {
    differentialMode: "semantic",
    replayFixturePath: fixturePath,
  });
  assert.equal(sandbox.apply.status, "applied");
  assert.equal(sandbox.apply.differential.equivalent, true);
  const originalServer = await fs.readFile(path.join(workspace, "server.go"), "utf8");
  assert.ok(originalServer.includes("user_id"));
  console.log("differential checks passed");
}

if (import.meta.main) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
