import assert from "node:assert/strict";

import { analyzeComplexHandlers } from "../../src/transformers/complex-handler-transformer.js";
import { analyzeHttpErrors, mapHttpStatusToGrpc } from "../../src/transformers/error-mapper.js";

function buildCase({ earlyReturn, goroutine, httpCode, loop, multipart, websocket }) {
  return `package main

import (
  "encoding/json"
  "net/http"
)

func HandleUser(w http.ResponseWriter, r *http.Request) {
  ${multipart ? 'r.ParseMultipartForm(10 << 20)' : ''}
  ${websocket ? 'upgrader.Upgrade(w, r, nil)' : ''}
  ${loop ? 'for _, item := range []string{"a", "b"} { _ = item }' : ''}
  ${goroutine ? 'go processAsync()' : ''}
  ${earlyReturn ? `if err := validate(); err != nil { http.Error(w, "bad", ${httpCode}); return }` : ''}
  json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
`;
}

export async function run() {
  const httpMappings = [400, 401, 403, 404, 409, 429, 500, 503, 504];
  assert.equal(mapHttpStatusToGrpc(404), "codes.NotFound");
  assert.equal(mapHttpStatusToGrpc(500), "codes.Internal");

  for (const code of httpMappings) {
    const findings = analyzeHttpErrors(`http.Error(w, "boom", ${code})`);
    assert.equal(findings[0].grpcCode, mapHttpStatusToGrpc(code));
  }

  let scenarios = 0;
  const results = [];
  for (const earlyReturn of [true, false]) {
    for (const goroutine of [true, false]) {
      for (const loop of [true, false]) {
        for (const multipart of [true, false]) {
          for (const websocket of [true, false]) {
            for (const httpCode of [400, 404, 500, 503]) {
              scenarios += 1;
              const source = buildCase({
                earlyReturn,
                goroutine,
                httpCode,
                loop,
                multipart,
                websocket,
              });
              const analysis = analyzeComplexHandlers(source, { route: "/users/{id}" });
              assert.equal(analysis.handlers.length, 1);
              const handler = analysis.handlers[0];
              assert.ok(handler.grpcPreview.includes("func (s *Service) HandleUser"));
              assert.ok(handler.routeParams.includes("id"));
              if (websocket) {
                assert.equal(handler.safeToTransform, false);
              }
              if (multipart) {
                assert.ok(handler.score <= 0.35 || handler.scoreReasons.includes("multipart-warning"));
              }
              results.push({
                code: httpCode,
                safeToTransform: handler.safeToTransform,
                score: handler.score,
              });
            }
          }
        }
      }
    }
  }

  assert.equal(scenarios, 128);
  console.log(JSON.stringify({
    cases: scenarios,
    sample: results.slice(0, 8),
  }, null, 2));
}

if (import.meta.main) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
