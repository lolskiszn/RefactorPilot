import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPluginRegistry } from "../../src/plugins/registry.js";
import { createPlatformExtensionHost } from "../../src/platform/extensions/webhook-hooks.js";

async function createExternalPluginRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "refactorpilot-plugin-root-"));
  const pluginDir = path.join(root, "@refactorpilot", "pattern-external-sample");
  await fs.mkdir(pluginDir, { recursive: true });
  await fs.writeFile(
    path.join(pluginDir, "package.json"),
    JSON.stringify(
      {
        name: "@refactorpilot/pattern-external-sample",
        version: "1.0.0",
        main: "index.cjs",
        refactorpilotPlugin: {
          id: "external-sample",
          title: "External Sample",
          capabilities: {
            patterns: ["external-sample"],
            extensions: ["migration.completed"],
          },
          entry: "index.cjs",
          version: "1.0.0",
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  await fs.writeFile(
    path.join(pluginDir, "index.cjs"),
    `module.exports = {
  plugin: {
    manifest: {
      capabilities: {
        patterns: ["external-sample"],
        extensions: ["migration.completed"]
      },
      id: "external-sample",
      title: "External Sample",
      version: "1.0.0"
    },
    extensions: {
      "migration.completed": async (payload) => ({ acknowledged: true, payload })
    },
    async preview(workspace) {
      return {
        confidence: "medium",
        confidenceScore: 0.7,
        patternId: "external-sample",
        workspace
      };
    }
  }
};`,
    "utf8",
  );
  return root;
}

export async function run() {
  const registry = createPluginRegistry({
    discoveryRoots: [],
    includeExternal: false,
  });
  registry.registerBuiltin(
    {
      capabilities: {
        patterns: ["builtin-sample"],
      },
      id: "builtin-sample",
      title: "Builtin Sample",
      version: "1.0.0",
    },
    async () => ({
      plugin: {
        manifest: {
          id: "builtin-sample",
        },
        async preview(workspace) {
          return {
            patternId: "builtin-sample",
            workspace,
          };
        },
      },
    }),
  );

  assert.equal(registry.listPluginManifests().length, 1);
  const builtin = await registry.loadPlugin("builtin-sample");
  const builtinPreview = await builtin.preview("workspace");
  assert.equal(builtinPreview.patternId, "builtin-sample");

  const discoveryRoot = await createExternalPluginRoot();
  const externalRegistry = createPluginRegistry({
    discoveryRoots: [discoveryRoot],
  });
  const manifest = externalRegistry.getManifest("external-sample");
  assert.ok(manifest);
  assert.equal(manifest.trusted, false);

  const external = await externalRegistry.loadPlugin("external-sample");
  assert.equal(external.runtime.sandboxed, true);
  assert.ok(["vm2", "node-vm-fallback"].includes(external.runtime.sandboxEngine));

  const host = createPlatformExtensionHost();
  await host.registerPlugin(external);
  const emitted = await host.emitLifecycle("migration.completed", { id: "m1" });
  assert.equal(emitted[0].acknowledged, true);

  console.log("plugin registry checks passed");
}

if (import.meta.main) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
