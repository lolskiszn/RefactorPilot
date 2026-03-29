import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { scanWorkspace } from "../../src/engine/index.js";
import { applyPlan } from "../../src/engine/apply.js";
import { planFieldRename, validatePlan } from "../../src/engine/planner.js";

async function copyFixture(sourceDir) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "refactorpilot-engine-"));
  const target = path.join(root, "workspace");
  await fs.cp(sourceDir, target, { recursive: true });
  return target;
}

async function readFile(filePath) {
  return fs.readFile(filePath, "utf8");
}

async function run() {
  const happyWorkspace = await copyFixture(path.resolve("tests/engine/fixtures/happy"));
  const happyScan = await scanWorkspace(happyWorkspace);
  const happyPlan = await planFieldRename(happyScan.graph, {
    fromField: "user_id",
    toField: "account_id",
  });

  assert.equal(happyPlan.validation.valid, true);
  assert.equal(happyPlan.summary.impactedFileCount, 2);
  assert.ok(happyPlan.confidenceScore >= 0.72);
  assert.ok(happyPlan.explanations.length > 0);

  const dryRun = await applyPlan(happyPlan, {
    mode: "dry-run",
    workspaceRoot: happyWorkspace,
  });
  assert.equal(dryRun.status, "dry-run");
  assert.equal(dryRun.applied, false);

  const ambiguousWorkspace = await copyFixture(path.resolve("tests/engine/fixtures/ambiguous"));
  const ambiguousScan = await scanWorkspace(ambiguousWorkspace);
  const ambiguousPlan = await planFieldRename(ambiguousScan.graph, {
    fromField: "user_id",
    toField: "account_id",
  });

  assert.equal(ambiguousPlan.validation.valid, false);
  assert.ok(ambiguousPlan.confidenceScore < 0.72);

  const dynamicWorkspace = await copyFixture(path.resolve("tests/engine/fixtures/dynamic"));
  const dynamicScan = await scanWorkspace(dynamicWorkspace);
  const dynamicPlan = await planFieldRename(dynamicScan.graph, {
    fromField: "user_id",
    toField: "account_id",
  });

  assert.ok(dynamicPlan.warnings.some((warning) => warning.includes("Dynamic access")));

  const applyWorkspace = await copyFixture(path.resolve("tests/engine/fixtures/happy"));
  const applyScan = await scanWorkspace(applyWorkspace);
  const applyPlanResult = await planFieldRename(applyScan.graph, {
    fromField: "user_id",
    toField: "account_id",
  });
  const applyResult = await applyPlan(applyPlanResult, {
    mode: "write",
    workspaceRoot: applyWorkspace,
  });

  assert.equal(applyResult.status, "applied");
  const appliedGo = await readFile(path.join(applyWorkspace, "server.go"));
  const appliedPy = await readFile(path.join(applyWorkspace, "client.py"));
  assert.ok(appliedGo.includes("account_id"));
  assert.ok(appliedPy.includes("account_id"));

  const failingWorkspace = await copyFixture(path.resolve("tests/engine/fixtures/happy"));
  const failingScan = await scanWorkspace(failingWorkspace);
  const failingPlan = await planFieldRename(failingScan.graph, {
    fromField: "user_id",
    toField: "account_id",
  });
  const failingResult = await applyPlan(failingPlan, {
    failAfterWrites: 1,
    mode: "write",
    workspaceRoot: failingWorkspace,
    writeFile: async (filePath, data, encoding) => {
      if (String(filePath).endsWith("client.py") && data.includes("account_id")) {
        throw new Error("simulated write failure");
      }
      return fs.writeFile(filePath, data, encoding);
    },
  });

  assert.equal(failingResult.status, "rolled_back");
  const rolledBackGo = await readFile(path.join(failingWorkspace, "server.go"));
  const rolledBackPy = await readFile(path.join(failingWorkspace, "client.py"));
  assert.ok(rolledBackGo.includes("user_id"));
  assert.ok(rolledBackPy.includes("user_id"));

  const validation = validatePlan(happyPlan, happyScan.graph);
  assert.equal(validation.valid, true);

  console.log("engine checks passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
