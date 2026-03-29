function normalizeId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function validatePatternManifest(manifest) {
  const issues = [];

  if (!manifest?.name) {
    issues.push("Pattern name is required.");
  }
  if (!manifest?.version) {
    issues.push("Pattern version is required.");
  }
  if (!Array.isArray(manifest?.languages) || manifest.languages.length === 0) {
    issues.push("At least one supported language is required.");
  }
  if (!["declarative", "wasm", "javascript"].includes(manifest?.runtime)) {
    issues.push("Pattern runtime must be declarative, wasm, or javascript.");
  }

  return {
    issues,
    valid: issues.length === 0,
  };
}

export function buildSandboxExecutionPlan(manifest) {
  return {
    filesystem: {
      readOnly: true,
      writablePaths: ["/tmp"],
    },
    limits: {
      cpuSeconds: 30,
      memoryMb: 256,
      network: "disabled",
    },
    runtime: manifest.runtime,
    vm: "firecracker",
  };
}

export function createMarketplaceEntry(manifest, author) {
  const validation = validatePatternManifest(manifest);
  if (!validation.valid) {
    throw new Error(`Invalid pattern manifest: ${validation.issues.join("; ")}`);
  }

  return {
    author: {
      id: normalizeId(author?.id ?? author?.name ?? "author"),
      name: author?.name ?? "Unknown author",
      verified: Boolean(author?.verified),
    },
    id: normalizeId(`${manifest.name}-${manifest.version}`),
    manifest,
    monetization: {
      split: "70/30",
      stripeConnectRequired: true,
    },
    sandbox: buildSandboxExecutionPlan(manifest),
    status: "pending_review",
  };
}
