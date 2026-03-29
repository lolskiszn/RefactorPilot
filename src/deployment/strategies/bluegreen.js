function normalizeName(value) {
  return String(value ?? "service")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "service";
}

export function buildBlueGreenDeploymentAssets(serviceName, options = {}) {
  const slug = normalizeName(serviceName);
  const workflowPath = ".github/workflows/bluegreen-deploy.yml";
  const scriptsDir = "scripts/deploy";

  return [
    {
      action: "create",
      kind: "workflow",
      path: workflowPath,
      content: `name: Blue Green Deploy

on:
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: bash ${scriptsDir}/deploy-green.sh
      - run: bash ${scriptsDir}/health-check.sh
      - run: bash ${scriptsDir}/switch-traffic.sh
`,
    },
    {
      action: "create",
      kind: "script",
      path: `${scriptsDir}/deploy-green.sh`,
      content: `#!/usr/bin/env bash
set -euo pipefail
docker compose up -d ${slug}-green
`,
    },
    {
      action: "create",
      kind: "script",
      path: `${scriptsDir}/health-check.sh`,
      content: `#!/usr/bin/env bash
set -euo pipefail
curl --fail \${BLUEGREEN_HEALTH_URL:-http://localhost:8081/health}
`,
    },
    {
      action: "create",
      kind: "script",
      path: `${scriptsDir}/switch-traffic.sh`,
      content: `#!/usr/bin/env bash
set -euo pipefail
echo "Switching traffic to green"
nginx -s reload || true
`,
    },
    {
      action: "create",
      kind: "script",
      path: `${scriptsDir}/rollback.sh`,
      content: `#!/usr/bin/env bash
set -euo pipefail
echo "Rolling traffic back to blue"
docker compose stop ${slug}-green || true
`,
    },
  ];
}
