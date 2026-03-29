import { collectDynamicTraceHints } from "../runtime/tracer.js";
import { executeSymbolicSlice } from "./symbolic-executor.js";

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function hasDynamicUsage(file) {
  return (file.fieldUsages ?? []).some((usage) => usage.dynamic || usage.kind === "dict_key_dynamic");
}

function hasPotentialDynamicFlow(file) {
  const source = String(file.source ?? "");
  return (
    hasDynamicUsage(file) ||
    /\[[A-Za-z_][A-Za-z0-9_]*\]/.test(source) ||
    /\.get\(\s*[A-Za-z_][A-Za-z0-9_]*\s*\)/.test(source) ||
    /getattr\(|locals\(\)\[|kwargs/.test(source)
  );
}

export function buildTaintReport(scanResult, targetField) {
  const trace = collectDynamicTraceHints(scanResult, targetField);
  const dynamicImpacts = [];
  const sources = [];

  for (const file of scanResult.files ?? []) {
    const fieldMatch = (file.fields ?? []).some((field) => normalize(field.jsonName ?? field.name) === normalize(targetField));
    if (fieldMatch) {
      sources.push(file.path);
    }
  }

  for (const file of scanResult.files ?? []) {
    if (!hasPotentialDynamicFlow(file)) {
      continue;
    }

    const symbolic = executeSymbolicSlice(file, targetField);
    dynamicImpacts.push({
      file: file.path,
      language: file.language,
      reason: "Dynamic field selector may consume the migrated contract at runtime.",
      sinks: symbolic.sinks,
      symbolic,
      traceEvents: trace.events.filter((event) => event.file === file.path),
    });
  }

  return {
    dynamicImpacts,
    sources,
    trace,
  };
}
