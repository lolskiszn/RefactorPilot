import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { previewFieldRename } from "../../src/orchestration/index.js";

export async function run() {
  const cases = [
    {
      expectedLevel: "high",
      expectedValid: true,
      workspace: path.resolve("tests/engine/fixtures/happy"),
    },
    {
      expectedLevel: "low",
      expectedValid: false,
      workspace: path.resolve("tests/engine/fixtures/ambiguous"),
    },
    {
      expectedLevel: "low",
      expectedValid: false,
      workspace: path.resolve("tests/engine/fixtures/dynamic"),
    },
  ];

  for (const testCase of cases) {
    const report = await previewFieldRename(testCase.workspace, "user_id", "account_id");
    assert.equal(report.plan.confidence, testCase.expectedLevel);
    assert.equal(report.plan.validation.valid, testCase.expectedValid);
  }

  console.log("confidence calibration checks passed");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
