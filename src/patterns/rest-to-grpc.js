import { confidenceLevel, scanWorkspace } from "../engine/index.js";

const HTTP_HANDLER_RE = /http\.HandleFunc\(\s*"([^"]+)"\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/g;
const GO_HANDLER_SIGNATURE_RE = /func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\w+\s+http\.ResponseWriter\s*,\s*\w+\s+\*http\.Request\s*\)/g;
const REQUESTS_CALL_RE = /\brequests\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g;
const HTTPX_CALL_RE = /\bhttpx\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g;
const PY_DICT_KEY_RE = /\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]/g;
const DYNAMIC_PARAMS_RE = /\bparams\s*=\s*\{/;

export async function previewRestToGrpcMigration(workspace) {
  const scan = await scanWorkspace(workspace);
  const serverEndpoints = [];
  const clientCalls = [];
  const warnings = [];

  for (const file of scan.files) {
    const source = file.source ?? "";

    if (file.language === "go") {
      for (const match of source.matchAll(HTTP_HANDLER_RE)) {
        serverEndpoints.push({
          file: file.path,
          handler: match[2],
          route: match[1],
        });
      }

      if (serverEndpoints.length === 0) {
        for (const match of source.matchAll(GO_HANDLER_SIGNATURE_RE)) {
          serverEndpoints.push({
            file: file.path,
            handler: match[1],
            route: `/${match[1].replace(/^Get|Post|Put|Patch|Delete/, "").toLowerCase() || "resource"}`,
          });
        }
      }
    }

    if (file.language === "python") {
      for (const match of source.matchAll(REQUESTS_CALL_RE)) {
        clientCalls.push({
          file: file.path,
          method: match[1].toUpperCase(),
          url: match[2],
        });
      }

      for (const match of source.matchAll(HTTPX_CALL_RE)) {
        clientCalls.push({
          file: file.path,
          method: match[1].toUpperCase(),
          url: match[2],
        });
      }

      if (DYNAMIC_PARAMS_RE.test(source)) {
        warnings.push(`Dynamic request parameters detected in ${file.path}.`);
      }

      const dictKeyCounts = countMatches(source.matchAll(PY_DICT_KEY_RE));
      if ([...dictKeyCounts.values()].some((count) => count > 1)) {
        warnings.push(`Repeated payload key access detected in ${file.path}.`);
      }
    }
  }

  const impactedFiles = [...new Set([...serverEndpoints.map((item) => item.file), ...clientCalls.map((item) => item.file)])];
  const generatedArtifacts = buildGeneratedArtifacts(serverEndpoints, clientCalls);
  const confidenceScore = scoreMigrationConfidence({
    clientCalls,
    generatedArtifacts,
    serverEndpoints,
    warnings,
  });

  if (serverEndpoints.length === 0) {
    warnings.push("No Go REST handlers were detected.");
  }

  if (clientCalls.length === 0) {
    warnings.push("No Python HTTP client calls were detected.");
  }

  return {
    artifactType: "protocol-migration",
    confidence: confidenceLevel(confidenceScore),
    confidenceLevel: confidenceLevel(confidenceScore),
    confidenceScore,
    demoOnly: true,
    generatedArtifacts,
    impactSurface: {
      affectedFiles: impactedFiles.length,
      grpcServices: generatedArtifacts.filter((artifact) => artifact.kind === "proto").length,
      httpClients: clientCalls.length,
      restHandlers: serverEndpoints.length,
    },
    notes: [
      "REST to gRPC is preview-only in this version.",
      "Generated proto artifacts are planning aids, not auto-applied changes.",
      "This path previews cross-language impact and placeholder artifacts only.",
    ],
    patternId: "rest-to-grpc",
    patternTitle: "Protocol Migration",
    report: {
      confidence: confidenceLevel(confidenceScore),
      confidenceLevel: confidenceLevel(confidenceScore),
      confidenceScore,
      generatedArtifacts,
      impactedFiles: impactedFiles.map((file) => ({ path: file })),
      warnings,
    },
    preview: {
      clientCalls,
      serverEndpoints,
      workspace: scan.rootDir,
    },
    transportMap: {
      clientCalls,
      serverEndpoints,
    },
    warnings,
    workspace: scan.rootDir,
  };
}

function buildGeneratedArtifacts(serverEndpoints, clientCalls) {
  const routeLabel = serverEndpoints[0]?.route ?? "service";
  const serviceLabel = toServiceLabel(serverEndpoints[0]?.handler ?? routeLabel);

  return [
    {
      kind: "proto",
      path: `proto/${serviceLabel}.proto`,
      preview: `syntax = "proto3";

package refactorpilot.v1;

service ${serviceLabel}Service {
  rpc Call (${serviceLabel}Request) returns (${serviceLabel}Response);
}

message ${serviceLabel}Request {}
message ${serviceLabel}Response {}
`,
    },
    {
      kind: "go",
      path: `generated/${serviceLabel}_server_stub.go`,
      preview: `// Preview-only server stub for ${serviceLabel}Service.\n// Replace REST handlers with generated gRPC methods manually.`,
    },
    {
      kind: "python",
      path: `generated/${serviceLabel}_client_stub.py`,
      preview: `# Preview-only client stub for ${serviceLabel}Service.\n# Replace requests/httpx usage with generated gRPC stubs manually.`,
    },
    {
      kind: "json",
      path: `migration/${serviceLabel}_rest_to_grpc.spec.json`,
      preview: JSON.stringify(
        {
          clientCalls,
          service: `${serviceLabel}Service`,
          serverEndpointCount: serverEndpoints.length,
          transport: "rest-to-grpc",
        },
        null,
        2,
      ),
    },
  ];
}

function scoreMigrationConfidence({ clientCalls, generatedArtifacts, serverEndpoints, warnings }) {
  if (serverEndpoints.length === 0 || clientCalls.length === 0) {
    return 0.34;
  }

  let score = 0.61;
  if (generatedArtifacts.some((artifact) => artifact.kind === "proto")) {
    score += 0.08;
  }

  if (warnings.some((warning) => /dynamic/i.test(warning))) {
    score -= 0.16;
  }

  if (warnings.some((warning) => /repeated payload key/i.test(warning))) {
    score -= 0.12;
  }

  if (clientCalls.length > 1) {
    score += 0.05;
  }

  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

function countMatches(iterator) {
  const counts = new Map();
  for (const match of iterator) {
    const key = match[1];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function toServiceLabel(value) {
  const cleaned = String(value ?? "service")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim();
  if (!cleaned) {
    return "Service";
  }

  return cleaned
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
