import assert from "node:assert/strict";

import { rankAmbiguities } from "../../src/engine/ambiguity-ranker.js";

export async function run() {
  const plan = {
    fromField: "user_id",
    impactedFiles: [
      {
        path: "server.go",
        fieldMatches: [{ parent: "UserPayload", line: 4, name: "UserID" }],
        usageMatches: [],
        explanationPaths: [{}, {}],
      },
      {
        path: "other.go",
        fieldMatches: [{ parent: "AuditPayload", line: 4, name: "UserID" }],
        usageMatches: [],
        explanationPaths: [{}],
      },
      {
        path: "client.py",
        fieldMatches: [],
        usageMatches: [{ name: "user_id", line: 2 }],
        explanationPaths: [{}],
      },
    ],
    disambiguation: {
      groups: [
        {
          kind: "producer",
          options: [
            { label: "UserPayload", filePath: "server.go", id: "producer:userpayload" },
            { label: "AuditPayload", filePath: "other.go", id: "producer:auditpayload" },
          ],
          title: "Producer context",
        },
      ],
    },
  };
  const scanResult = {
    files: [
      {
        path: "server.go",
        endpoints: [{ route: "/user" }],
        source: "// user payload\n",
        symbols: [{ name: "HandleUser" }, { name: "UserPayload" }],
      },
      {
        path: "other.go",
        endpoints: [],
        source: "// audit payload\n",
        symbols: [{ name: "AuditPayload" }],
      },
      {
        path: "client.py",
        endpoints: [{ route: "/user" }],
        source: "",
        symbols: [{ name: "fetch_user" }],
      },
    ],
  };

  const ranking = rankAmbiguities(plan, scanResult);
  assert.equal(ranking.groups.length, 1);
  assert.equal(ranking.groups[0].rankedOptions[0].label, "UserPayload");
  assert.equal(ranking.groups[0].autoResolvable, true);
  assert.ok(ranking.groups[0].resolutionConfidence >= 0.8);
  console.log("ambiguity ranker checks passed");
}

if (import.meta.main) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
