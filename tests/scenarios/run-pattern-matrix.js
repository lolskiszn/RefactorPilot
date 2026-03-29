import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { previewRestToGrpcMigration } from "../../src/patterns/index.js";

const ROUTES = ["users", "orders", "teams", "projects", "sessions", "devices", "regions", "invoices", "accounts", "tenants"];
const METHODS = ["Get", "Post", "Put"];
const PY_PATTERNS = ["get", "post"];
const HANDLER_STYLES = ["signature", "handlefunc"];

export async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "refactorpilot-pattern-matrix-"));
  const results = [];
  let sequence = 0;

  for (const route of ROUTES) {
    for (const method of METHODS) {
      for (const pyPattern of PY_PATTERNS) {
        for (const handlerStyle of HANDLER_STYLES) {
          const scenarioRoot = path.join(root, `protocol-${sequence += 1}`);
          await fs.mkdir(scenarioRoot, { recursive: true });
          await fs.writeFile(path.join(scenarioRoot, "server.go"), buildGoScenario(route, method, handlerStyle), "utf8");
          await fs.writeFile(path.join(scenarioRoot, "client.py"), buildPythonScenario(route, pyPattern), "utf8");

          const startedAt = performance.now();
          const artifact = await previewRestToGrpcMigration(scenarioRoot);
          const latencyMs = Number((performance.now() - startedAt).toFixed(2));

          assert.ok(artifact.generatedArtifacts.length >= 1, `missing proto artifact for ${scenarioRoot}`);
          assert.ok(artifact.transportMap.serverEndpoints.length >= 1, `missing server endpoint for ${scenarioRoot}`);
          assert.ok(artifact.transportMap.clientCalls.length >= 1, `missing client call for ${scenarioRoot}`);

          results.push({
            confidence: artifact.report.confidence,
            grpcServices: artifact.impactSurface.grpcServices,
            id: sequence,
            latencyMs,
          });
        }
      }
    }
  }

  const averageLatencyMs = results.reduce((sum, entry) => sum + entry.latencyMs, 0) / results.length;
  assert.ok(results.length >= 120, `expected at least 120 protocol scenarios, got ${results.length}`);
  assert.ok(results.every((entry) => entry.grpcServices >= 1), "every protocol scenario should infer a service");

  console.log(JSON.stringify({
    summary: {
      averageLatencyMs: Number(averageLatencyMs.toFixed(2)),
      scenarios: results.length,
    },
    sample: results.slice(0, 12),
  }, null, 2));
}

function buildGoScenario(route, method, style) {
  if (style === "handlefunc") {
    return `package main
import "net/http"

func ${method}${capitalize(route)}(w http.ResponseWriter, r *http.Request) {}
func main() {
    http.HandleFunc("/${route}", ${method}${capitalize(route)})
}
`;
  }

  return `package main
import "net/http"

func ${method}${capitalize(route)}(w http.ResponseWriter, r *http.Request) {}
`;
}

function buildPythonScenario(route, method) {
  return `import requests
def call_${route}():
    return requests.${method}("http://localhost:8080/${route}")
`;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
