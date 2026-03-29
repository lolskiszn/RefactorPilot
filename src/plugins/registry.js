import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { pathToFileURL } from "node:url";

export const PLUGIN_API_VERSION = "1.0.0";
const REFACTORPILOT_PLUGIN_PREFIX = "@refactorpilot/";

function normalizeId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_/]+/g, "-");
}

function toArray(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function defaultPluginRoots() {
  const roots = [];
  const cwdNodeModules = path.resolve("node_modules");
  if (fs.existsSync(cwdNodeModules)) {
    roots.push(cwdNodeModules);
  }
  return roots;
}

function readJsonSync(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function discoverPackageDirs(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const packageDirs = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const fullPath = path.join(rootDir, entry.name);
    if (entry.name.startsWith("@")) {
      for (const nested of fs.readdirSync(fullPath, { withFileTypes: true })) {
        if (nested.isDirectory()) {
          packageDirs.push(path.join(fullPath, nested.name));
        }
      }
      continue;
    }

    packageDirs.push(fullPath);
  }

  return packageDirs;
}

function normalizePluginManifest(manifest, source) {
  const pluginId = normalizeId(manifest?.id ?? manifest?.name ?? source.packageName ?? source.entryPath);
  const capabilities = manifest?.capabilities ?? {};

  return {
    apiVersion: manifest?.apiVersion ?? PLUGIN_API_VERSION,
    capabilities: {
      deployments: toArray(capabilities.deployments),
      extensions: toArray(capabilities.extensions),
      frontends: toArray(capabilities.frontends),
      patterns: toArray(capabilities.patterns),
    },
    description: manifest?.description ?? "",
    entryPath: source.entryPath,
    id: pluginId,
    maturity: manifest?.maturity ?? null,
    name: manifest?.name ?? pluginId,
    packageName: source.packageName ?? pluginId,
    source: source.kind,
    supportsApply: Boolean(manifest?.supportsApply),
    title: manifest?.title ?? manifest?.name ?? pluginId,
    trusted: Boolean(source.trusted),
    version: manifest?.version ?? "0.0.0",
  };
}

function loadPackageManifest(packageDir) {
  const packageJson = readJsonSync(path.join(packageDir, "package.json"));
  if (!packageJson) {
    return null;
  }

  const pluginManifest = packageJson.refactorpilotPlugin ?? readJsonSync(path.join(packageDir, "plugin.json"));
  if (!pluginManifest) {
    return null;
  }

  const entryPath = path.resolve(packageDir, pluginManifest.entry ?? packageJson.main ?? "index.js");
  return normalizePluginManifest(
    {
      ...pluginManifest,
      description: pluginManifest.description ?? packageJson.description,
      name: pluginManifest.name ?? packageJson.name,
      version: pluginManifest.version ?? packageJson.version,
    },
    {
      entryPath,
      kind: "package",
      packageName: packageJson.name ?? path.basename(packageDir),
      trusted: false,
    },
  );
}

async function tryLoadVm2() {
  try {
    const mod = await import("vm2");
    return mod.VM ?? mod.NodeVM ?? null;
  } catch {
    return null;
  }
}

function createVmFallbackSandbox(entryPath, code) {
  const module = { exports: {} };
  const sandbox = {
    console,
    module,
    exports: module.exports,
  };
  const context = vm.createContext(sandbox);
  const wrapped = `(function (exports, module) { ${code}\n})`;
  const script = new vm.Script(wrapped, {
    filename: entryPath,
  });
  const evaluator = script.runInContext(context, {
    timeout: 1_000,
  });
  evaluator(module.exports, module);
  return {
    exports: module.exports,
    sandboxEngine: "node-vm-fallback",
  };
}

async function loadUntrustedPluginModule(entryPath) {
  const code = fs.readFileSync(entryPath, "utf8");
  const VM2Class = await tryLoadVm2();

  if (VM2Class) {
    const sandbox = new VM2Class({
      eval: false,
      sandbox: {
        console,
      },
      wasm: false,
    });
    const exports = sandbox.run(`(function () { const module = { exports: {} }; const exports = module.exports; ${code}\n; return module.exports; })()`);
    return {
      exports,
      sandboxEngine: "vm2",
    };
  }

  return createVmFallbackSandbox(entryPath, code);
}

function ensurePluginContract(pluginModule, manifest) {
  const plugin = pluginModule?.default ?? pluginModule?.plugin ?? pluginModule;
  if (!plugin || typeof plugin !== "object") {
    throw new Error(`Invalid plugin module for ${manifest.id}. Expected an exported plugin object.`);
  }

  if (plugin.apiVersion && plugin.apiVersion !== PLUGIN_API_VERSION) {
    throw new Error(`Plugin ${manifest.id} targets API ${plugin.apiVersion}; expected ${PLUGIN_API_VERSION}.`);
  }

  return {
    ...plugin,
    apiVersion: plugin.apiVersion ?? PLUGIN_API_VERSION,
    manifest: {
      ...manifest,
      ...(plugin.manifest ?? {}),
    },
  };
}

export class PluginRegistry {
  constructor(options = {}) {
    this.builtins = new Map();
    this.discoveryRoots = options.discoveryRoots ?? defaultPluginRoots();
    this.includeExternal = options.includeExternal ?? true;
    this.cache = new Map();
  }

  registerBuiltin(manifest, loader) {
    const normalized = normalizePluginManifest(manifest, {
      entryPath: manifest.entryPath ?? `builtin:${manifest.id}`,
      kind: "builtin",
      packageName: manifest.packageName ?? manifest.id,
      trusted: true,
    });
    this.builtins.set(normalized.id, {
      loader,
      manifest: normalized,
    });
    return normalized;
  }

  listPluginManifests() {
    const manifests = [...this.builtins.values()].map((entry) => entry.manifest);
    if (!this.includeExternal) {
      return manifests.sort((left, right) => left.id.localeCompare(right.id));
    }

    for (const root of this.discoveryRoots) {
      for (const packageDir of discoverPackageDirs(root)) {
        const manifest = loadPackageManifest(packageDir);
        if (!manifest) {
          continue;
        }
        if (!manifest.packageName.startsWith(REFACTORPILOT_PLUGIN_PREFIX)) {
          continue;
        }
        manifests.push(manifest);
      }
    }

    const deduped = new Map();
    for (const manifest of manifests) {
      deduped.set(manifest.id, manifest);
    }

    return [...deduped.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  listByCapability(capability) {
    return this.listPluginManifests().filter((manifest) => {
      const bucket = manifest.capabilities?.[capability];
      return Array.isArray(bucket) && bucket.length > 0;
    });
  }

  getManifest(pluginId) {
    return this.listPluginManifests().find((manifest) => manifest.id === pluginId) ?? null;
  }

  async loadPlugin(pluginId) {
    if (this.cache.has(pluginId)) {
      return this.cache.get(pluginId);
    }

    const builtin = this.builtins.get(pluginId);
    if (builtin) {
      const loaded = ensurePluginContract(await builtin.loader(), builtin.manifest);
      this.cache.set(pluginId, loaded);
      return loaded;
    }

    const manifest = this.getManifest(pluginId);
    if (!manifest) {
      throw new Error(`Unknown plugin: ${pluginId}`);
    }

    const loadedModule = manifest.trusted
      ? await import(pathToFileURL(manifest.entryPath).href)
      : await loadUntrustedPluginModule(manifest.entryPath);
    const plugin = ensurePluginContract(loadedModule.exports ?? loadedModule, manifest);
    plugin.runtime = {
      sandboxed: !manifest.trusted,
      sandboxEngine: loadedModule.sandboxEngine ?? "native",
      trusted: manifest.trusted,
    };
    this.cache.set(pluginId, plugin);
    return plugin;
  }
}

export function createPluginRegistry(options = {}) {
  return new PluginRegistry(options);
}
