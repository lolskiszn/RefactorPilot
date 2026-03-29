import path from "node:path";

import { scanWorkspace } from "../../src/orchestration/index.js";
import { buildProtocPlan, inferProtoPackage } from "../../src/codegen/protoc-runner.js";
import { previewRestToGrpcMigration } from "../../src/patterns/rest-to-grpc.js";
import { PLUGIN_API_VERSION } from "../../src/plugins/registry.js";
import { analyzeComplexHandlers } from "../../src/transformers/complex-handler-transformer.js";
import { runVerifiedTransformation } from "../../src/verification/verified-transformation.js";

function toPascal(value) {
  return String(value ?? "Service")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("") || "Service";
}

function toSnake(value) {
  return String(value ?? "service")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase()
    .replace(/^_+|_+$/g, "") || "service";
}

function mapProtoType(goType) {
  const value = String(goType ?? "").replace(/^\*+/, "");
  if (/^(int|int32|uint32)$/.test(value)) {
    return "int32";
  }
  if (/^(int64|uint64)$/.test(value)) {
    return "int64";
  }
  if (/^(float32)$/.test(value)) {
    return "float";
  }
  if (/^(float64)$/.test(value)) {
    return "double";
  }
  if (/^(bool)$/.test(value)) {
    return "bool";
  }
  return "string";
}

function pickPrimaryStruct(goFile) {
  const fieldsByParent = new Map();
  for (const field of goFile.fields ?? []) {
    if (!field.parent) {
      continue;
    }
    if (!fieldsByParent.has(field.parent)) {
      fieldsByParent.set(field.parent, []);
    }
    fieldsByParent.get(field.parent).push(field);
  }

  const entries = [...fieldsByParent.entries()].sort((left, right) => right[1].length - left[1].length);
  if (entries.length === 0) {
    return {
      fields: [],
      name: "Payload",
    };
  }
  return {
    fields: entries[0][1],
    name: entries[0][0],
  };
}

function buildProto(serviceName, payload, protoPackage) {
  const requestName = `${serviceName}Request`;
  const responseName = `${serviceName}Response`;
  const protoFields = payload.fields.map((field, index) => {
    const fieldName = field.jsonName ?? toSnake(field.name);
    return `  ${mapProtoType(field.type)} ${fieldName} = ${index + 1};`;
  });

  return `syntax = "proto3";

package ${protoPackage};

service ${serviceName}Service {
  rpc Get${serviceName}(${requestName}) returns (${responseName});
}

message ${requestName} {}

message ${responseName} {
${protoFields.join("\n")}
}
`;
}

function buildGoService(serviceName, payload, protoPath, handlerAnalysis) {
  const responseFields = payload.fields.map((field) => {
    const protoField = field.jsonName ?? toSnake(field.name);
    return `    ${protoField}: payload.${field.name},`;
  }).join("\n");
  const interceptorDefinitions = handlerAnalysis.interceptors.map((entry) => entry.source).join("\n\n");
  const grpcHandlerPreview = handlerAnalysis.handlers[0]?.grpcPreview ?? "";

  return `package main

import (
    "context"
    "google.golang.org/grpc"
    "google.golang.org/grpc/codes"
    "google.golang.org/grpc/status"
)

// RefactorPilot generated this gRPC-style service skeleton from the existing REST payload.
// Wire the generated proto at ${protoPath} into your preferred Go gRPC toolchain.
type ${serviceName}Service struct{}

type ${serviceName}Response struct {
${payload.fields.map((field) => `    ${field.jsonName ?? toSnake(field.name)} ${field.type}`).join("\n")}
}

${interceptorDefinitions}

${grpcHandlerPreview || `func (s *${serviceName}Service) Get${serviceName}(ctx context.Context, req *struct{}) (*${serviceName}Response, error) {
    payload := ${payload.name}{}
    return &${serviceName}Response{
${responseFields}
    }, nil
}`}
`;
}

function buildPythonStub(serviceName, route) {
  return `class ${serviceName}GrpcClient:
    def __init__(self, transport):
        self.transport = transport

    def get_${toSnake(serviceName)}(self):
        return self.transport.call("${serviceName}Service", "Get${serviceName}", {})


def build_default_client(transport):
    return ${serviceName}GrpcClient(transport)


# Original REST route migrated from: ${route}
`;
}

function buildPythonClientUpdate(serviceName) {
  return `from grpc_client import build_default_client


def fetch_${toSnake(serviceName)}(transport):
    client = build_default_client(transport)
    return client.get_${toSnake(serviceName)}()
`;
}

function buildGoTest(serviceName) {
  return `package main

import "testing"

func Test${serviceName}ServiceSkeleton(t *testing.T) {
    service := &${serviceName}Service{}
    if service == nil {
        t.Fatal("expected service to be generated")
    }
}
`;
}

function buildPythonTest(serviceName) {
  return `class FakeTransport:
    def call(self, service, method, payload):
        return {"service": service, "method": method, "payload": payload}


def test_${toSnake(serviceName)}_grpc_client_roundtrip():
    from grpc_client import build_default_client

    client = build_default_client(FakeTransport())
    response = client.get_${toSnake(serviceName)}()
    assert response["service"] == "${serviceName}Service"
    assert response["method"] == "Get${serviceName}"
`;
}

function buildMigrationReadme(serviceName, route) {
  return `# REST to gRPC Full Migration

Generated by RefactorPilot for the golden path migration.

## What changed

1. Generated a proto contract for ${serviceName}
2. Added a Go gRPC-style service skeleton
3. Replaced the Python REST client with a transport-backed stub
4. Added smoke tests for both sides

## Original REST route

\`${route}\`

## Next steps

1. Wire the proto into your real gRPC toolchain
2. Replace the placeholder transport in Python with grpcio stubs
3. Run differential testing before cutting over traffic
`;
}

function buildUnifiedDiff(pathLabel, before, after) {
  return [
    `--- a/${pathLabel}`,
    `+++ b/${pathLabel}`,
    "@@",
    ...String(after ?? "")
      .split(/\r?\n/)
      .map((line) => `+${line}`),
  ].join("\n");
}

function buildOutputPlan(workspace, preview, scan) {
  const goFile = scan.files.find((file) => file.language === "go");
  const pythonFile = scan.files.find((file) => file.language === "python");
  const payload = pickPrimaryStruct(goFile ?? { fields: [] });
  const route = preview.preview.serverEndpoints[0]?.route ?? "/service";
  const serviceName = toPascal(payload.name.replace(/Payload$/, "") || "Service");
  const protoPackage = inferProtoPackage(`refactorpilot/${toSnake(serviceName)}/v1`);
  const protoPath = path.join("proto", `${toSnake(serviceName)}.proto`);
  const goServicePath = path.join(path.dirname(goFile?.path ?? "go-server"), `${toSnake(serviceName)}_grpc_service.go`);
  const pythonStubPath = path.join(path.dirname(pythonFile?.path ?? "python-client"), "grpc_client.py");
  const pythonClientPath = pythonFile?.path ?? path.join("python-client", "client.py");
  const goTestPath = path.join(path.dirname(goFile?.path ?? "go-server"), `${toSnake(serviceName)}_grpc_service_test.go`);
  const pythonTestPath = path.join(path.dirname(pythonFile?.path ?? "python-client"), "test_grpc_client.py");
  const readmePath = path.join("migration", `${toSnake(serviceName)}-rest-to-grpc.md`);
  const handlerAnalysis = analyzeComplexHandlers(goFile?.source ?? "", {
    route,
  });
  const protocPlan = buildProtocPlan({
    packageName: protoPackage,
    protoPath,
    workspace,
  });

  const outputs = [
    {
      action: "create",
      content: buildProto(serviceName, payload, protoPackage),
      kind: "proto",
      path: protoPath,
    },
    {
      action: "create",
      content: buildGoService(serviceName, payload, protoPath, handlerAnalysis),
      kind: "go",
      path: goServicePath,
    },
    {
      action: "create",
      content: buildPythonStub(serviceName, route),
      kind: "python",
      path: pythonStubPath,
    },
    {
      action: "modify",
      before: pythonFile?.source ?? "",
      content: buildPythonClientUpdate(serviceName),
      kind: "python",
      path: pythonClientPath,
    },
    {
      action: "create",
      content: buildGoTest(serviceName),
      kind: "test",
      path: goTestPath,
    },
    {
      action: "create",
      content: buildPythonTest(serviceName),
      kind: "test",
      path: pythonTestPath,
    },
    {
      action: "create",
      content: buildMigrationReadme(serviceName, route),
      kind: "md",
      path: readmePath,
    },
  ];

  return {
    outputs: outputs.map((entry) => ({
      ...entry,
      diff: buildUnifiedDiff(entry.path, entry.before ?? "", entry.content),
    })),
    protocPlan,
    serviceName,
    transformAnalysis: handlerAnalysis,
  };
}

function buildDeploymentGuidance(preview) {
  return {
    recommendedStrategy: "bluegreen",
    phases: [
      { name: "deploy-green", percentage: 0, check: "service-health" },
      { name: "switch-traffic", percentage: 100, check: "behavioral-equivalence" },
      { name: "retain-blue", percentage: 100, check: "rollback-ready" },
    ],
    verification: {
      differential: true,
      replayFixtureRecommended: true,
      sandboxRequired: true,
    },
    warnings: [...(preview.warnings ?? [])],
  };
}

export const plugin = {
  apiVersion: PLUGIN_API_VERSION,
  manifest: {
    capabilities: {
      patterns: ["rest-to-grpc-full"],
    },
    description: "Produce a full golden-path REST to gRPC migration pack for Go and Python.",
    id: "rest-to-grpc-full",
    maturity: "beta",
    name: "Full Protocol Migration",
    supportsApply: true,
    title: "Full Protocol Migration",
    version: "1.0.0",
  },
  async preview(workspace, options = {}) {
    const preview = await previewRestToGrpcMigration(workspace, options);
    const scan = await scanWorkspace(workspace);
    const draftChangeSet = buildOutputPlan(workspace, preview, scan);
    const verifiedTransformation = await runVerifiedTransformation(draftChangeSet, {
      goRunner: options.goRunner,
      maxRepairAttempts: options.maxRepairAttempts,
      protocRunner: options.protocRunner,
      pythonRunner: options.pythonRunner,
      semanticCompare: options.semanticCompare,
      workspace,
    });
    const changeSet = {
      ...draftChangeSet,
      outputs: verifiedTransformation.outputs,
      verifiedTransformation,
    };
    return {
      ...preview,
      changeSet,
      deploymentGuidance: buildDeploymentGuidance(preview),
      demoOnly: false,
      generatedArtifacts: changeSet.outputs.map((entry) => ({
        kind: entry.kind,
        path: entry.path,
        preview: entry.content,
      })),
      notes: [
        ...(preview.notes ?? []),
        ...(changeSet.transformAnalysis.warnings.length > 0
          ? [`Transformer warnings: ${changeSet.transformAnalysis.warnings.join(", ")}`]
          : []),
        `Codegen plan prepared with ${changeSet.protocPlan.commands.length} protoc command(s).`,
        `Verified transformation status: ${verifiedTransformation.status} (${verifiedTransformation.tier}).`,
        ...(verifiedTransformation.repairs.length > 0
          ? [`Auto-repairs applied: ${verifiedTransformation.repairs.map((entry) => entry.strategy).join(", ")}`]
          : []),
        "Full transformation mode generates a concrete migration pack for the supported Go/Python golden path.",
      ],
      patternId: "rest-to-grpc-full",
      patternTitle: "Full Protocol Migration",
      verifiedTransformation,
    };
  },
  async transform(workspace, options = {}) {
    const preview = await this.preview(workspace, options);
    return {
      outputs: preview.changeSet.outputs,
      patternId: preview.patternId,
      preview,
      safeToApply: preview.confidenceScore >= 0.5 && preview.verifiedTransformation.canAutoApply,
      workspace: path.resolve(workspace),
    };
  },
};

export default plugin;
