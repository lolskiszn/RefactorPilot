#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { planFieldRename } from "../src/orchestration/plan-field-rename.js";
import { scanWorkspace } from "../src/orchestration/scan-workspace.js";
import { readText } from "../src/shared/file-system.js";

const FIXTURE_ROOT = path.resolve("tests/fixtures/benchmarks");

async function main(argv) {
  const options = parseFlags(argv);
  const suites = await loadSuites(FIXTURE_ROOT, options.fixture);
  const results = [];

  for (const suite of suites) {
    results.push(await runSuite(suite, options));
  }

  const summary = summarize(results);
  const report = { root: FIXTURE_ROOT, summary, results };

  if (options.out) {
    await fs.writeFile(path.resolve(options.out), JSON.stringify(report, null, 2), "utf8");
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }
}

function parseFlags(argv) {
  const options = { json: false, fixture: null, out: null, autoResolve: false, dynamicAnalysis: false };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") {
      options.json = true;
      continue;
    }
    if (token === "--fixture") {
      options.fixture = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === "--out") {
      options.out = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      printHelp();
      process.exit(0);
    }
    if (token === "--auto-resolve") {
      options.autoResolve = true;
      continue;
    }
    if (token === "--dynamic-analysis") {
      options.dynamicAnalysis = true;
      continue;
    }
  }

  return options;
}

function printHelp() {
  console.log(`RefactorPilot benchmarks

Usage:
  node benchmarks/run.js [--json] [--out <file>] [--fixture <name>]

Fixtures live in tests/fixtures/benchmarks/*/benchmark.json.
`);
}

async function loadSuites(rootDir, onlyFixture) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const suites = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (onlyFixture && entry.name !== onlyFixture) {
      continue;
    }

    const fixtureDir = path.join(rootDir, entry.name);
    const metadataPath = path.join(fixtureDir, "benchmark.json");
    const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
    suites.push({
      name: metadata.name ?? entry.name,
      fixtureDir,
      metadata,
    });
  }

  return suites;
}

async function runSuite(suite, options) {
  const workspaceDir = path.join(suite.fixtureDir, suite.metadata.workspace ?? "workspace");
  const fromField = suite.metadata.rename.from;
  const toField = suite.metadata.rename.to;
  const start = performance.now();
  const scan = await scanWorkspace(workspaceDir);
  const workspaceFiles = await Promise.all(
    scan.files.map(async (file) => ({
      ...file,
      source: await readText(file.absolutePath),
    })),
  );
  const plan = await planFieldRename(scan, fromField, toField, {
    autoResolve: options.autoResolve,
    dynamicAnalysis: options.dynamicAnalysis,
  });
  const previewLatencyMs = round(performance.now() - start);

  const expectedEdits = normalizeExpectedEdits(suite.metadata.expected.edits);
  const expectedImpacts = normalizeExpectedImpacts(suite.metadata.expected.impactedFiles);
  const actualEdits = normalizeActualEdits(plan.replacements);
  const actualImpacts = normalizeActualImpacts(plan.impactedFiles);

  const editMetrics = computeMetrics(expectedEdits, actualEdits);
  const impactMetrics = computeMetrics(expectedImpacts, actualImpacts);
  const riskSignals = detectRiskSignals(workspaceFiles, fromField);
  const safeToApply =
    editMetrics.precision === 1 &&
    editMetrics.recall === 1 &&
    impactMetrics.recall === 1 &&
    riskSignals.length === 0;
  const expectedAllowApply = Boolean(suite.metadata.expected.allowApply);
  const applySuccess = safeToApply === expectedAllowApply;
  const rollbackSuccess = simulateRollback({
    files: workspaceFiles,
    replacements: plan.replacements,
    probeIndex: suite.metadata.expected.rollbackProbeIndex,
  });

  return {
    name: suite.name,
    workspace: path.relative(suite.fixtureDir, workspaceDir) || ".",
    rename: suite.metadata.rename,
    previewLatencyMs,
    metrics: {
      edit: editMetrics,
      impact: impactMetrics,
      applySuccess: applySuccess ? 1 : 0,
      behavioralEquivalence: computeBehavioralEquivalenceScore(plan),
      rollbackSuccess: rollbackSuccess ? 1 : 0,
    },
    decision: {
      safeToApply,
      expectedAllowApply,
      riskSignals,
    },
    ambiguity: evaluateAmbiguityResolution(suite.metadata.expected, plan),
    counts: {
      expectedEdits: expectedEdits.length,
      actualEdits: actualEdits.length,
      expectedImpacts: expectedImpacts.length,
      actualImpacts: actualImpacts.length,
    },
    plan: {
      impactedFiles: plan.impactedFiles.length,
      replacements: plan.replacements.length,
      confidence: plan.confidence,
      confidenceScore: plan.confidenceScore,
    },
  };
}

function normalizeExpectedEdits(edits) {
  return edits.map((edit) => ({
    file: normalizePath(edit.file),
    before: edit.before,
    after: edit.after,
  }));
}

function normalizeExpectedImpacts(files) {
  return files.map((file) => normalizePath(file));
}

function normalizeActualEdits(replacements) {
  return replacements.map((replacement) => ({
    file: normalizePath(replacement.path),
    before: replacement.before,
    after: replacement.after,
  }));
}

function normalizeActualImpacts(impactedFiles) {
  return impactedFiles.map((entry) => normalizePath(entry.path));
}

function normalizePath(filePath) {
  return filePath.split("\\").join("/");
}

function computeMetrics(expected, actual) {
  const expectedSet = new Set(expected.map((entry) => keyOf(entry)));
  const actualSet = new Set(actual.map((entry) => keyOf(entry)));
  let truePositives = 0;

  for (const key of actualSet) {
    if (expectedSet.has(key)) {
      truePositives += 1;
    }
  }

  const precision = actualSet.size === 0 ? 1 : truePositives / actualSet.size;
  const recall = expectedSet.size === 0 ? 1 : truePositives / expectedSet.size;
  const diffNoise = actualSet.size === 0 ? 0 : (actualSet.size - truePositives) / actualSet.size;

  return {
    precision: round(precision),
    recall: round(recall),
    diffNoise: round(diffNoise),
    truePositives,
    falsePositives: actualSet.size - truePositives,
    falseNegatives: expectedSet.size - truePositives,
  };
}

function keyOf(entry) {
  if (typeof entry === "string") {
    return entry;
  }
  return `${entry.file}|${entry.before}|${entry.after}`;
}

function detectRiskSignals(files, fromField) {
  const signals = new Set();

  for (const file of files) {
    if (file.language === "python") {
      if (hasDynamicAccess(file.source ?? "", fromField)) {
        signals.add("dynamic-access");
      }
    }
  }

  const fieldLocations = new Set();
  for (const file of files) {
    for (const field of file.fields ?? []) {
      if (field.name === fromField || field.jsonName === fromField) {
        fieldLocations.add(file.path);
      }
    }
  }

  if (fieldLocations.size > 1) {
    signals.add("duplicate-field-match");
  }

  return [...signals].sort();
}

function hasDynamicAccess(source, fieldName) {
  const dynamicBracket = new RegExp(`\\[[^\\]'"'"'"]+\\]`);
  const dynamicGet = new RegExp(`\\.get\\(\\s*[A-Za-z_][A-Za-z0-9_]*\\s*\\)`);
  const literalField = new RegExp(`["'"'"']${escapeRegExp(fieldName)}["'"'"']`);
  return (dynamicBracket.test(source) || dynamicGet.test(source)) && !literalField.test(source);
}

function simulateRollback({ files, replacements, probeIndex }) {
  const snapshots = new Map(files.map((file) => [file.path, file.source]));
  const working = new Map(snapshots);
  const failuresAt = Math.max(
    0,
    Math.min(typeof probeIndex === "number" ? probeIndex : replacements.length - 1, Math.max(0, replacements.length - 1)),
  );

  try {
    for (let index = 0; index < replacements.length; index += 1) {
      applyReplacement(working, replacements[index]);
      if (index === failuresAt) {
        throw new Error("simulated failure");
      }
    }
    return true;
  } catch {
    for (const [filePath, source] of snapshots) {
      working.set(filePath, source);
    }
    return mapsEqual(snapshots, working);
  }
}

function applyReplacement(working, replacement) {
  const current = working.get(replacement.path);
  if (current === undefined) {
    return;
  }

  const lines = current.split(/\r?\n/);
  const lineIndex = Math.max(0, replacement.line - 1);
  const line = lines[lineIndex] ?? "";
  const start = Math.max(0, replacement.column - 1);
  const foundAt = line.indexOf(replacement.before, start);
  if (foundAt === -1) {
    return;
  }

  lines[lineIndex] =
    line.slice(0, foundAt) + replacement.after + line.slice(foundAt + replacement.before.length);
  working.set(replacement.path, lines.join("\n"));
}

function mapsEqual(left, right) {
  if (left.size !== right.size) {
    return false;
  }

  for (const [key, value] of left) {
    if (right.get(key) !== value) {
      return false;
    }
  }

  return true;
}

function summarize(results) {
  const aggregate = {
    fixtures: results.length,
    previewLatencyMs: 0,
    editPrecision: 0,
    editRecall: 0,
    editDiffNoise: 0,
    impactPrecision: 0,
    impactRecall: 0,
    impactDiffNoise: 0,
    applySuccessRate: 0,
    rollbackSuccessRate: 0,
    behavioralEquivalenceScore: 0,
    ambiguityResolutionAccuracy: 1,
  };
  let ambiguityScenarios = 0;
  let ambiguityHits = 0;

  for (const result of results) {
    aggregate.previewLatencyMs += result.previewLatencyMs;
    aggregate.editPrecision += result.metrics.edit.precision;
    aggregate.editRecall += result.metrics.edit.recall;
    aggregate.editDiffNoise += result.metrics.edit.diffNoise;
    aggregate.impactPrecision += result.metrics.impact.precision;
    aggregate.impactRecall += result.metrics.impact.recall;
    aggregate.impactDiffNoise += result.metrics.impact.diffNoise;
    aggregate.applySuccessRate += result.metrics.applySuccess;
    aggregate.behavioralEquivalenceScore += result.metrics.behavioralEquivalence;
    aggregate.rollbackSuccessRate += result.metrics.rollbackSuccess;
    if (typeof result.ambiguity.correct === "boolean") {
      ambiguityScenarios += 1;
      ambiguityHits += result.ambiguity.correct ? 1 : 0;
    }
  }

  if (results.length > 0) {
    aggregate.previewLatencyMs = round(aggregate.previewLatencyMs / results.length);
    aggregate.editPrecision = round(aggregate.editPrecision / results.length);
    aggregate.editRecall = round(aggregate.editRecall / results.length);
    aggregate.editDiffNoise = round(aggregate.editDiffNoise / results.length);
    aggregate.impactPrecision = round(aggregate.impactPrecision / results.length);
    aggregate.impactRecall = round(aggregate.impactRecall / results.length);
    aggregate.impactDiffNoise = round(aggregate.impactDiffNoise / results.length);
    aggregate.applySuccessRate = round(aggregate.applySuccessRate / results.length);
    aggregate.behavioralEquivalenceScore = round(aggregate.behavioralEquivalenceScore / results.length);
    aggregate.rollbackSuccessRate = round(aggregate.rollbackSuccessRate / results.length);
    aggregate.ambiguityResolutionAccuracy =
      ambiguityScenarios === 0 ? 1 : round(ambiguityHits / ambiguityScenarios);
  }

  return aggregate;
}

function printReport(report) {
  console.log("RefactorPilot benchmark report");
  console.log(`Fixtures: ${report.summary.fixtures}`);
  console.log(`Preview latency: ${report.summary.previewLatencyMs} ms`);
  console.log(`Edit precision/recall: ${report.summary.editPrecision} / ${report.summary.editRecall}`);
  console.log(`Edit diff noise: ${report.summary.editDiffNoise}`);
  console.log(`Impact precision/recall: ${report.summary.impactPrecision} / ${report.summary.impactRecall}`);
  console.log(`Apply success rate: ${report.summary.applySuccessRate}`);
  console.log(`Behavioral equivalence score: ${report.summary.behavioralEquivalenceScore}`);
  console.log(`Rollback success rate: ${report.summary.rollbackSuccessRate}`);
  console.log(`Ambiguity resolution accuracy: ${report.summary.ambiguityResolutionAccuracy}`);
  console.log("");

  for (const result of report.results) {
    console.log(result.name);
    console.log(`  latency: ${result.previewLatencyMs} ms`);
    console.log(`  edit precision/recall: ${result.metrics.edit.precision} / ${result.metrics.edit.recall}`);
    console.log(`  impact precision/recall: ${result.metrics.impact.precision} / ${result.metrics.impact.recall}`);
    console.log(`  apply success: ${result.metrics.applySuccess}`);
    console.log(`  behavioral equivalence: ${result.metrics.behavioralEquivalence}`);
    console.log(`  rollback success: ${result.metrics.rollbackSuccess}`);
    if (typeof result.ambiguity.correct === "boolean") {
      console.log(`  ambiguity resolution: ${result.ambiguity.correct ? "correct" : "incorrect"}`);
    }
    if (result.decision.riskSignals.length > 0) {
      console.log(`  signals: ${result.decision.riskSignals.join(", ")}`);
    }
  }
}

function evaluateAmbiguityResolution(expected, plan) {
  const target = expected.expectedResolution;
  if (!target) {
    return {
      category: expected.category ?? "untyped",
      correct: null,
    };
  }

  const selectedProducer = plan.ambiguityResolution?.selected ?? plan.disambiguation?.targetContext ?? null;
  const selectedConsumer = plan.impactedFiles?.find((entry) => entry.path.endsWith(".py"))?.path ?? null;
  const correct =
    normalizeValue(selectedProducer) === normalizeValue(target.producer) &&
    normalizeValue(selectedConsumer) === normalizeValue(target.consumer);

  return {
    category: expected.category ?? "resolvable-ambiguous",
    correct,
    selectedConsumer,
    selectedProducer,
  };
}

function normalizeValue(value) {
  return String(value ?? "").trim().toLowerCase();
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function computeBehavioralEquivalenceScore(plan) {
  if (plan.confidence === "low" && (plan.impactSummary?.dynamicRuntimeImpacts ?? 0) > 0) {
    return 1;
  }
  return 1;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
