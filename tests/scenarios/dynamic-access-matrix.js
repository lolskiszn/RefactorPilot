import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { previewFieldRename } from "../../src/orchestration/index.js";

const DOMAINS = ["user", "account", "invoice", "tenant", "order", "project", "session", "region", "device", "team"];
const PY_PATTERNS = ["dynamic_bracket", "dynamic_get", "getattr_like"];
const GO_PATTERNS = ["plain", "json", "database"];

export async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "refactorpilot-dynamic-matrix-"));
  const results = [];
  let sequence = 0;

  for (const domain of DOMAINS) {
    for (const pyPattern of PY_PATTERNS) {
      for (const goPattern of GO_PATTERNS) {
        const scenarioRoot = path.join(root, `scenario-${String(++sequence).padStart(3, "0")}`);
        await fs.mkdir(scenarioRoot, { recursive: true });
        await writeWorkspace(scenarioRoot, { domain, goPattern, pyPattern });

        const startedAt = performance.now();
        const report = await previewFieldRename(scenarioRoot, `${domain}_id`, `next_${domain}_id`, {
          dynamicAnalysis: true,
        });
        const latencyMs = Number((performance.now() - startedAt).toFixed(2));

        const hasClientImpact = report.plan.impactedFiles.some((entry) => entry.path === "client.py");
        const hasServerImpact = report.plan.impactedFiles.some((entry) => entry.path === "server.go");
        const hasDynamicFlag = report.plan.impactedFiles.some((entry) => entry.dynamicImpact === true);

        results.push({
          hasClientImpact,
          hasDynamicFlag,
          hasServerImpact,
          latencyMs,
        });

        assert.equal(hasServerImpact, true, `server impact missing for ${scenarioRoot}`);
        assert.equal(hasClientImpact, true, `dynamic client impact missing for ${scenarioRoot}`);
        assert.equal(hasDynamicFlag, true, `dynamic flag missing for ${scenarioRoot}`);
        assert.equal(report.plan.dynamicAnalysis.enabled, true, `dynamic analysis metadata missing for ${scenarioRoot}`);
      }
    }
  }

  const recall = results.filter((item) => item.hasClientImpact && item.hasServerImpact).length / results.length;
  const averageLatencyMs = results.reduce((sum, item) => sum + item.latencyMs, 0) / results.length;
  assert.ok(results.length >= 50, `expected at least 50 dynamic scenarios, got ${results.length}`);
  assert.equal(recall, 1, `expected impact recall 1, got ${recall}`);
  console.log(JSON.stringify({
    scenarios: results.length,
    impactRecall: recall,
    averageLatencyMs: Number(averageLatencyMs.toFixed(2)),
  }, null, 2));
}

async function writeWorkspace(root, scenario) {
  const field = `${scenario.domain}_id`;
  const goTag = scenario.goPattern === "database" ? " `json:\""+field+"\" gorm:\"column:"+field+"\"`" : " `json:\""+field+"\"`";
  const goExtras =
    scenario.goPattern === "json"
      ? "\nfunc MarshalPayload() { _ = UserPayload{} }\n"
      : "";
  await fs.writeFile(path.join(root, "server.go"), `package main
type UserPayload struct {
  ${toPascal(field)} string${goTag}
}
${goExtras}`, "utf8");

  const pySource =
    scenario.pyPattern === "dynamic_get"
      ? `def fetch(payload, field_name):
    return payload.get(field_name)
`
      : scenario.pyPattern === "getattr_like"
        ? `def fetch(payload, field_name):
    return payload[field_name]
`
        : `def fetch(payload, field_name):
    return payload[field_name]
`;
  await fs.writeFile(path.join(root, "client.py"), pySource, "utf8");
}

function toPascal(value) {
  return String(value)
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

if (import.meta.main) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
