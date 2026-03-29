import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_IGNORES = new Set([
  ".git",
  ".refactorpilot-backups",
  "node_modules",
  "dist",
  "coverage",
  ".next",
  ".turbo",
]);

export async function walkWorkspace(rootDir, extensions) {
  const results = [];

  async function visit(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (DEFAULT_IGNORES.has(entry.name)) {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await visit(fullPath);
        continue;
      }

      if (extensions.has(path.extname(entry.name))) {
        results.push(fullPath);
      }
    }
  }

  await visit(rootDir);
  return results.sort();
}

export async function readText(filePath) {
  return fs.readFile(filePath, "utf8");
}

export function toPosixPath(filePath) {
  return filePath.split(path.sep).join(path.posix.sep);
}

export function relativeTo(rootDir, filePath) {
  return toPosixPath(path.relative(rootDir, filePath));
}
