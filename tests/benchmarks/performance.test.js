import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { scanWorkspace } from "../../src/orchestration/index.js";

const FILE_COUNT = 10_000;
const DURATION_BUDGET_MS = 30_000;
const HEAP_BUDGET_MB = 512;

async function writeFixtureFile(rootDir, index) {
  const folder = path.join(rootDir, `slice-${String(index % 100).padStart(3, "0")}`);
  const isGo = index % 2 === 0;
  const extension = isGo ? "go" : "py";
  const filePath = path.join(folder, `fixture-${String(index).padStart(5, "0")}.${extension}`);
  const fieldKey = `user_id_${String(index % 100).padStart(3, "0")}`;
  const contents = isGo
    ? `package synthetic

type User${index} struct {
  UserID string \`json:"${fieldKey}"\`
  Name string \`json:"name"\`
}

func Handle${index}() string {
  return "${fieldKey}"
}
`
    : `class User${index}:
    def __init__(self, payload):
        self.payload = payload

def handle_${index}(payload):
    return payload["${fieldKey}"]
`;

  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(filePath, contents, "utf8");
}

async function createSyntheticWorkspace() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "refactorpilot-performance-"));
  const batchSize = 250;

  for (let start = 0; start < FILE_COUNT; start += batchSize) {
    const tasks = [];
    for (let index = start; index < Math.min(FILE_COUNT, start + batchSize); index += 1) {
      tasks.push(writeFixtureFile(rootDir, index));
    }
    await Promise.all(tasks);
  }

  return rootDir;
}

async function measureScan(rootDir) {
  let peakHeapUsed = process.memoryUsage().heapUsed;
  const sampler = setInterval(() => {
    peakHeapUsed = Math.max(peakHeapUsed, process.memoryUsage().heapUsed);
  }, 10);

  const startedAt = performance.now();
  const scan = await scanWorkspace(rootDir, {
    compactGraph: true,
    includeSource: false,
  });
  const durationMs = performance.now() - startedAt;

  clearInterval(sampler);
  peakHeapUsed = Math.max(peakHeapUsed, process.memoryUsage().heapUsed);

  return {
    durationMs,
    fileCount: scan.files.length,
    heapUsedMb: Number((peakHeapUsed / (1024 * 1024)).toFixed(2)),
    nodeCount: scan.graph.nodes.length,
  };
}

export async function run() {
  const rootDir = await createSyntheticWorkspace();
  const result = await measureScan(rootDir);

  assert.equal(result.fileCount, FILE_COUNT);
  assert.ok(
    result.durationMs < DURATION_BUDGET_MS,
    `Performance regression: ${result.durationMs.toFixed(2)}ms exceeds ${DURATION_BUDGET_MS}ms`,
  );
  assert.ok(
    result.heapUsedMb < HEAP_BUDGET_MB,
    `Memory regression: ${result.heapUsedMb}MB exceeds ${HEAP_BUDGET_MB}MB`,
  );

  console.log(JSON.stringify({
    durationMs: Number(result.durationMs.toFixed(2)),
    fileCount: result.fileCount,
    heapUsedMb: result.heapUsedMb,
    nodeCount: result.nodeCount,
  }, null, 2));
}

if (import.meta.main) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
