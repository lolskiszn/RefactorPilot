import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { applyFieldRename } from "../orchestration/index.js";

async function copyWorkspace(sourceRoot, targetRoot) {
  const entries = await fs.readdir(sourceRoot, { withFileTypes: true });
  await fs.mkdir(targetRoot, { recursive: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceRoot, entry.name);
    const targetPath = path.join(targetRoot, entry.name);
    if (entry.isDirectory()) {
      await copyWorkspace(sourcePath, targetPath);
    } else {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

export async function runSandboxApply(workspace, fromField, toField, options = {}) {
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "refactorpilot-sandbox-"));
  const cloneRoot = path.join(sandboxRoot, "workspace");
  await copyWorkspace(path.resolve(workspace), cloneRoot);

  const result = await applyFieldRename(cloneRoot, fromField, toField, {
    ...options,
    mode: "write",
  });

  return {
    ...result,
    sandbox: {
      cloneRoot,
      root: sandboxRoot,
    },
  };
}
