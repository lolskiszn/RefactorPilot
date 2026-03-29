#!/usr/bin/env node
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

function parseFlags(args) {
  const flags = {};

  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (!item.startsWith("--")) {
      continue;
    }

    const name = item.slice(2);
    const next = args[index + 1];

    if (next && !next.startsWith("--")) {
      flags[name] = next;
      index += 1;
    } else {
      flags[name] = true;
    }
  }

  return flags;
}

function parseArgs(args) {
  const flags = {};
  const positionals = [];

  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (!item.startsWith("--")) {
      positionals.push(item);
      continue;
    }

    const name = item.slice(2);
    const next = args[index + 1];

    if (next && !next.startsWith("--")) {
      flags[name] = next;
      index += 1;
    } else {
      flags[name] = true;
    }
  }

  return { flags, positionals };
}

function printHelp() {
  console.log(`RefactorPilot

Usage:
  refactor-pilot scan <workspace>
  refactor-pilot migrate api-contract <workspace> --from <old> --to <new> [--mode preview|dry-run|write]
  refactor-pilot migrate protocol <workspace> --from rest --to grpc [--json]
  refactor-pilot plan-rename <workspace> --field <old> --to <new>
  refactor-pilot preview <workspace> --field <old> --to <new>
  refactor-pilot preview <workspace> --pattern <pattern-id>
  refactor-pilot apply <workspace> --field <old> --to <new> [--mode dry-run|write|sandbox]
  refactor-pilot apply <workspace> --pattern <pattern-id> [--strategy bluegreen --confirm-production]
  refactor-pilot patterns
  refactor-pilot doctor
  refactor-pilot verify <workspace>
  refactor-pilot serve <workspace> [--port 3333] [--host 127.0.0.1]

Options:
  --json        Emit machine-readable JSON output
  --format html Write a shareable HTML preview
  --output PATH Write HTML preview to PATH
  --interactive Prompt through ambiguous matches
  --auto-resolve Attempt safe non-interactive ambiguity resolution
  --dynamic-analysis Expand impact detection with runtime-style heuristics
  --allow-schema-change Permit apply when database-side effects are detected
  --pattern NAME Select a plugin-backed migration pattern
  --strategy NAME Select a deployment strategy for pattern apply
  --confirm-production Allow production-oriented deployment asset generation
  --require-verified Block pattern apply unless verified transformation passes
  --replay-fixture PATH Use replay fixture for differential testing
  --equivalence strict|semantic|schema-only Choose differential comparison mode
  --target-context NAME Select one ambiguity context directly
  --help        Show this help text
`);
}

function getRenameField(flags) {
  return flags.field || flags.from || null;
}

export async function main(argv, runtime = {}) {
  const [command, targetPath = ".", ...rest] = argv;
  const workspace = path.resolve(targetPath);

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  if (command === "scan") {
    const { scanWorkspace } = await import("../orchestration/index.js");
    const scan = await scanWorkspace(workspace);
    if (rest.includes("--json")) {
      printJson({
        rootDir: scan.rootDir,
        fileCount: scan.files.length,
        graph: {
          nodeCount: scan.graph.nodes.length,
          edgeCount: scan.graph.edges.length,
        },
        parserModes: [...new Set(scan.files.map((file) => file.parser?.maturity ?? "heuristic"))],
        files: scan.files,
      });
      return;
    }

    console.log(`Scanned ${scan.files.length} files in ${scan.rootDir}`);
    console.log(`Graph: ${scan.graph.nodes.length} nodes, ${scan.graph.edges.length} edges`);
    return;
  }

  if (command === "migrate") {
    const { formatPreviewReport, migrateApiContract } = await import("../orchestration/index.js");
    const migrationType = targetPath;
    const migrationArgs = rest;
    const { flags: options, positionals } = parseArgs(migrationArgs);
    const migrationWorkspace = path.resolve(positionals[0] ?? ".");

    if (migrationType === "api-contract") {
      const field = getRenameField(options);
      if (!field || !options.to) {
        throw new Error("Missing required flags: --from/--field <name> --to <name>");
      }

      const report = await migrateApiContract(migrationWorkspace, field, options.to, {
        allowSchemaChange: Boolean(options["allow-schema-change"]),
        autoResolve: Boolean(options["auto-resolve"]),
        dynamicAnalysis: Boolean(options["dynamic-analysis"]),
        includeAllAmbiguous: Boolean(options["include-all-ambiguous"]),
        mode: options.mode ?? "preview",
        targetContext: options["target-context"] ?? null,
      });
      const finalReport =
        options.interactive && !options["target-context"]
          ? await rerunInteractiveContractMigration(migrationWorkspace, field, options.to, report, runtime, {
              mode: options.mode ?? "preview",
            })
          : report;

      if (options.json) {
        printJson(finalReport);
        return;
      }

      if (options.format === "html") {
        await writeHtmlReport(finalReport, options.output);
        return;
      }

      console.log(formatPreviewReport(finalReport));
      if (finalReport.apply) {
        console.log("");
        console.log(`Apply status: ${finalReport.apply.status}`);
        if (finalReport.apply.backupRoot) {
          console.log(`Backups: ${finalReport.apply.backupRoot}`);
        }
      }
      return;
    }

    if (migrationType === "protocol") {
      const { previewRestToGrpcMigration } = await import("../patterns/index.js");
      const from = String(options.from ?? "").toLowerCase();
      const to = String(options.to ?? "").toLowerCase();
      if (from !== "rest" || to !== "grpc") {
        throw new Error("Unsupported protocol migration. Use: migrate protocol <workspace> --from rest --to grpc");
      }

      const artifact = await previewRestToGrpcMigration(migrationWorkspace);
      if (options.json) {
        printJson(artifact);
        return;
      }

      console.log(renderProtocolArtifact(artifact));
      return;
    }

    throw new Error("Missing or unsupported migration type. Use: migrate api-contract or migrate protocol");
  }

  if (command === "plan-rename") {
    const { formatPreviewReport, planFieldRename, scanWorkspace } = await import("../orchestration/index.js");
    const options = parseFlags(rest);
    const field = getRenameField(options);
    if (!field || !options.to) {
      throw new Error("Missing required flags: --field <name> --to <name>");
    }

    const scan = await scanWorkspace(workspace);
    const plan = await planFieldRename(scan, field, options.to, {
      autoResolve: Boolean(options["auto-resolve"]),
      dynamicAnalysis: Boolean(options["dynamic-analysis"]),
      includeAllAmbiguous: Boolean(options["include-all-ambiguous"]),
      targetContext: options["target-context"] ?? null,
    });
    if (options.json) {
      printJson(plan);
      return;
    }

    console.log(
      formatPreviewReport({
        workspace: scan.rootDir,
        transformation: plan.transformation,
        fromField: field,
        toField: options.to,
        scan,
        plan,
        summary: {
          scannedFiles: scan.files.length,
          graphNodes: scan.graph.nodes.length,
          graphEdges: scan.graph.edges.length,
          impactedFiles: plan.summary.impactedFileCount,
          replacementCount: plan.summary.replacementCount,
          confidence: plan.confidence,
          confidenceScore: plan.confidenceScore,
        },
      }),
    );
    return;
  }

  if (command === "preview") {
    const { formatPreviewReport, previewFieldRename } = await import("../orchestration/index.js");
    const { previewPatternMigration } = await import("../patterns/index.js");
    const options = parseFlags(rest);
    if (options.pattern) {
      const report = await previewPatternMigration(options.pattern, workspace, options);
      if (options.json) {
        printJson(report);
        return;
      }
      if (options.format === "html") {
        await writeHtmlReport(report, options.output);
        return;
      }
      console.log(renderPatternReport(report));
      return;
    }
    const field = getRenameField(options);
    if (!field || !options.to) {
      throw new Error("Missing required flags: --field <name> --to <name>");
    }

    const initialReport = await previewFieldRename(workspace, field, options.to, {
      autoResolve: Boolean(options["auto-resolve"]),
      dynamicAnalysis: Boolean(options["dynamic-analysis"]),
      includeAllAmbiguous: Boolean(options["include-all-ambiguous"]),
      targetContext: options["target-context"] ?? null,
    });
    const report =
      options.interactive && !options["target-context"]
        ? await rerunInteractivePreview(workspace, field, options.to, initialReport, runtime)
        : initialReport;
    if (options.json) {
      printJson(report);
      return;
    }

    if (options.format === "html") {
      await writeHtmlReport(report, options.output);
      return;
    }

    console.log(formatPreviewReport(report));
    return;
  }

  if (command === "apply") {
    const { applyFieldRename, formatPreviewReport, previewFieldRename } = await import("../orchestration/index.js");
    const { transformPatternMigration } = await import("../patterns/index.js");
    const { buildBlueGreenDeploymentAssets } = await import("../deployment/strategies/bluegreen.js");
    const { runSandboxApply } = await import("./apply.js");
    const options = parseFlags(rest);
    if (options.pattern) {
      const transform = await transformPatternMigration(options.pattern, workspace, options);
      const outputs = [...(transform.outputs ?? [])];
      if (options["require-verified"] && !transform.preview?.verifiedTransformation?.canAutoApply) {
        throw new Error("Pattern apply blocked: verified transformation did not reach auto-transform tier.");
      }
      if (options.strategy === "bluegreen") {
        if (!options["confirm-production"]) {
          throw new Error("Blue-green apply requires --confirm-production.");
        }
        const serviceName = transform.preview?.changeSet?.serviceName ?? transform.preview?.patternTitle ?? "service";
        outputs.push(...buildBlueGreenDeploymentAssets(serviceName, options));
      }
      if (options.json) {
        printJson({
          ...transform,
          outputs,
        });
        return;
      }
      const writtenFiles = await writePatternOutputs(workspace, outputs, {
        mode: options.mode ?? "write",
      });
      console.log(renderPatternReport(transform.preview));
      console.log("");
      console.log(`Apply status: ${options.mode === "dry-run" ? "dry-run" : "applied"}`);
      if (transform.preview?.verifiedTransformation) {
        console.log(`Verified transformation: ${transform.preview.verifiedTransformation.status} (${transform.preview.verifiedTransformation.tier})`);
      }
      if (options.strategy) {
        console.log(`Deployment strategy: ${options.strategy}`);
      }
      console.log(`Generated files: ${writtenFiles.length}`);
      return;
    }
    const field = getRenameField(options);
    if (!field || !options.to) {
      throw new Error("Missing required flags: --field <name> --to <name>");
    }

    const initialReport = await previewFieldRename(workspace, field, options.to, {
      autoResolve: Boolean(options["auto-resolve"]),
      dynamicAnalysis: Boolean(options["dynamic-analysis"]),
      includeAllAmbiguous: Boolean(options["include-all-ambiguous"]),
      targetContext: options["target-context"] ?? null,
    });
    const preview =
      options.interactive && !options["target-context"]
        ? await rerunInteractivePreview(workspace, field, options.to, initialReport, runtime)
        : initialReport;
    const report = options.mode === "sandbox"
      ? await runSandboxApply(workspace, field, options.to, {
          allowSchemaChange: Boolean(options["allow-schema-change"]),
          autoResolve: Boolean(options["auto-resolve"]),
          differentialMode: options.equivalence,
          dynamicAnalysis: Boolean(options["dynamic-analysis"]),
          includeAllAmbiguous: Boolean(options["include-all-ambiguous"]),
          replayFixturePath: options["replay-fixture"] ?? null,
          targetContext: preview.plan.disambiguation?.targetContext ?? options["target-context"] ?? null,
        })
      : await applyFieldRename(workspace, field, options.to, {
      allowSchemaChange: Boolean(options["allow-schema-change"]),
      autoResolve: Boolean(options["auto-resolve"]),
      differentialMode: options.equivalence,
      dynamicAnalysis: Boolean(options["dynamic-analysis"]),
      includeAllAmbiguous: Boolean(options["include-all-ambiguous"]),
      mode: options.mode ?? "write",
      replayFixturePath: options["replay-fixture"] ?? null,
      targetContext: preview.plan.disambiguation?.targetContext ?? options["target-context"] ?? null,
    });
    if (options.json) {
      printJson(report);
      return;
    }

    if (options.format === "html") {
      await writeHtmlReport(report, options.output);
      return;
    }

    console.log(formatPreviewReport(report));
    console.log("");
    console.log(`Apply status: ${report.apply.status}`);
    if (report.apply.backupRoot) {
      console.log(`Backups: ${report.apply.backupRoot}`);
    }
    if (report.apply.differential) {
      console.log(
        `Differential: ${
          report.apply.differential.equivalent === null
            ? "not-run"
            : report.apply.differential.equivalent
              ? "pass"
              : "fail"
        }`,
      );
    }
    return;
  }

  if (command === "verify") {
    const { inspectWorkspaceEnvironment } = await import("../orchestration/index.js");
    const report = await inspectWorkspaceEnvironment(workspace);
    printJson(report);
    return;
  }

  if (command === "patterns") {
    const { listPatterns } = await import("../patterns/index.js");
    printJson({
      patterns: listPatterns(),
    });
    return;
  }

  if (command === "doctor") {
    const { inspectWorkspaceEnvironment } = await import("../orchestration/index.js");
    const { listPatterns } = await import("../patterns/index.js");
    const verify = await inspectWorkspaceEnvironment(workspace);
    console.log(renderDoctorReport({
      patterns: listPatterns(),
      verify,
    }));
    return;
  }

  if (command === "serve") {
    const { createRequestHandler } = await import("../web/app.js");
    const options = parseFlags(rest);
    const host = options.host ?? "127.0.0.1";
    const port = Number(options.port ?? 3333);
    const server = http.createServer(createRequestHandler({ workspace }));
    await new Promise((resolve) => server.listen(port, host, resolve));
    const address = server.address();
    const boundPort = typeof address === "object" && address ? address.port : port;
    console.log(`RefactorPilot web app running at http://${host}:${boundPort}`);
    console.log(`Workspace: ${workspace}`);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

async function writeHtmlReport(report, outputPath) {
  const { renderPreviewHtml } = await import("../reports/html-generator.js");
  const resolved = path.resolve(outputPath ?? `refactorpilot-preview-${Date.now()}.html`);
  await fs.writeFile(resolved, renderPreviewHtml(report), "utf8");
  console.log(`Wrote HTML preview to ${resolved}`);
}

async function writePatternOutputs(workspace, outputs, options = {}) {
  const mode = options.mode ?? "write";
  const written = [];
  for (const output of outputs) {
    const filePath = path.join(workspace, output.path);
    written.push(filePath);
    if (mode === "dry-run") {
      continue;
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, output.content, "utf8");
  }
  return written;
}

function renderPatternReport(report) {
  const lines = [
    report.patternTitle ?? report.patternId ?? "Pattern Preview",
    `Workspace: ${report.workspace ?? report.preview?.workspace ?? "unknown"}`,
    `Pattern: ${report.patternId}`,
    `Confidence: ${report.confidence} (${report.confidenceScore})`,
    "",
    "Generated changes",
  ];

  for (const artifact of report.generatedArtifacts ?? []) {
    lines.push(`- ${artifact.kind}: ${artifact.path}`);
  }

  if (report.changeSet?.outputs?.length) {
    lines.push("");
    lines.push("Diff preview");
    for (const output of report.changeSet.outputs.slice(0, 6)) {
      lines.push(`- ${output.action} ${output.path}`);
    }
  }

  if (report.deploymentGuidance) {
    lines.push("");
    lines.push("Deployment guidance");
    lines.push(`- Recommended strategy: ${report.deploymentGuidance.recommendedStrategy}`);
    for (const phase of report.deploymentGuidance.phases ?? []) {
      lines.push(`- ${phase.name}: ${phase.check}`);
    }
  }

  if (report.verifiedTransformation) {
    lines.push("");
    lines.push("Verified transformation");
    lines.push(`- Status: ${report.verifiedTransformation.status}`);
    lines.push(`- Tier: ${report.verifiedTransformation.tier}`);
    lines.push(`- Repair attempts: ${report.verifiedTransformation.attempts}`);
  }

  if ((report.warnings ?? []).length > 0) {
    lines.push("");
    lines.push("Warnings");
    for (const warning of report.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  if ((report.notes ?? []).length > 0) {
    lines.push("");
    lines.push("Notes");
    for (const note of report.notes) {
      lines.push(`- ${note}`);
    }
  }

  return lines.join("\n");
}

function renderProtocolArtifact(artifact) {
  const lines = [
    `${artifact.patternTitle}: REST to gRPC`,
    `Workspace: ${artifact.workspace}`,
    `Confidence: ${artifact.confidenceScore} (${artifact.confidence})`,
    `Affected files: ${artifact.impactSurface.affectedFiles}`,
    `REST handlers: ${artifact.impactSurface.restHandlers}`,
    `HTTP clients: ${artifact.impactSurface.httpClients}`,
    "",
    "Generated artifacts:",
    ...artifact.generatedArtifacts.map((entry) => `  - ${entry.kind}: ${entry.path}`),
  ];

  if (artifact.warnings.length > 0) {
    lines.push("", "Warnings:", ...artifact.warnings.map((warning) => `  - ${warning}`));
  }

  if (artifact.notes.length > 0) {
    lines.push("", "Notes:", ...artifact.notes.map((note) => `  - ${note}`));
  }

  return lines.join("\n");
}

async function rerunInteractivePreview(workspace, fromField, toField, report, runtime) {
  const { previewFieldRename } = await import("../orchestration/index.js");
  const { runInteractiveDisambiguation } = await import("./interactive.js");
  const selection = await runInteractiveDisambiguation(report, runtime.interactive ?? {});
  if (selection.includeAllAmbiguous || selection.targetContext) {
    return previewFieldRename(workspace, fromField, toField, selection);
  }
  return report;
}

async function rerunInteractiveContractMigration(workspace, fromField, toField, report, runtime, options = {}) {
  const { migrateApiContract } = await import("../orchestration/index.js");
  const { runInteractiveDisambiguation } = await import("./interactive.js");
  const selection = await runInteractiveDisambiguation(report, runtime.interactive ?? {});
  if (selection.includeAllAmbiguous || selection.targetContext) {
    return migrateApiContract(workspace, fromField, toField, {
      ...selection,
      mode: options.mode ?? "preview",
    });
  }
  return report;
}

function renderDoctorReport({ patterns, verify }) {
  const lines = [
    "RefactorPilot Doctor",
    "===================",
    "",
    `Patterns: ${patterns.length} loaded`,
    `Verification hooks: build ${verify.build.length}, test ${verify.tests.length}`,
    `Git: ${verify.git.available ? verify.git.status : "not available in this workspace"}`,
    `Node scripts detected: build=${verify.manifests.packageScripts?.build ? "yes" : "no"} test=${verify.manifests.packageScripts?.test ? "yes" : "no"}`,
    "",
    "Pattern readiness",
  ];

  for (const pattern of patterns) {
    lines.push(`- ${pattern.id}: ${pattern.maturity} | apply ${pattern.supportsApply ? "yes" : "preview-only"}`);
  }

  return lines.join("\n");
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
