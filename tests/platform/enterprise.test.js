import assert from "node:assert/strict";

import { buildCampaign } from "../../platform/enterprise/campaign-manager.js";
import { evaluatePolicies } from "../../platform/enterprise/policy-engine.js";

export async function run() {
  const repos = [
    { name: "auth-service", languages: ["go"], tags: ["auth"], capabilities: [] },
    { name: "billing-service", languages: ["go"], tags: ["payments"], capabilities: ["rest-to-grpc"] },
  ];
  const policies = [
    {
      id: "grpc-auth",
      kind: "migration-required",
      requiredPattern: "rest-to-grpc",
      selector: {
        languages: ["go"],
        tags: ["auth"],
      },
    },
  ];

  const evaluation = evaluatePolicies(repos, policies);
  assert.equal(evaluation.violations.length, 1);
  assert.equal(evaluation.violations[0].repo, "auth-service");

  const campaign = buildCampaign(repos, policies[0], { batchSize: 1 });
  assert.equal(campaign.batches.length, 2);
  console.log("enterprise checks passed");
}

if (import.meta.main) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
