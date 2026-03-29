import { previewApiContractMigration } from "./api-contract-rename.js";
import { previewRestToGrpcMigration } from "./rest-to-grpc.js";
import { createPluginRegistry, PLUGIN_API_VERSION } from "../plugins/registry.js";

const pluginRegistry = createPluginRegistry();

pluginRegistry.registerBuiltin(
  {
    apiVersion: PLUGIN_API_VERSION,
    capabilities: {
      patterns: ["api-contract-rename"],
    },
    description: "Coordinate a shared contract-field rename across Go and Python.",
    id: "api-contract-rename",
    packageName: "@refactorpilot/pattern-api-contract-rename",
    source: "builtin",
    supportsApply: true,
    title: "API Contract Migration",
    version: "1.0.0",
  },
  async () => ({
    plugin: {
      apiVersion: PLUGIN_API_VERSION,
      manifest: {
        maturity: "working",
        supportsApply: true,
      },
      async preview(workspace, options = {}) {
        return previewApiContractMigration(workspace, options);
      },
    },
  }),
);

pluginRegistry.registerBuiltin(
  {
    apiVersion: PLUGIN_API_VERSION,
    capabilities: {
      patterns: ["rest-to-grpc"],
    },
    description: "Preview REST to gRPC migration surfaces and draft proto artifacts.",
    id: "rest-to-grpc",
    packageName: "@refactorpilot/pattern-rest-to-grpc",
    source: "builtin",
    supportsApply: false,
    title: "Protocol Migration",
    version: "1.0.0",
  },
  async () => ({
    plugin: {
      apiVersion: PLUGIN_API_VERSION,
      manifest: {
        maturity: "preview",
        supportsApply: false,
      },
      async preview(workspace, options = {}) {
        return previewRestToGrpcMigration(workspace, options);
      },
    },
  }),
);

pluginRegistry.registerBuiltin(
  {
    apiVersion: PLUGIN_API_VERSION,
    capabilities: {
      patterns: ["rest-to-grpc-full"],
    },
    description: "Produce a richer end-to-end REST to gRPC transformation plan with deployment guidance.",
    id: "rest-to-grpc-full",
    packageName: "@refactorpilot/pattern-rest-to-grpc-full",
    source: "builtin",
    supportsApply: true,
    title: "Full Protocol Migration",
    version: "1.0.0",
  },
  async () => {
    const mod = await import("../../patterns/rest-to-grpc-full/index.js");
    return {
      plugin: mod.plugin,
    };
  },
);

function toPatternSummary(manifest) {
  const patternId = manifest.capabilities?.patterns?.[0] ?? manifest.id;
  return {
    apiVersion: manifest.apiVersion,
    description: manifest.description,
    id: patternId,
    maturity: manifest.maturity ?? (manifest.source === "builtin" ? "working" : "plugin"),
    pluginId: manifest.id,
    source: manifest.source,
    supportsApply: Boolean(manifest.supportsApply),
    title: manifest.title ?? manifest.name,
    trusted: manifest.trusted,
    version: manifest.version,
  };
}

export function listPatterns() {
  return pluginRegistry.listByCapability("patterns").map(toPatternSummary);
}

export function getPattern(patternId) {
  return listPatterns().find((pattern) => pattern.id === patternId || pattern.pluginId === patternId) ?? null;
}

export async function previewPatternMigration(patternId, workspace, options = {}) {
  const manifest = getPattern(patternId);
  if (!manifest) {
    throw new Error(`Unknown migration pattern: ${patternId}`);
  }

  const plugin = await pluginRegistry.loadPlugin(manifest.pluginId);
  if (typeof plugin.preview !== "function") {
    throw new Error(`Pattern plugin ${manifest.pluginId} does not implement preview().`);
  }

  return plugin.preview(workspace, options);
}

export async function transformPatternMigration(patternId, workspace, options = {}) {
  const manifest = getPattern(patternId);
  if (!manifest) {
    throw new Error(`Unknown migration pattern: ${patternId}`);
  }

  const plugin = await pluginRegistry.loadPlugin(manifest.pluginId);
  if (typeof plugin.transform !== "function") {
    throw new Error(`Pattern plugin ${manifest.pluginId} does not implement transform().`);
  }

  return plugin.transform(workspace, options);
}

export function getPatternPluginRegistry() {
  return pluginRegistry;
}
