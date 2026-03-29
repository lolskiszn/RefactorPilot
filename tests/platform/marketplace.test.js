import assert from "node:assert/strict";

import { createMarketplaceEntry, validatePatternManifest } from "../../platform/marketplace/registry.js";

export async function run() {
  const manifest = {
    name: "rest-to-grpc",
    version: "1.0.0",
    languages: ["go", "python"],
    runtime: "declarative",
  };
  const validation = validatePatternManifest(manifest);
  assert.equal(validation.valid, true);

  const entry = createMarketplaceEntry(manifest, {
    id: "author-1",
    name: "Verified Author",
    verified: true,
  });
  assert.equal(entry.status, "pending_review");
  assert.equal(entry.sandbox.vm, "firecracker");
  console.log("marketplace checks passed");
}

if (import.meta.main) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
