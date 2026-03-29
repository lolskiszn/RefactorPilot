import path from "node:path";

export function buildProtocPlan({ workspace, protoPath, packageName = "refactorpilot.v1" }) {
  const absoluteWorkspace = path.resolve(workspace ?? ".");
  const resolvedProto = path.join(absoluteWorkspace, protoPath);
  return {
    commands: [
      `protoc --proto_path="${absoluteWorkspace}" --go_out="${absoluteWorkspace}" --go-grpc_out="${absoluteWorkspace}" "${resolvedProto}"`,
      `python -m grpc_tools.protoc -I "${absoluteWorkspace}" --python_out="${absoluteWorkspace}" --grpc_python_out="${absoluteWorkspace}" "${resolvedProto}"`,
    ],
    packageName,
    protoPath: resolvedProto,
    workspace: absoluteWorkspace,
  };
}

export function inferProtoPackage(modulePath) {
  return String(modulePath ?? "refactorpilot/v1")
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9/]+/g, ".")
    .replace(/\//g, ".")
    .replace(/^\.+|\.+$/g, "") || "refactorpilot.v1";
}
