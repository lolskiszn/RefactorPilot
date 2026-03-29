import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

import { createRequestHandler } from "../src/web/app.js";
import { applyFieldRename, previewFieldRename, scanWorkspace } from "../src/orchestration/index.js";
import http from "node:http";
import { run as runCliSurface } from "./cli/refactorpilot.test.js";
import { run as runInteractiveCli } from "./cli/interactive.test.js";
import { run as runConfidenceCalibration } from "./confidence/calibration.test.js";
import { run as runDeploymentChecks } from "./deployment/run.js";
import { run as runDifferentialChecks } from "./differential/differential.test.js";
import { run as runEnterpriseChecks } from "./platform/enterprise.test.js";
import { run as runMarketplaceChecks } from "./platform/marketplace.test.js";
import { run as runAmbiguityRanker } from "./engine/ambiguity-ranker.test.js";
import { previewRestToGrpcMigration } from "../src/patterns/index.js";
import { run as runPluginPatternChecks } from "./patterns/plugin-patterns.test.js";
import { run as runPluginRegistryChecks } from "./plugins/registry.test.js";
import { run as runPluginSdkChecks } from "./plugins/sdk.test.js";
import { run as runRestToGrpcFullChecks } from "./patterns/rest-to-grpc-full.test.js";
import { run as runPatternChecks } from "./patterns/run-patterns.js";
import { run as runTypeScriptAnalyzerChecks } from "./typescript/analyzer.test.js";
import { run as runTypeScriptIntegrationChecks } from "./typescript/integration.test.js";
import { run as runComplexTransformerChecks } from "./transformers/complex-cases.test.js";
import { run as runFrameworkMatrixChecks } from "./transformers/framework-matrix.test.js";
import { run as runRealWorldPatternChecks } from "./transformers/real-world-patterns.test.js";
import { run as runLaunchReadinessChecks } from "./transformers/launch-readiness-matrix.test.js";
import { run as runUnsupportedPatternChecks } from "./transformers/unsupported-patterns.test.js";
import { run as runVerifiedTransformationChecks } from "./verified-transformation/end-to-end.test.js";
import { run as runPatternMatrix } from "./scenarios/run-pattern-matrix.js";
import { run as runAutoResolveMatrix } from "./scenarios/auto-resolve-matrix.js";
import { run as runDynamicAccessMatrix } from "./scenarios/dynamic-access-matrix.js";
import { run as runMultiRepoGraph } from "./orchestration/multi-repo-graph.test.js";
import { run as runDistributedPlanner } from "./orchestration/distributed-planner.test.js";
import { run as runScenarioMatrix } from "./scenarios/run-matrix.js";
import { run as runVerificationMatrix } from "./scenarios/verification-matrix.js";
import { run as runVerificationChecks } from "./verification/verification.test.js";

async function run() {
  const fixtureRoot = path.resolve("tests/fixtures/polyglot");
  const scan = await scanWorkspace(fixtureRoot);
  assert.equal(scan.files.length, 2);
  assert.ok(scan.graph.nodes.length >= 4);

  const goFile = scan.files.find((file) => file.language === "go");
  const pythonFile = scan.files.find((file) => file.language === "python");
  assert.ok(goFile.fields.some((field) => field.jsonName === "user_id"));
  assert.ok(pythonFile.fieldUsages.some((usage) => usage.name === "user_id"));

  const preview = await previewFieldRename(fixtureRoot, "user_id", "account_id");
  assert.equal(preview.plan.summary.impactedFileCount, 2);
  assert.ok(preview.plan.replacements.some((replacement) => replacement.before === "user_id"));
  assert.ok(preview.plan.explanations.length > 0);
  assert.equal(preview.plan.validation.valid, true);

  const happyFixture = path.resolve("tests/engine/fixtures/happy");
  const safePreview = await previewFieldRename(happyFixture, "user_id", "account_id");
  assert.equal(safePreview.plan.validation.valid, true);

  const writeWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "refactorpilot-runner-"));
  await fs.copyFile(path.join(happyFixture, "server.go"), path.join(writeWorkspace, "server.go"));
  await fs.copyFile(path.join(happyFixture, "client.py"), path.join(writeWorkspace, "client.py"));
  const applied = await applyFieldRename(writeWorkspace, "user_id", "account_id", {
    mode: "write",
  });
  assert.equal(applied.apply.status, "applied");
  assert.match(await fs.readFile(path.join(writeWorkspace, "client.py"), "utf8"), /account_id/);

  const webWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "refactorpilot-web-runner-"));
  await fs.copyFile(path.join(fixtureRoot, "server.go"), path.join(webWorkspace, "server.go"));
  await fs.copyFile(path.join(fixtureRoot, "client.py"), path.join(webWorkspace, "client.py"));
  const server = http.createServer(createRequestHandler({ workspace: webWorkspace }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const response = await fetch(`http://127.0.0.1:${port}/api/preview`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      field: "user_id",
      to: "account_id",
      workspace: webWorkspace,
    }),
  });
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.report.plan.impactedFiles.length, 2);
  await new Promise((resolve) => server.close(resolve));

  const protocolWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "refactorpilot-protocol-runner-"));
  await fs.writeFile(
    path.join(protocolWorkspace, "server.go"),
    `package main
import "net/http"
func GetUsers(w http.ResponseWriter, r *http.Request) {}
`,
    "utf8",
  );
  await fs.writeFile(
    path.join(protocolWorkspace, "client.py"),
    `import requests
def fetch():
    return requests.get("http://localhost:8080/users")
`,
    "utf8",
  );
  const protocolArtifact = await previewRestToGrpcMigration(protocolWorkspace);
  assert.equal(protocolArtifact.patternId, "rest-to-grpc");
  assert.ok(protocolArtifact.generatedArtifacts.length >= 1);

  await runConfidenceCalibration();
  await runDifferentialChecks();
  await runEnterpriseChecks();
  await runMarketplaceChecks();
  await runAmbiguityRanker();
  await runScenarioMatrix();
  await runAutoResolveMatrix();
  await runDynamicAccessMatrix();
  await runMultiRepoGraph();
  await runDistributedPlanner();
  await runDeploymentChecks();
  await runPluginRegistryChecks();
  await runPluginSdkChecks();
  await runPluginPatternChecks();
  await runRestToGrpcFullChecks();
  await runTypeScriptAnalyzerChecks();
  await runTypeScriptIntegrationChecks();
  await runComplexTransformerChecks();
  await runFrameworkMatrixChecks();
  await runRealWorldPatternChecks();
  await runLaunchReadinessChecks();
  await runUnsupportedPatternChecks();
  await runVerifiedTransformationChecks();
  await runVerificationChecks();
  await runVerificationMatrix();
  await runPatternChecks();
  await runPatternMatrix();
  await runCliSurface();
  await runInteractiveCli();

  console.log("All verification checks passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
