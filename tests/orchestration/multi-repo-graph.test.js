import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildMultiRepoGraph, planCoordinatedMigration } from "../../src/orchestration/multi-repo-graph.js";

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function createWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "refactorpilot-multirepo-"));

  await writeFile(path.join(root, "service-a", "go.mod"), `module example.com/acme/service-a

go 1.22
`);
  await writeFile(path.join(root, "service-a", "main.go"), `package main

func main() {}
`);

  await writeFile(path.join(root, "service-b", "package.json"), JSON.stringify({
    dependencies: {
      "service-a": "workspace:*",
    },
    name: "service-b",
    version: "1.0.0",
  }, null, 2));
  await writeFile(path.join(root, "service-b", "src", "index.js"), `import client from "service-a/client";

export function run() {
  return client();
}
`);

  await writeFile(path.join(root, "service-c", "pyproject.toml"), `[project]
name = "service-c"
version = "0.1.0"
`);
  await writeFile(path.join(root, "service-c", "requirements.txt"), `service-a==1.2.3
`);
  await writeFile(path.join(root, "service-c", "app.py"), `from service_a import client

def run():
    return client()
`);

  await writeFile(path.join(root, "service-d", "requirements.txt"), `click==8.1.7
`);
  await writeFile(path.join(root, "service-d", "tool.py"), `import click
`);

  return root;
}

export async function run() {
  const root = await createWorkspace();
  const graph = await buildMultiRepoGraph(root, {
    focusRepo: "service-a",
  });

  assert.equal(graph.repos.length, 4);
  assert.equal(graph.impactedRepos[0], "service-a");
  assert.deepEqual(graph.impactedRepos, ["service-a", "service-b", "service-c"]);
  assert.deepEqual(graph.coordinationOrder, ["service-a", "service-b", "service-c"]);

  const serviceA = graph.repos.find((repo) => repo.id === "service-a");
  const serviceB = graph.repos.find((repo) => repo.id === "service-b");
  const serviceC = graph.repos.find((repo) => repo.id === "service-c");
  const serviceD = graph.repos.find((repo) => repo.id === "service-d");

  assert.ok(serviceA);
  assert.ok(serviceB);
  assert.ok(serviceC);
  assert.ok(serviceD);

  assert.equal(serviceA.language, "go");
  assert.equal(serviceB.language, "javascript");
  assert.equal(serviceC.language, "python");

  assert.deepEqual(serviceA.dependents, ["service-b", "service-c"]);
  assert.deepEqual(serviceB.dependencies, ["service-a"]);
  assert.deepEqual(serviceC.dependencies, ["service-a"]);
  assert.deepEqual(serviceD.dependencies, []);

  assert.ok(graph.edges.some((edge) => edge.from === "service-a" && edge.to === "service-b"));
  assert.ok(graph.edges.some((edge) => edge.from === "service-a" && edge.to === "service-c"));
  assert.ok(!graph.edges.some((edge) => edge.to === "service-d"));

  const plan = await planCoordinatedMigration(root, "service-a");
  assert.deepEqual(plan.impactedRepos, ["service-a", "service-b", "service-c"]);
  console.log("multi-repo graph checks passed");
}

if (import.meta.main) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
