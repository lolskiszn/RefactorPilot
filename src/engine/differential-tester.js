import path from "node:path";
import { loadReplayFixture, compareReplayFixtures } from "../testing/replay-engine.js";

function buildMigratedFixture(originalFixture, plan) {
  return {
    ...originalFixture,
    events: (originalFixture.events ?? []).map((event) => ({
      ...event,
      response: {
        ...event.response,
        body: renameKeys(event.response.body, plan.fromField, plan.toField),
      },
    })),
  };
}

function renameKeys(value, fromField, toField) {
  if (Array.isArray(value)) {
    return value.map((item) => renameKeys(item, fromField, toField));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key === fromField ? toField : key,
        renameKeys(item, fromField, toField),
      ]),
    );
  }
  return value;
}

export async function runDifferentialTest(plan, options = {}) {
  const fixturePath = options.replayFixturePath
    ? path.resolve(options.replayFixturePath)
    : options.workspaceRoot
      ? path.join(path.resolve(options.workspaceRoot), ".refactorpilot", "replay-traces", "baseline.json")
      : null;
  if (!fixturePath) {
    return {
      checked: false,
      equivalent: null,
      reason: "no-replay-fixture",
      score: 1,
    };
  }

  try {
    const originalFixture = await loadReplayFixture(fixturePath);
    const migratedFixture = options.migratedFixture ?? buildMigratedFixture(originalFixture, plan);
    const comparison = compareReplayFixtures(originalFixture, migratedFixture, {
      mode: options.mode ?? "semantic",
      plan,
    });
    return {
      checked: true,
      equivalent: comparison.equivalent,
      fixturePath,
      mode: comparison.mode,
      score: comparison.equivalent ? 1 : 0,
      divergences: comparison.divergences,
    };
  } catch (error) {
    return {
      checked: false,
      equivalent: null,
      error: error.message,
      fixturePath,
      reason: "fixture-load-failed",
      score: 0,
    };
  }
}
