import assert from "node:assert/strict";

import { analyzeComplexHandlers } from "../../src/transformers/complex-handler-transformer.js";
import { detectFastApiPatterns } from "../../src/transformers/framework-parsers/fastapi-parser.js";

const cases = [
  {
    id: "nethttp-websocket-upgrade",
    run() {
      const result = analyzeComplexHandlers(`package main
import "net/http"
func Stream(w http.ResponseWriter, r *http.Request) {
  upgrader.Upgrade(w, r, nil)
}
`, { route: "/stream" });
      const handler = result.handlers[0];
      return handler.safeToTransform === false && handler.scoreReasons.includes("websocket-blocker");
    },
  },
  {
    id: "nethttp-multipart-upload",
    run() {
      const result = analyzeComplexHandlers(`package main
import "net/http"
func Upload(w http.ResponseWriter, r *http.Request) {
  r.ParseMultipartForm(10 << 20)
}
`, { route: "/upload" });
      const handler = result.handlers[0];
      return handler.score <= 0.35 && handler.scoreReasons.includes("multipart-warning");
    },
  },
  {
    id: "nethttp-goroutine-handler",
    run() {
      const result = analyzeComplexHandlers(`package main
import "net/http"
func Handle(w http.ResponseWriter, r *http.Request) {
  go audit(r.Context())
}
`, { route: "/jobs/{id}" });
      return result.handlers[0].scoreReasons.includes("goroutine-detected");
    },
  },
  {
    id: "nethttp-loop-plus-multipart",
    run() {
      const result = analyzeComplexHandlers(`package main
import "net/http"
func Import(w http.ResponseWriter, r *http.Request) {
  r.ParseMultipartForm(10 << 20)
  for _, item := range []string{"a", "b"} { _ = item }
}
`, { route: "/imports/{id}" });
      return result.handlers[0].score <= 0.35;
    },
  },
  {
    id: "fastapi-websocket-route",
    run() {
      const result = detectFastApiPatterns(`router = APIRouter()
@router.websocket("/ws")
async def socket(ws): pass`);
      return result.websockets.length === 1;
    },
  },
  {
    id: "fastapi-app-websocket-route",
    run() {
      const result = detectFastApiPatterns(`@app.websocket("/stream")
async def stream(ws): pass`);
      return result.websockets.length === 1;
    },
  },
];

export async function run() {
  const results = cases.map((entry) => ({
    id: entry.id,
    passed: Boolean(entry.run()),
  }));

  for (const result of results) {
    assert.equal(result.passed, true, `Expected unsupported case ${result.id} to degrade safely.`);
  }

  console.log(JSON.stringify({
    cases: results.length,
    safeDegradationRate: 1,
  }, null, 2));
}

if (import.meta.main) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
