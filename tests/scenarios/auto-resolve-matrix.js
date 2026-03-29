import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { previewFieldRename } from "../../src/orchestration/index.js";

const DOMAINS = ["user", "account", "invoice", "tenant", "order", "project", "session", "region", "device", "team", "workspace", "profile"];
const GO_LAYOUTS = ["server", "handler", "service"];
const PY_LAYOUTS = ["client", "fetch", "request"];

export async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "refactorpilot-auto-resolve-"));
  const results = [];
  let sequence = 0;

  for (const domain of DOMAINS) {
    for (const goLayout of GO_LAYOUTS) {
      for (const pyLayout of PY_LAYOUTS) {
        for (const variant of ["producer_only", "producer_and_consumer"]) {
          const scenarioRoot = path.join(root, `scenario-${String(++sequence).padStart(3, "0")}`);
          await fs.mkdir(scenarioRoot, { recursive: true });
          await writeWorkspace(scenarioRoot, { domain, goLayout, pyLayout, variant });

          const startedAt = performance.now();
          const report = await previewFieldRename(scenarioRoot, `${domain}_id`, `next_${domain}_id`, {
            autoResolve: true,
          });
          const latencyMs = Number((performance.now() - startedAt).toFixed(2));
          const selected = report.plan.ambiguityResolution?.selected ?? null;
          const correct =
            selected === toPascal(domain) + "Payload" &&
            report.plan.impactedFiles.some((entry) => entry.path === "server.go") &&
            !report.plan.impactedFiles.some((entry) => entry.path === "other.go");

          results.push({
            correct,
            latencyMs,
            resolution: selected,
          });

          assert.equal(report.plan.validation.valid, true, `auto-resolve should validate for ${scenarioRoot}`);
          assert.equal(correct, true, `auto-resolve picked wrong target for ${scenarioRoot}`);
        }
      }
    }
  }

  const precision = results.filter((item) => item.correct).length / results.length;
  const averageLatencyMs = results.reduce((sum, item) => sum + item.latencyMs, 0) / results.length;
  assert.ok(results.length >= 200, `expected at least 200 scenarios, got ${results.length}`);
  assert.ok(precision >= 0.95, `expected precision >= 0.95, got ${precision}`);
  console.log(JSON.stringify({
    scenarios: results.length,
    precision: Number(precision.toFixed(3)),
    averageLatencyMs: Number(averageLatencyMs.toFixed(2)),
  }, null, 2));
}

async function writeWorkspace(root, scenario) {
  const field = `${scenario.domain}_id`;
  const parent = `${toPascal(scenario.domain)}Payload`;
  const secondaryParent = "AuditPayload";

  await fs.writeFile(path.join(root, "server.go"), `package main
type ${parent} struct {
  ${toPascal(field)} string \`json:"${field}"\`
}
func ${toPascal(scenario.goLayout)}${toPascal(scenario.domain)}() {}
`, "utf8");
  await fs.writeFile(path.join(root, "other.go"), `package main
type ${secondaryParent} struct {
  ${toPascal(field)} string \`json:"${field}"\`
}
func HandleAudit() {}
`, "utf8");
  await fs.writeFile(path.join(root, "client.py"), `def ${scenario.pyLayout}_${scenario.domain}(payload):
    return payload["${field}"]
`, "utf8");
  if (scenario.variant === "producer_and_consumer") {
    await fs.writeFile(path.join(root, "other.py"), `def read_audit(payload):
    return payload["${field}"]
`, "utf8");
  }
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
