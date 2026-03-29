export const DEPLOYMENT_STRATEGY_API_VERSION = "1.0.0";

function freezeDescriptor(descriptor) {
  return Object.freeze({
    ...descriptor,
    capabilities: Object.freeze([...(descriptor.capabilities ?? [])]),
    metadata: Object.freeze({ ...(descriptor.metadata ?? {}) }),
  });
}

function normalizeMode(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function clonePhases(phases) {
  return phases.map((phase) => ({
    ...phase,
    checks: [...(phase.checks ?? [])],
  }));
}

export class DeploymentStrategy {
  constructor(descriptor) {
    if (!descriptor || typeof descriptor !== "object") {
      throw new TypeError("DeploymentStrategy requires a descriptor object");
    }
    if (!descriptor.id) {
      throw new TypeError("DeploymentStrategy descriptor requires an id");
    }

    this._descriptor = freezeDescriptor({
      capabilities: [],
      metadata: {},
      version: DEPLOYMENT_STRATEGY_API_VERSION,
      ...descriptor,
    });
  }

  get descriptor() {
    return this._descriptor;
  }

  get id() {
    return this._descriptor.id;
  }

  describe() {
    return this._descriptor;
  }

  supports(request = {}) {
    const mode = normalizeMode(request.mode ?? request.strategy ?? request.deploymentMode);
    if (mode && this._descriptor.modes?.length) {
      return this._descriptor.modes.includes(mode);
    }
    return true;
  }

  buildPlan(request = {}) {
    return {
      apiVersion: DEPLOYMENT_STRATEGY_API_VERSION,
      request: { ...request },
      strategy: this._descriptor.id,
    };
  }

  async prepare(request = {}) {
    return {
      plan: this.buildPlan(request),
      strategy: this._descriptor.id,
    };
  }

  async execute(request = {}) {
    return {
      plan: this.buildPlan(request),
      status: "completed",
      strategy: this._descriptor.id,
    };
  }

  async rollback(executionResult = {}) {
    return {
      reverted: true,
      strategy: this._descriptor.id,
      targetStatus: executionResult.status ?? "completed",
    };
  }
}

export class PreviewOnlyDeploymentStrategy extends DeploymentStrategy {
  constructor() {
    super({
      capabilities: ["preview", "read-only"],
      id: "preview-only",
      metadata: {
        safety: "read-only",
      },
      modes: ["preview"],
      name: "Preview Only",
    });
  }

  buildPlan(request = {}) {
    return {
      ...super.buildPlan(request),
      actions: [],
      dryRun: true,
      previewOnly: true,
      risk: "none",
    };
  }

  async execute(request = {}) {
    const plan = this.buildPlan(request);
    return {
      plan,
      status: "previewed",
      strategy: this.id,
    };
  }
}

export class InPlaceDeploymentStrategy extends DeploymentStrategy {
  constructor() {
    super({
      capabilities: ["write", "local"],
      id: "in-place",
      metadata: {
        safety: "guarded-write",
      },
      modes: ["write", "dry-run"],
      name: "In Place",
    });
  }

  buildPlan(request = {}) {
    return {
      ...super.buildPlan(request),
      actions: ["validate", "write", "verify"],
      dryRun: normalizeMode(request.mode) === "dry-run",
      previewOnly: false,
      target: request.workspace ?? null,
    };
  }

  async execute(request = {}) {
    const plan = this.buildPlan(request);
    return {
      changes: request.changes ?? [],
      plan,
      status: plan.dryRun ? "dry-run" : "applied",
      strategy: this.id,
    };
  }
}

export class SandboxDeploymentStrategy extends DeploymentStrategy {
  constructor() {
    super({
      capabilities: ["sandbox", "ephemeral"],
      id: "sandbox",
      metadata: {
        isolation: "ephemeral-workspace",
      },
      modes: ["sandbox", "write", "dry-run"],
      name: "Sandbox",
    });
  }

  buildPlan(request = {}) {
    return {
      ...super.buildPlan(request),
      actions: ["clone", "analyze", "mutate-copy", "verify"],
      dryRun: false,
      previewOnly: false,
      sandbox: {
        isolatedWorkspace: true,
        sourceWorkspace: request.workspace ?? null,
      },
    };
  }

  async execute(request = {}) {
    const plan = this.buildPlan(request);
    return {
      plan,
      sandbox: plan.sandbox,
      status: "sandboxed",
      strategy: this.id,
    };
  }
}

export class ProgressiveDeploymentStrategy extends DeploymentStrategy {
  constructor() {
    super({
      capabilities: ["canary", "blue-green", "progressive"],
      id: "progressive",
      metadata: {
        rollout: "phased",
      },
      modes: ["progressive", "write"],
      name: "Progressive Rollout",
    });
  }

  buildPlan(request = {}) {
    const phases = clonePhases(
      request.phases ?? [
        { percentage: 1, name: "canary" },
        { percentage: 10, name: "early-adopters" },
        { percentage: 100, name: "full-rollout" },
      ],
    );

    return {
      ...super.buildPlan(request),
      actions: ["deploy-canary", "observe", "expand", "complete"],
      dryRun: false,
      phases,
      previewOnly: false,
    };
  }

  async execute(request = {}) {
    const plan = this.buildPlan(request);
    return {
      plan,
      phases: plan.phases,
      status: "progressive",
      strategy: this.id,
    };
  }
}

export function listDeploymentStrategies() {
  return [
    new PreviewOnlyDeploymentStrategy(),
    new InPlaceDeploymentStrategy(),
    new SandboxDeploymentStrategy(),
    new ProgressiveDeploymentStrategy(),
  ];
}

export function createDeploymentStrategyRegistry(strategies = listDeploymentStrategies()) {
  const registry = new Map();

  for (const strategy of strategies) {
    const descriptor = typeof strategy.describe === "function" ? strategy.describe() : strategy;
    if (!descriptor?.id) {
      throw new TypeError("Strategy descriptors must include an id");
    }
    registry.set(descriptor.id, strategy);
  }

  return {
    get(id) {
      return registry.get(id) ?? null;
    },
    list() {
      return [...registry.values()];
    },
    register(strategy) {
      const descriptor = typeof strategy.describe === "function" ? strategy.describe() : strategy;
      if (!descriptor?.id) {
        throw new TypeError("Strategy descriptors must include an id");
      }
      registry.set(descriptor.id, strategy);
      return this;
    },
    resolve(request = {}) {
      const requested = normalizeMode(request.mode ?? request.strategy ?? request.deploymentMode);
      if (requested && registry.has(requested)) {
        return registry.get(requested);
      }

      for (const strategy of registry.values()) {
        if (typeof strategy.supports === "function" && strategy.supports(request)) {
          return strategy;
        }
      }

      return null;
    },
  };
}

export const defaultDeploymentStrategyRegistry = createDeploymentStrategyRegistry();
