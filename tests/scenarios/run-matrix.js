import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { applyFieldRename, previewFieldRename } from "../../src/orchestration/index.js";

const FIELD_NAMES = [
  "user_id",
  "account_id",
  "email",
  "display_name",
  "team_id",
  "invoice_id",
  "project_key",
  "region_code",
  "device_id",
  "session_id",
  "tenant_id",
  "order_id",
];

const SAFE_PATTERNS = ["bracket", "dict_literal", "dict_get"];
const DYNAMIC_PATTERNS = ["dynamic_bracket", "dynamic_get"];
const GO_LAYOUTS = ["basic", "handler", "extra_field"];
const AMBIGUOUS_VARIANTS = ["duplicate_producer", "duplicate_consumer", "duplicate_both"];

export async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "refactorpilot-matrix-"));
  const scenarios = buildScenarioMatrix();
  const results = [];

  for (const scenario of scenarios) {
    const scenarioDir = path.join(root, scenario.id);
    await fs.mkdir(scenarioDir, { recursive: true });
    await writeScenarioWorkspace(scenarioDir, scenario);

    const startedAt = performance.now();
    const preview = await previewFieldRename(scenarioDir, scenario.fromField, scenario.toField);
    const previewLatencyMs = Number((performance.now() - startedAt).toFixed(2));
    const baseline = await snapshotWorkspace(scenarioDir);

    const dryRun = await applyFieldRename(scenarioDir, scenario.fromField, scenario.toField, {
      mode: "dry-run",
    });
    const afterDryRun = await snapshotWorkspace(scenarioDir);
    assert.deepEqual(afterDryRun, baseline, `dry-run mutated files for ${scenario.id}`);

    if (scenario.expected.safeApply) {
      assert.equal(preview.plan.validation.valid, true, `safe scenario should validate for ${scenario.id}`);
      let rollbackProbeResult = null;
      if (scenario.expected.rollbackProbe) {
        rollbackProbeResult = await applyFieldRename(scenarioDir, scenario.fromField, scenario.toField, {
          mode: "write",
          writeFile: async (filePath, data, encoding) => {
            if (String(filePath).endsWith("client.py") && data.includes(scenario.toField)) {
              throw new Error("matrix simulated write failure");
            }
            return fs.writeFile(filePath, data, encoding);
          },
        });
        assert.equal(rollbackProbeResult.apply.status, "rolled_back", `rollback probe should restore files for ${scenario.id}`);
        const afterRollback = await snapshotWorkspace(scenarioDir);
        assert.deepEqual(afterRollback, baseline, `rollback probe mutated files for ${scenario.id}`);
      }
      const apply = await applyFieldRename(scenarioDir, scenario.fromField, scenario.toField, {
        mode: "write",
      });
      assert.equal(apply.apply.status, "applied", `safe scenario should apply for ${scenario.id}`);
      const updatedServer = await fs.readFile(path.join(scenarioDir, "server.go"), "utf8");
      const updatedClient = await fs.readFile(path.join(scenarioDir, "client.py"), "utf8");
      assert.ok(updatedServer.includes(scenario.toField), `server rename missing for ${scenario.id}`);
      assert.ok(updatedClient.includes(scenario.toField), `client rename missing for ${scenario.id}`);
      results.push(buildResultRecord(scenario, preview, previewLatencyMs, dryRun, apply, rollbackProbeResult));
      continue;
    }

    assert.equal(preview.plan.validation.valid, false, `unsafe scenario should be blocked for ${scenario.id}`);
    const blocked = await applyFieldRename(scenarioDir, scenario.fromField, scenario.toField, {
      mode: "write",
    });
    assert.notEqual(blocked.apply.status, "applied", `unsafe scenario should not apply for ${scenario.id}`);
    const afterBlocked = await snapshotWorkspace(scenarioDir);
    assert.deepEqual(afterBlocked, baseline, `blocked apply mutated files for ${scenario.id}`);

    if (scenario.expected.rollbackProbe) {
      const rollback = await applyFieldRename(scenarioDir, scenario.fromField, scenario.toField, {
        mode: "write",
        writeFile: async (filePath, data, encoding) => {
          if (String(filePath).endsWith("client.py") && data.includes(scenario.toField)) {
            throw new Error("matrix simulated write failure");
          }
          return fs.writeFile(filePath, data, encoding);
        },
      });
      assert.equal(rollback.apply.status, "rolled_back", `rollback should trigger for ${scenario.id}`);
      const afterRollback = await snapshotWorkspace(scenarioDir);
      assert.deepEqual(afterRollback, baseline, `rollback did not restore files for ${scenario.id}`);
      results.push(buildResultRecord(scenario, preview, previewLatencyMs, dryRun, rollback, rollback));
      continue;
    }

    results.push(buildResultRecord(scenario, preview, previewLatencyMs, dryRun, blocked, null));
  }

  const summary = summarize(results);
  console.log(JSON.stringify({ summary, results: results.slice(0, 12) }, null, 2));
}

function buildScenarioMatrix() {
  const scenarios = [];
  let sequence = 0;

  for (const fieldName of FIELD_NAMES) {
    for (const pattern of SAFE_PATTERNS) {
      for (const layout of GO_LAYOUTS) {
        scenarios.push({
          id: `safe-${sequence += 1}`,
          type: "safe",
          fromField: fieldName,
          toField: `next_${fieldName}`,
          pattern,
          layout,
          expected: {
            confidence: "high",
            rollbackProbe: sequence % 9 === 0,
            safeApply: true,
          },
        });
      }
    }

    for (const pattern of DYNAMIC_PATTERNS) {
      for (const layout of GO_LAYOUTS) {
        scenarios.push({
          id: `dynamic-${sequence += 1}`,
          type: "dynamic",
          fromField: fieldName,
          toField: `next_${fieldName}`,
          pattern,
          layout,
          expected: {
            confidence: "low",
            rollbackProbe: false,
            safeApply: false,
          },
        });
      }
    }

    for (const variant of AMBIGUOUS_VARIANTS) {
      for (const layout of ["basic", "extra_field"]) {
        scenarios.push({
          id: `ambiguous-${sequence += 1}`,
          type: "ambiguous",
          fromField: fieldName,
          toField: `next_${fieldName}`,
          pattern: "bracket",
          layout,
          variant,
          expected: {
            confidence: "low",
            rollbackProbe: false,
            safeApply: false,
          },
        });
      }
    }
  }

  return scenarios;
}

async function writeScenarioWorkspace(root, scenario) {
  await fs.writeFile(path.join(root, "server.go"), buildGoSource(scenario), "utf8");
  await fs.writeFile(path.join(root, "client.py"), buildPythonSource(scenario), "utf8");

  if (scenario.type === "ambiguous" && (scenario.variant === "duplicate_producer" || scenario.variant === "duplicate_both")) {
    await fs.writeFile(
      path.join(root, "shadow.go"),
      `package main

type ShadowPayload struct {
    ${goFieldName(scenario.fromField)} string \`json:"${scenario.fromField}"\`
}
`,
      "utf8",
    );
  }

  if (scenario.type === "ambiguous" && (scenario.variant === "duplicate_consumer" || scenario.variant === "duplicate_both")) {
    await fs.writeFile(
      path.join(root, "shadow.py"),
      `def mirror(payload):
    return payload["${scenario.fromField}"]
`,
      "utf8",
    );
  }
}

function buildGoSource(scenario) {
  const extraField =
    scenario.layout === "extra_field"
      ? `    Meta string \`json:"meta_${scenario.fromField}"\`\n`
      : "";
  const handler =
    scenario.layout === "handler"
      ? `
func HandleUser() UserPayload {
    return UserPayload{}
}
`
      : "";

  return `package main

type UserPayload struct {
    ${goFieldName(scenario.fromField)} string \`json:"${scenario.fromField}"\`
${extraField}}
${handler}`;
}

function buildPythonSource(scenario) {
  const field = scenario.fromField;

  if (scenario.type === "dynamic") {
    if (scenario.pattern === "dynamic_get") {
      return `def fetch_user(payload, field_name):
    return payload.get(field_name)
`;
    }
    return `def fetch_user(payload, field_name):
    return payload[field_name]
`;
  }

  if (scenario.pattern === "dict_literal") {
    return `def fetch_user(payload):
    return {"${field}": payload["${field}"]}
`;
  }

  if (scenario.pattern === "dict_get") {
    return `def fetch_user(payload):
    return payload.get("${field}")
`;
  }

  return `def fetch_user(payload):
    return payload["${field}"]
`;
}

function goFieldName(fieldName) {
  return fieldName
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

async function snapshotWorkspace(root) {
  const files = await fs.readdir(root);
  const snapshots = [];
  for (const file of files.sort()) {
    const fullPath = path.join(root, file);
    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) {
      continue;
    }
    snapshots.push({
      file,
      content: await fs.readFile(fullPath, "utf8"),
    });
  }
  return snapshots;
}

function buildResultRecord(scenario, preview, previewLatencyMs, dryRun, applyResult, rollbackProbeResult) {
  return {
    id: scenario.id,
    type: scenario.type,
    rollbackProbeStatus: rollbackProbeResult?.apply?.status ?? rollbackProbeResult?.status ?? null,
    confidence: preview.plan.confidence,
    confidenceScore: preview.plan.confidenceScore,
    latencyMs: previewLatencyMs,
    validationValid: preview.plan.validation.valid,
    dryRunStatus: dryRun.apply.status,
    applyStatus: applyResult.apply.status,
    safeApplyExpected: scenario.expected.safeApply,
  };
}

function summarize(results) {
  const safe = results.filter((item) => item.safeApplyExpected);
  const blocked = results.filter((item) => !item.safeApplyExpected);
  const averageLatencyMs =
    results.reduce((total, item) => total + item.latencyMs, 0) / Math.max(1, results.length);

  const safeHighConfidenceRate =
    safe.filter((item) => item.confidence === "high" && item.validationValid).length / Math.max(1, safe.length);
  const blockedNotAppliedRate =
    blocked.filter((item) => item.applyStatus !== "applied" && item.validationValid === false).length / Math.max(1, blocked.length);
  const rollbackSuccessCount = results.filter((item) => item.rollbackProbeStatus === "rolled_back" || item.applyStatus === "rolled_back").length;

  assert.ok(results.length >= 200, `expected at least 200 scenarios, got ${results.length}`);
  assert.ok(safeHighConfidenceRate >= 0.95, `safe high-confidence rate too low: ${safeHighConfidenceRate}`);
  assert.ok(blockedNotAppliedRate >= 0.95, `blocked scenario rate too low: ${blockedNotAppliedRate}`);

  return {
    averageLatencyMs: Number(averageLatencyMs.toFixed(2)),
    blockedNotAppliedRate: Number(blockedNotAppliedRate.toFixed(3)),
    rollbackSuccessCount,
    safeHighConfidenceRate: Number(safeHighConfidenceRate.toFixed(3)),
    scenarios: results.length,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
