import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analyzePullRequest, createRefactorPilotBot, loadRefactorPilotConfig } from "../src/index.js";

export async function run() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const config = await loadRefactorPilotConfig(root);
  assert.equal(config.readOnly, true);
  assert.equal(config.createCheckRuns, true);

  const analysis = analyzePullRequest({
    config,
    files: [
      {
        filename: "server.go",
        patch: "+ http.HandleFunc(\"/user\", handler)\n+ type UserPayload struct { UserID string `json:\"user_id\"` }",
        status: "modified",
      },
      {
        filename: "client.py",
        patch: "+ return payload[field_name]",
        status: "modified",
      },
    ],
    pullRequest: {
      html_url: "https://example.com/pr/1",
    },
  });

  assert.equal(analysis.readOnly, true);
  assert.ok(analysis.requiresPreview);
  assert.ok(analysis.inferredPatterns.includes("rest-to-grpc"));
  assert.ok(analysis.previewUrl.includes("refactorpilot.dev/preview"));
  assert.ok(analysis.commentBody.includes("RefactorPilot review summary"));
  assert.ok(analysis.commentBody.includes("View Migration Preview"));
  assert.ok(analysis.checkRun.name.includes("impact-analysis"));

  const bot = createRefactorPilotBot({
    config,
    logger: {
      info() {},
    },
  });
  const fakeContext = {
    octokit: {
      checks: {
        async create() {
          return { ok: true };
        },
      },
      issues: {
        async createComment() {
          return { ok: true };
        },
      },
    },
    payload: {
      pull_request: {
        files: analysis.candidates.map((entry) => ({
          filename: entry.filename,
          patch: "+ signal",
          status: "modified",
        })),
        head: { sha: "deadbeef" },
        html_url: "https://example.com/pr/1",
        number: 1,
      },
      repository: {
        name: "demo",
        owner: { login: "refactorpilot" },
      },
    },
  };
  const result = await bot.handlePullRequest(fakeContext);
  assert.equal(result.analysis.readOnly, true);
  assert.ok(result.comment.includes("RefactorPilot"));

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "refactorpilot-github-bot-"));
  await fs.writeFile(path.join(tempRoot, ".refactorpilot.yml"), "readOnly: true\n", "utf8");
  const tempConfig = await loadRefactorPilotConfig(tempRoot);
  assert.equal(tempConfig.readOnly, true);
}

if (import.meta.main) {
  run().then(() => {
    console.log("github bot smoke checks passed");
  }).catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
