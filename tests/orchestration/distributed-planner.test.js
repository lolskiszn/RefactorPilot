import assert from "node:assert/strict";

import { buildDistributedCampaignPlan } from "../../src/orchestration/distributed/campaign-planner.js";

export async function run() {
  const plan = buildDistributedCampaignPlan({
    graph: {
      topologicalOrder: ["service-a", "service-b", "service-c", "service-d"],
    },
    repos: [{ name: "service-a" }, { name: "service-b" }, { name: "service-c" }, { name: "service-d" }],
    maxBatchSize: 2,
  });

  assert.equal(plan.batches.length, 2);
  assert.deepEqual(plan.batches[0].repos, ["service-a", "service-b"]);
  assert.equal(plan.canary.percentages[0], 1);
  console.log("distributed planner checks passed");
}

if (import.meta.main) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
