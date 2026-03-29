import { executeProtocPlan } from "../codegen/protoc-executor.js";
import { runRepairLoop } from "../repair/repair-engine.js";
import { verifyGoCompilation } from "./go-compiler.js";
import { verifyPythonCompilation } from "./python-compiler.js";
import { proveSemanticEquivalence } from "./semantic-prover.js";

function summarizeCompilation(protoc, go, python) {
  const passed = [protoc, go, python].every((entry) => entry.passed !== false);
  const checked = [protoc, go, python].some((entry) => entry.checked);
  return {
    allPassed: passed,
    checked,
    issues: [...(protoc.issues ?? []), ...(go.issues ?? []), ...(python.issues ?? [])],
    protoc,
    go,
    python,
  };
}

function determineTier(summary) {
  if (summary.compilation.allPassed && summary.semantic.equivalent && summary.repairs.length === 0) {
    return "auto-transform";
  }
  if (summary.compilation.allPassed) {
    return "assisted-transform";
  }
  return "guided-manual";
}

export async function runVerifiedTransformation(changeSet, options = {}) {
  async function verify(outputs) {
    const protoc = await executeProtocPlan(changeSet.protocPlan, {
      outputs,
      runner: options.protocRunner,
    });
    const go = await verifyGoCompilation(outputs, {
      runner: options.goRunner,
      workspace: options.workspace,
    });
    const python = await verifyPythonCompilation(outputs, {
      runner: options.pythonRunner,
      workspace: options.workspace,
    });
    const semantic = await proveSemanticEquivalence({
      ...changeSet,
      outputs,
    }, {
      compare: options.semanticCompare,
    });
    const compilation = summarizeCompilation(protoc, go, python);
    return {
      compilation,
      issues: [...compilation.issues, ...(semantic.issues ?? [])],
      semantic,
      success: compilation.allPassed,
    };
  }

  const repairResult = await runRepairLoop({
    maxAttempts: options.maxRepairAttempts ?? 3,
    outputs: changeSet.outputs,
    verify,
  });

  const summary = {
    attempts: repairResult.attempts,
    canAutoApply: repairResult.success && repairResult.verification.semantic.equivalent,
    compilation: repairResult.verification.compilation,
    outputs: repairResult.outputs,
    repairs: repairResult.repairHistory,
    semantic: repairResult.verification.semantic,
  };

  return {
    ...summary,
    status: summary.canAutoApply ? "verified" : summary.compilation.allPassed ? "assisted" : "manual-review",
    tier: determineTier(summary),
  };
}
