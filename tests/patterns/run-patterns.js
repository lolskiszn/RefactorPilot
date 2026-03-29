import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { applyFieldRename } from "../../src/orchestration/index.js";
import { listPatterns, previewPatternMigration } from "../../src/patterns/index.js";

function writeFile(root, relativePath, content) {
  return fs.writeFile(path.join(root, relativePath), content, "utf8");
}

async function createWorkspace(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "refactorpilot-patterns-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf8");
  }
  return root;
}

export async function run() {
  const patternIds = listPatterns().map((pattern) => pattern.id);
  assert.ok(patternIds.includes("api-contract-rename"));
  assert.ok(patternIds.includes("rest-to-grpc"));

  const apiWorkspace = await createWorkspace({
    "server.go": `package main\n\ntype UserPayload struct {\n    UserID string \`json:"user_id"\`\n    Email string \`json:"email"\`\n}\n`,
    "client.py": `def fetch_user(payload):\n    return payload["user_id"]\n`,
  });
  const apiPreview = await previewPatternMigration("api-contract-rename", apiWorkspace, {
    fromField: "user_id",
    toField: "account_id",
  });
  assert.equal(apiPreview.patternId, "api-contract-rename");
  assert.equal(apiPreview.impactSurface.affectedFiles, 2);
  assert.ok(apiPreview.generatedArtifacts.some((artifact) => artifact.path.endsWith(".json")));
  assert.ok(apiPreview.generatedArtifacts.some((artifact) => artifact.path.endsWith(".md")));
  assert.equal(apiPreview.preview.plan.validation.valid, true);

  const restWorkspace = await createWorkspace({
    "go-server/main.go": `package main\n\nimport (\n    "encoding/json"\n    "net/http"\n)\n\ntype User struct {\n    ID string \`json:"id"\`\n    Name string \`json:"name"\`\n}\n\nfunc getUser(w http.ResponseWriter, r *http.Request) {\n    user := User{ID: "1", Name: "Alice"}\n    json.NewEncoder(w).Encode(user)\n}\n\nfunc main() {\n    http.HandleFunc("/user", getUser)\n}\n`,
    "python-client/client.py": `import requests\n\ndef fetch_user():\n    resp = requests.get("http://localhost/user")\n    data = resp.json()\n    return User(id=data["id"], name=data["name"])\n\nclass User:\n    def __init__(self, id, name):\n        self.id = id\n        self.name = name\n`,
  });
  const restPreview = await previewPatternMigration("rest-to-grpc", restWorkspace);
  assert.equal(restPreview.patternId, "rest-to-grpc");
  assert.ok(restPreview.demoOnly);
  assert.ok(restPreview.impactSurface.affectedFiles >= 2);
  assert.ok(restPreview.generatedArtifacts.some((artifact) => artifact.path.endsWith(".proto")));
  assert.ok(restPreview.generatedArtifacts.some((artifact) => artifact.path.endsWith(".spec.json")));
  assert.ok(restPreview.confidenceScore > 0.5);

  const apiMatrix = await runApiContractMatrix();
  const restMatrix = await runRestToGrpcMatrix();
  assert.ok(apiMatrix.scenarios >= 108);
  assert.ok(restMatrix.scenarios >= 108);
  assert.equal(apiMatrix.safePreviewRate, 1);
  assert.equal(restMatrix.safePreviewRate, 1);

  const safeApply = await applyFieldRename(apiWorkspace, "user_id", "account_id", { mode: "write" });
  assert.equal(safeApply.apply.status, "applied");
  const appliedClient = await fs.readFile(path.join(apiWorkspace, "client.py"), "utf8");
  assert.ok(appliedClient.includes("account_id"));

  console.log(
    JSON.stringify(
      {
        apiMatrix,
        restMatrix,
      },
      null,
      2,
    ),
  );
}

async function runApiContractMatrix() {
  const fields = [
    "user_id",
    "email",
    "display_name",
    "tenant_id",
    "invoice_id",
    "region_code",
    "account_id",
    "project_id",
    "session_id",
    "team_id",
    "order_id",
    "profile_id",
  ];
  const variants = ["safe", "duplicate", "dynamic"];
  const layouts = ["basic", "handler", "extra"];
  let scenarios = 0;
  let safePreviewCount = 0;

  for (const field of fields) {
    for (const variant of variants) {
      for (const layout of layouts) {
        scenarios += 1;
        const workspace = await createWorkspace(buildApiFiles({ field, layout, variant }));
        const preview = await previewPatternMigration("api-contract-rename", workspace, {
          fromField: field,
          toField: `next_${field}`,
        });
        if (variant === "safe") {
          assert.equal(preview.preview.plan.validation.valid, true, `${field}:${variant}:${layout}`);
          assert.equal(preview.confidence, "high");
          safePreviewCount += 1;
        } else {
          assert.equal(preview.preview.plan.validation.valid, false, `${field}:${variant}:${layout}`);
          assert.equal(preview.confidence, "low");
        }
      }
    }
  }

  return {
    safePreviewRate: safePreviewCount / (fields.length * layouts.length),
    scenarios,
  };
}

async function runRestToGrpcMatrix() {
  const services = [
    "user",
    "project",
    "invoice",
    "session",
    "tenant",
    "device",
    "billing",
    "catalog",
    "audit",
    "notification",
    "search",
    "workspace",
  ];
  const variants = ["safe", "ambiguous", "dynamic"];
  const layouts = ["route", "json", "mixed"];
  let scenarios = 0;
  let safePreviewCount = 0;

  for (const service of services) {
    for (const variant of variants) {
      for (const layout of layouts) {
        scenarios += 1;
        const workspace = await createWorkspace(buildRestFiles({ layout, service, variant }));
        const preview = await previewPatternMigration("rest-to-grpc", workspace);
        if (variant === "safe") {
          assert.equal(preview.demoOnly, true);
          assert.ok(preview.impactSurface.affectedFiles >= 2, `${service}:${variant}:${layout}`);
          assert.ok(preview.generatedArtifacts.some((artifact) => artifact.path.endsWith(".proto")));
          assert.ok(preview.generatedArtifacts.some((artifact) => artifact.path.endsWith(".spec.json")));
          assert.ok(preview.confidenceScore >= 0.5);
          safePreviewCount += 1;
        } else {
          assert.ok(preview.confidenceScore <= 0.7, `${service}:${variant}:${layout}`);
          assert.ok(preview.warnings.length > 0);
        }
      }
    }
  }

  return {
    safePreviewRate: safePreviewCount / (services.length * layouts.length),
    scenarios,
  };
}

function buildApiFiles({ field, layout, variant }) {
  const pascal = toPascal(field);
  const goFields = [
    `    ${pascal} string \`json:"${field}"\`\n`,
    layout === "extra" ? `    Status string \`json:"status"\`\n` : "",
  ].join("");
  const goExtras =
    layout === "handler"
      ? `\nfunc Handle${pascal}(w http.ResponseWriter, r *http.Request) {\n    _ = json.NewEncoder(w).Encode(UserPayload{})\n}\n`
      : "";
  const pyValue =
    variant === "dynamic"
      ? `payload.get(field_name)`
      : `payload["${field}"]`;
  const pyDuplicate =
    variant === "duplicate"
      ? `\n    return payload["${field}"], payload["${field}"]\n`
      : "\n";

  return {
    "server.go": `package main\n\nimport (\n    "encoding/json"\n    "net/http"\n)\n\ntype UserPayload struct {\n${goFields}}\n${goExtras}`,
    "client.py": `def fetch_user(payload, field_name="user_id"):\n    return ${pyValue}${pyDuplicate}`,
  };
}

function buildRestFiles({ layout, service, variant }) {
  const pascal = toPascal(service);
  const route = `/${service}`;
  const goRoute =
    layout === "route"
      ? `    http.HandleFunc("${route}", get${pascal})\n`
      : layout === "mixed"
      ? `    http.HandleFunc("${route}", get${pascal})\n    http.HandleFunc("${route}/v2", get${pascal})\n`
      : "";
  const jsonEncode =
    layout === "json"
      ? `    json.NewEncoder(w).Encode(User{ID: "1", Name: "${pascal}"})\n`
      : `    json.NewEncoder(w).Encode(user)\n`;
  const pythonCall =
    variant === "dynamic"
      ? `requests.get("http://localhost${route}", params={"key": key_name})`
      : `requests.get("http://localhost${route}")`;
  const pythonBody =
    variant === "ambiguous"
      ? `    return {"id": data["id"], "name": data["name"], "id_copy": data["id"]}\n`
      : `    return {"id": data["id"], "name": data["name"]}\n`;

  return {
    "go-server/main.go": `package main\n\nimport (\n    "encoding/json"\n    "net/http"\n)\n\ntype User struct {\n    ID string \`json:"id"\`\n    Name string \`json:"name"\`\n}\n\nfunc get${pascal}(w http.ResponseWriter, r *http.Request) {\n    user := User{ID: "1", Name: "${pascal}"}\n${jsonEncode}}\n\nfunc main() {\n${goRoute}}\n`,
    "python-client/client.py": `import requests\n\ndef fetch_${service}(key_name="id"):\n    resp = ${pythonCall}\n    data = resp.json()\n${pythonBody}`,
  };
}

function toPascal(value) {
  return String(value)
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
