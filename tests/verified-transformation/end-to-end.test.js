import assert from "node:assert/strict";

import { buildProtocPlan } from "../../src/codegen/protoc-runner.js";
import { runVerifiedTransformation } from "../../src/verification/verified-transformation.js";

function buildBrokenChangeSet() {
  return {
    outputs: [
      {
        content: `syntax = "proto3";

package refactorpilot.user.v1;

message UserResponse {
  int64 user_id = 1;
  string name = 1;
}
`,
        kind: "proto",
        path: "proto/user.proto",
      },
      {
        content: `package main

type Service struct{}

func (s *Service) GetUser(req *struct{}) (*struct{}, error) {
    _ = context.Background()
    return &struct{}{}, nil
}
`,
        kind: "go",
        path: "go-server/user_grpc_service.go",
      },
      {
        content: `def fetch_user(transport):
    client = build_default_client(transport)
    return client.get_user()
`,
        kind: "python",
        path: "python-client/client.py",
      },
    ],
    protocPlan: buildProtocPlan({
      packageName: "refactorpilot.user.v1",
      protoPath: "proto/user.proto",
      workspace: ".",
    }),
    transformAnalysis: {
      handlers: [
        {
          errors: [],
          routeParams: [],
        },
      ],
    },
  };
}

export async function run() {
  const changeSet = buildBrokenChangeSet();
  const result = await runVerifiedTransformation(changeSet);
  assert.equal(result.status, "verified");
  assert.equal(result.tier, "assisted-transform");
  assert.equal(result.canAutoApply, true);
  assert.ok(result.repairs.length >= 3);

  const proto = result.outputs.find((entry) => entry.path.endsWith(".proto")).content;
  const goFile = result.outputs.find((entry) => entry.path.endsWith(".go")).content;
  const pythonFile = result.outputs.find((entry) => entry.path.endsWith(".py")).content;

  assert.equal((proto.match(/=\s*1\s*;/g) ?? []).length, 1);
  assert.ok(goFile.includes('"context"'));
  assert.ok(pythonFile.includes("from grpc_client import build_default_client"));

  console.log("verified transformation checks passed");
}

if (import.meta.main) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
