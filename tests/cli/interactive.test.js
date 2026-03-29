import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { main as runCli } from "../../src/cli/index.js";
import { previewFieldRename } from "../../src/orchestration/index.js";

function makeAmbiguousWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "refactorpilot-ambiguous-"));
  fs.writeFileSync(path.join(root, "producer_a.go"), `package main
type Alpha struct {
  UserID string \`json:"user_id"\`
}
`);
  fs.writeFileSync(path.join(root, "producer_b.go"), `package main
type Beta struct {
  UserID string \`json:"user_id"\`
}
`);
  fs.writeFileSync(path.join(root, "client.py"), `def read_payload(payload):
    return payload["user_id"]
`);
  return root;
}

export async function run() {
  const workspace = makeAmbiguousWorkspace();
  const preview = await previewFieldRename(workspace, "user_id", "account_id");
  assert.equal(preview.plan.disambiguation.ambiguous, true);
  assert.ok(preview.plan.disambiguation.groups.some((group) => group.kind === "producer"));

  const input = new PassThrough();
  const output = new PassThrough();
  let captured = "";
  output.on("data", (chunk) => {
    captured += chunk.toString();
  });

  input.end("1\n");
  const cliOutput = await captureStdout(() =>
    runCli(
      ["preview", workspace, "--field", "user_id", "--to", "account_id", "--interactive"],
      { interactive: { input, output } },
    ),
  );

  assert.ok(captured.includes("Interactive Disambiguation"));
  assert.ok(cliOutput.includes("Conflict Resolution"));
  assert.ok(cliOutput.includes("selected"));

  const targeted = await previewFieldRename(workspace, "user_id", "account_id", {
    targetContext: "Alpha",
  });
  assert.equal(targeted.plan.validation.valid, true);
  assert.equal(targeted.plan.impactedFiles.some((entry) => entry.path.includes("producer_b.go")), false);

  const htmlPath = path.join(workspace, "report.html");
  const htmlOutput = await captureStdout(() =>
    runCli(["preview", workspace, "--field", "user_id", "--to", "account_id", "--format", "html", "--output", htmlPath]),
  );
  assert.ok(htmlOutput.includes("Wrote HTML preview"));
  assert.ok(fs.readFileSync(htmlPath, "utf8").includes("Ambiguity Review"));
}

async function captureStdout(run) {
  const lines = [];
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args) => {
    lines.push(args.join(" "));
  };
  console.error = (...args) => {
    lines.push(args.join(" "));
  };

  try {
    await run();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  return lines.join("\n");
}

if (import.meta.main) {
  run().then(() => {
    console.log("interactive CLI checks passed");
  }).catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
