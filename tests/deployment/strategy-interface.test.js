import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

import {
  DEPLOYMENT_STRATEGY_API_VERSION,
  DeploymentStrategy,
  InPlaceDeploymentStrategy,
  ProgressiveDeploymentStrategy,
  PreviewOnlyDeploymentStrategy,
  SandboxDeploymentStrategy,
  createDeploymentStrategyRegistry,
  defaultDeploymentStrategyRegistry,
  listDeploymentStrategies,
} from "../../src/deployment/strategy-interface.js";

function assertDescriptor(descriptor, expectedId) {
  assert.equal(descriptor.id, expectedId);
  assert.equal(descriptor.version, DEPLOYMENT_STRATEGY_API_VERSION);
  assert.ok(Array.isArray(descriptor.capabilities));
  assert.ok(Array.isArray(descriptor.modes));
}

export async function run() {
  assert.equal(DEPLOYMENT_STRATEGY_API_VERSION, "1.0.0");

  const strategies = listDeploymentStrategies();
  assert.equal(strategies.length, 4);
  assert.deepEqual(
    strategies.map((strategy) => strategy.id),
    ["preview-only", "in-place", "sandbox", "progressive"],
  );

  const registry = createDeploymentStrategyRegistry();
  assert.equal(registry.list().length, 4);

  const preview = registry.get("preview-only");
  const inPlace = registry.get("in-place");
  const sandbox = registry.get("sandbox");
  const progressive = registry.get("progressive");

  assert.ok(preview instanceof PreviewOnlyDeploymentStrategy);
  assert.ok(inPlace instanceof InPlaceDeploymentStrategy);
  assert.ok(sandbox instanceof SandboxDeploymentStrategy);
  assert.ok(progressive instanceof ProgressiveDeploymentStrategy);

  assertDescriptor(preview.describe(), "preview-only");
  assertDescriptor(inPlace.describe(), "in-place");
  assertDescriptor(sandbox.describe(), "sandbox");
  assertDescriptor(progressive.describe(), "progressive");

  assert.equal(preview.supports({ mode: "preview" }), true);
  assert.equal(preview.supports({ mode: "write" }), false);

  const previewPlan = preview.buildPlan({ workspace: "workspace", mode: "preview" });
  assert.equal(previewPlan.previewOnly, true);
  assert.equal(previewPlan.dryRun, true);

  const inPlacePlan = inPlace.buildPlan({ workspace: "workspace", mode: "write" });
  assert.equal(inPlacePlan.target, "workspace");
  assert.equal(inPlacePlan.dryRun, false);

  const sandboxPlan = sandbox.buildPlan({ workspace: "workspace" });
  assert.equal(sandboxPlan.sandbox.isolatedWorkspace, true);

  const progressivePlan = progressive.buildPlan({
    phases: [
      { name: "canary", percentage: 5 },
      { name: "full", percentage: 100 },
    ],
  });
  assert.deepEqual(
    progressivePlan.phases.map((phase) => phase.percentage),
    [5, 100],
  );

  const resolvedPreview = registry.resolve({ mode: "preview" });
  assert.equal(resolvedPreview?.describe().id, "preview-only");
  const resolvedSandbox = registry.resolve({ mode: "sandbox" });
  assert.equal(resolvedSandbox?.describe().id, "sandbox");

  const execution = await progressive.execute({ workspace: "workspace" });
  assert.equal(execution.status, "progressive");
  assert.equal(execution.phases.length, 3);

  const rollback = await inPlace.rollback({ status: "applied" });
  assert.equal(rollback.reverted, true);
  assert.equal(rollback.targetStatus, "applied");

  assert.equal(defaultDeploymentStrategyRegistry.list().length, 4);

  class CustomStrategy extends DeploymentStrategy {
    constructor() {
      super({
        capabilities: ["custom"],
        id: "custom",
        modes: ["preview"],
        name: "Custom",
      });
    }
  }

  const custom = new CustomStrategy();
  assert.equal(custom.describe().id, "custom");
  assert.equal(custom.supports({ mode: "preview" }), true);
  assert.equal(custom.supports({ mode: "write" }), false);

  console.log("deployment strategy interface checks passed");
}

if (import.meta.main) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
