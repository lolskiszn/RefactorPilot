import { BaseParser } from "./base-parser.js";

function normalizeManifest(manifest, defaults = {}) {
  return Object.freeze({
    description: manifest.description ?? defaults.description ?? "",
    id: manifest.id ?? defaults.id ?? "plugin:unknown",
    language: manifest.language ?? defaults.language ?? "unknown",
    name: manifest.name ?? defaults.name ?? "Unnamed plugin",
    type: manifest.type ?? defaults.type ?? "pattern",
    version: manifest.version ?? defaults.version ?? "0.0.0",
  });
}

export function createPlugin(manifest, implementation = {}) {
  const normalized = normalizeManifest(manifest);

  return Object.freeze({
    manifest: normalized,
    async activate(context = {}) {
      if (typeof implementation.activate === "function") {
        return implementation.activate(context);
      }
      return {
        plugin: normalized,
      };
    },
    async analyze(files = [], context = {}) {
      if (typeof implementation.analyze === "function") {
        return implementation.analyze(files, context);
      }
      return {
        files,
        plugin: normalized,
      };
    },
    async preview(input = {}, context = {}) {
      if (typeof implementation.preview === "function") {
        return implementation.preview(input, context);
      }
      return {
        preview: true,
        plugin: normalized,
        input,
      };
    },
  });
}

export function createLanguageFrontendPlugin(manifest, ParserClass, implementation = {}) {
  if (typeof ParserClass !== "function") {
    throw new TypeError("createLanguageFrontendPlugin requires a parser class.");
  }

  const normalized = normalizeManifest(manifest, {
    type: "language-frontend",
  });

  return createPlugin(normalized, {
    ...implementation,
    activate(context = {}) {
      const parser = new ParserClass(normalized);
      if (typeof implementation.activate === "function") {
        return implementation.activate({ ...context, parser });
      }
      return {
        parser,
        plugin: normalized,
      };
    },
    analyze(files = [], context = {}) {
      const parser = new ParserClass(normalized);
      return parser.analyzeWorkspace(files, context);
    },
  });
}

export function createPatternPlugin(manifest, implementation = {}) {
  return createPlugin(
    normalizeManifest(manifest, {
      type: "pattern",
    }),
    implementation,
  );
}

export function createDeploymentPlugin(manifest, implementation = {}) {
  return createPlugin(
    normalizeManifest(manifest, {
      type: "deployment-strategy",
    }),
    implementation,
  );
}

export { BaseParser };
