import assert from "node:assert/strict";

import { analyzeTypeScriptSource } from "../../packages/language-typescript/src/index.js";

export async function run() {
  const source = `export interface UserPayload {
  user_id: string;
  displayName: string;
}

export async function fetchUser() {
  const response = await fetch("/api/user");
  const data = await response.json();
  return data.user_id;
}
`;
  const result = analyzeTypeScriptSource(source, "client.ts");
  assert.equal(result.language, "typescript");
  assert.ok(result.symbols.some((entry) => entry.name === "UserPayload"));
  assert.ok(result.fields.some((entry) => entry.name === "user_id"));
  assert.ok(result.fieldUsages.some((entry) => entry.name === "user_id"));
  assert.ok(result.endpoints.some((entry) => entry.route === "/api/user"));
  console.log("typescript analyzer checks passed");
}

if (import.meta.main) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
