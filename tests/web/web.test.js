import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";

import { createRequestHandler } from "../../src/web/app.js";

async function run() {
  const workspace = await createFixtureWorkspace();
  const server = http.createServer(createRequestHandler({ workspace }));
  const port = await listen(server);

  try {
    const page = await fetch(`http://127.0.0.1:${port}/`);
    const html = await page.text();
    assert.ok(html.includes("RefactorPilot"));

    const scan = await fetchJson(`http://127.0.0.1:${port}/api/scan?workspace=${encodeURIComponent(workspace)}`);
    assert.equal(scan.ok, true);
    assert.equal(scan.summary.scannedFiles, 2);

    const preview = await fetchJson(`http://127.0.0.1:${port}/api/preview`, {
      method: "POST",
      body: JSON.stringify({
        workspace,
        field: "user_id",
        to: "account_id",
      }),
    });
    assert.equal(preview.ok, true);
    assert.equal(preview.report.plan.impactedFiles.length, 2);

    const apply = await fetchJson(`http://127.0.0.1:${port}/api/apply`, {
      method: "POST",
      body: JSON.stringify({
        workspace,
        field: "user_id",
        to: "account_id",
      }),
    });
    assert.equal(apply.ok, true);
    assert.equal(apply.result.status, "applied");

    const client = await fs.readFile(path.join(workspace, "client.py"), "utf8");
    const serverGo = await fs.readFile(path.join(workspace, "server.go"), "utf8");
    assert.ok(client.includes("account_id"));
    assert.ok(serverGo.includes("account_id"));

    const blocked = await fetchJson(`http://127.0.0.1:${port}/api/apply`, {
      method: "POST",
      body: JSON.stringify({
        workspace,
        field: "missing_field",
        to: "still_missing",
      }),
    });
    assert.equal(blocked.ok, true);
    assert.equal(blocked.result.status, "blocked");
    assert.ok(blocked.result.validation.issues.some((issue) => issue.kind === "no-impacts"));
  } finally {
    await close(server);
  }

  console.log("Web checks passed.");
}

async function createFixtureWorkspace() {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "refactorpilot-web-"));
  await fs.copyFile(path.resolve("tests/fixtures/polyglot/server.go"), path.join(workspace, "server.go"));
  await fs.copyFile(path.resolve("tests/fixtures/polyglot/client.py"), path.join(workspace, "client.py"));
  return workspace;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  return response.json();
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(address.port);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
