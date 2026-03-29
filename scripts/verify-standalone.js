import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import dns from "node:dns";
import path from "node:path";

import { previewFieldRename, scanWorkspace } from "../src/orchestration/index.js";

const fixtureRoot = path.resolve("tests/fixtures/polyglot");
const blockedMessage = "Standalone verification blocked a network call.";

function fail() {
  throw new Error(blockedMessage);
}

function installNetworkGuards() {
  globalThis.fetch = fail;
  http.request = fail;
  http.get = fail;
  https.request = fail;
  https.get = fail;
  net.connect = fail;
  net.createConnection = fail;
  dns.lookup = fail;
}

async function main() {
  installNetworkGuards();

  const scan = await scanWorkspace(fixtureRoot);
  assert.equal(scan.files.length, 2);

  const preview = await previewFieldRename(fixtureRoot, "user_id", "account_id");
  assert.equal(preview.plan.summary.impactedFileCount, 2);

  console.log("standalone verification passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
