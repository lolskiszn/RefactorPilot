import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { planFieldRename } from "../src/orchestration/plan-field-rename.js";
import { scanWorkspace } from "../src/orchestration/scan-workspace.js";

const fixtureRoot = path.resolve("tests/fixtures/polyglot");

test("scanWorkspace lifts Go and Python into a shared graph", async () => {
  const result = await scanWorkspace(fixtureRoot);

  assert.equal(result.files.length, 2);
  assert.ok(result.graph.nodes.length >= 8);
  assert.ok(result.graph.edges.length >= 6);

  const goFile = result.files.find((file) => file.language === "go");
  const pythonFile = result.files.find((file) => file.language === "python");

  assert.ok(goFile.fields.some((field) => field.jsonName === "user_id"));
  assert.ok(pythonFile.fieldUsages.some((usage) => usage.name === "user_id"));
});

test("planFieldRename finds impacted files across languages", async () => {
  const scan = await scanWorkspace(fixtureRoot);
  const plan = await planFieldRename(scan, "user_id", "account_id");

  assert.equal(plan.transformation, "field_rename");
  assert.equal(plan.summary.impactedFileCount, 2);
  assert.ok(plan.replacements.some((item) => item.before === "user_id"));
});
