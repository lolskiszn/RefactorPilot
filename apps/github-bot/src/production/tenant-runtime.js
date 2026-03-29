function normalizeSlug(value, fallback = "tenant") {
  return String(value ?? fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

export function buildTenantRuntimeSpec(installation, options = {}) {
  const tenantId = normalizeSlug(installation?.account?.login ?? installation?.id ?? "tenant");
  const queuePrefix = `refactorpilot:${tenantId}`;

  return {
    tenantId,
    isolation: {
      ephemeralWorkspaceTtlHours: options.ephemeralWorkspaceTtlHours ?? 24,
      metadataOnlyPersistence: true,
      persistentSourceCodeStorage: false,
      secretScope: `kv/refactorpilot/${tenantId}`,
    },
    queues: {
      analysis: `${queuePrefix}:analysis`,
      migrations: `${queuePrefix}:migrations`,
      reporting: `${queuePrefix}:reporting`,
    },
    storage: {
      artifactsPrefix: `s3://refactorpilot-artifacts/${tenantId}/`,
      encrypted: true,
      retentionHours: options.retentionHours ?? 24,
    },
    webhooks: {
      retryPolicy: {
        baseDelayMs: 1_000,
        maxAttempts: 5,
      },
      webhookPrefix: queuePrefix,
    },
  };
}

export function buildInstallationMeteringEvent({ installationId, privateRepos = 0, seats = 0, migrationsRun = 0 }) {
  return {
    dimensions: {
      migrationsRun,
      privateRepos,
      seats,
    },
    installationId,
    meter: "github-app-usage",
  };
}
