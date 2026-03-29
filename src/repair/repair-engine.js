import { parseCompilationIssues } from "./error-parser.js";
import { importFixer } from "./strategies/import-fixer.js";
import { methodGenerator } from "./strategies/method-generator.js";
import { typeAdjuster } from "./strategies/type-adjuster.js";

export const DEFAULT_REPAIR_STRATEGIES = [
  importFixer,
  typeAdjuster,
  methodGenerator,
];

function cloneOutputs(outputs) {
  return (outputs ?? []).map((entry) => ({ ...entry }));
}

export function applyRepairStrategies(outputs, issues, strategies = DEFAULT_REPAIR_STRATEGIES) {
  let nextOutputs = cloneOutputs(outputs);
  const appliedRepairs = [];

  for (const issue of parseCompilationIssues(issues)) {
    for (const strategy of strategies) {
      if (!strategy.canRepair(issue)) {
        continue;
      }
      const result = strategy.repair(nextOutputs, issue);
      if (result?.applied) {
        nextOutputs = result.outputs;
        appliedRepairs.push({
          issue,
          strategy: strategy.id,
          summary: result.summary,
        });
        break;
      }
    }
  }

  return {
    appliedRepairs,
    outputs: nextOutputs,
  };
}

export async function runRepairLoop({ outputs, verify, maxAttempts = 3, strategies = DEFAULT_REPAIR_STRATEGIES }) {
  let workingOutputs = cloneOutputs(outputs);
  const repairHistory = [];
  let attempts = 0;
  let lastResult = await verify(workingOutputs);

  while (!lastResult.success && attempts < maxAttempts) {
    const { appliedRepairs, outputs: repairedOutputs } = applyRepairStrategies(workingOutputs, lastResult.issues, strategies);
    if (appliedRepairs.length === 0) {
      break;
    }
    repairHistory.push(...appliedRepairs);
    workingOutputs = repairedOutputs;
    attempts += 1;
    lastResult = await verify(workingOutputs);
  }

  return {
    attempts,
    outputs: workingOutputs,
    repairHistory,
    success: lastResult.success,
    verification: lastResult,
  };
}
