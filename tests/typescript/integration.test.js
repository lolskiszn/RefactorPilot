import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { previewFieldRename } from "../../src/orchestration/index.js";

async function createWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "refactorpilot-go-ts-"));
  await fs.writeFile(
    path.join(root, "server.go"),
    `package main

type UserPayload struct {
  UserID string \`json:"user_id"\`
}
`,
    "utf8",
  );
  await fs.writeFile(
    path.join(root, "client.ts"),
    `export interface UserPayload {
  user_id: string;
}

export async function fetchUser() {
  const response = await fetch("/api/user");
  const data = await response.json();
  return data.user_id;
}
`,
    "utf8",
  );
  return root;
}

export async function run() {
  const workspace = await createWorkspace();
  const preview = await previewFieldRename(workspace, "user_id", "account_id");
  assert.ok(preview.plan.impactedFiles.some((entry) => entry.language === "go"));
  assert.ok(preview.plan.impactedFiles.some((entry) => entry.language === "typescript"));
  assert.ok(preview.plan.replacements.some((entry) => entry.path.endsWith("client.ts")));
  console.log("typescript integration checks passed");
}

if (import.meta.main) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
