import assert from "node:assert/strict";

import { analyzeComplexHandlers } from "../../src/transformers/complex-handler-transformer.js";
import { detectChiPatterns } from "../../src/transformers/framework-parsers/chi-parser.js";
import { detectFastApiPatterns } from "../../src/transformers/framework-parsers/fastapi-parser.js";
import { detectFlaskPatterns } from "../../src/transformers/framework-parsers/flask-parser.js";
import { detectGinPatterns } from "../../src/transformers/framework-parsers/gin-parser.js";
import { detectMuxPatterns } from "../../src/transformers/framework-parsers/mux-parser.js";

const cases = [
  {
    id: "nethttp-early-return",
    kind: "supported",
    run() {
      const result = analyzeComplexHandlers(`package main
import (
  "encoding/json"
  "net/http"
)
func GetUser(w http.ResponseWriter, r *http.Request) {
  if err := validate(); err != nil { http.Error(w, "bad", 400); return }
  json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
`, { route: "/users/{id}" });
      return result.handlers[0].safeToTransform && result.handlers[0].routeParams.includes("id");
    },
  },
  {
    id: "nethttp-websocket",
    kind: "blocked",
    run() {
      const result = analyzeComplexHandlers(`package main
import "net/http"
func Stream(w http.ResponseWriter, r *http.Request) {
  upgrader.Upgrade(w, r, nil)
}
`, { route: "/stream" });
      return result.handlers[0].safeToTransform === false;
    },
  },
  {
    id: "gin-route-binding",
    kind: "supported",
    run() {
      const result = detectGinPatterns(`router.Use(AuthMiddleware, LoggingMiddleware)
router.POST("/users/:id", createUser)
func createUser(c *gin.Context) {
  id := c.Param("id")
  _ = id
  c.BindJSON(&req)
  c.JSON(200, gin.H{"ok": true})
}`);
      return result.params.includes("id") && result.bindings.includes("req") && result.responses.includes(200);
    },
  },
  {
    id: "chi-subrouter",
    kind: "supported",
    run() {
      const result = detectChiPatterns(`r.Use(Auth)
r.Route("/users", func(r chi.Router) {
  r.Get("/{id}", getUser)
})
chi.URLParam(r, "id")
r.Mount("/api/v1", apiRouter)`);
      return result.params.includes("id") && result.mounts.includes("/api/v1");
    },
  },
  {
    id: "mux-prefix-methods",
    kind: "supported",
    run() {
      const result = detectMuxPatterns(`r.PathPrefix("/api").Subrouter()
r.HandleFunc("/users/{id}", getUser).Methods("GET")
vars := mux.Vars(r)
_ = vars["id"]`);
      return result.prefixes.includes("/api") && result.params.includes("id") && result.methods.some((entry) => entry.includes('"GET"'));
    },
  },
  {
    id: "fastapi-router-deps",
    kind: "supported",
    run() {
      const result = detectFastApiPatterns(`router = APIRouter()
@router.get("/users/{id}")
def get_user(user=Depends(current_user)):
    return {"ok": True}
app.include_router(router)`);
      return result.routers.includes("router") && result.includeRouters.includes("router") && result.dependencies.includes("current_user");
    },
  },
  {
    id: "fastapi-websocket",
    kind: "partial",
    run() {
      const result = detectFastApiPatterns(`router = APIRouter()
@router.websocket("/ws")
async def socket(ws): pass`);
      return result.websockets.length === 1;
    },
  },
  {
    id: "flask-blueprint",
    kind: "supported",
    run() {
      const result = detectFlaskPatterns(`bp = Blueprint("users", __name__)
@bp.route("/users/<id>", methods=["GET"])
def get_user():
  request.args.get("page")
  return {}
@bp.errorhandler(404)
def missing(err):
  return {}, 404`);
      return result.blueprints.includes("bp") && result.methods[0].owner === "bp" && result.errorHandlers[0].code === "404";
    },
  },
  {
    id: "multipart-warning",
    kind: "blocked",
    run() {
      const result = analyzeComplexHandlers(`package main
import "net/http"
func Upload(w http.ResponseWriter, r *http.Request) {
  r.ParseMultipartForm(10 << 20)
}
`, { route: "/upload" });
      return result.handlers[0].score <= 0.35;
    },
  },
];

export async function run() {
  const results = cases.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    passed: Boolean(entry.run()),
  }));

  for (const result of results) {
    assert.equal(result.passed, true, `Expected ${result.id} to pass.`);
  }

  const supported = results.filter((entry) => entry.kind === "supported").length;
  const partial = results.filter((entry) => entry.kind === "partial").length;
  const blocked = results.filter((entry) => entry.kind === "blocked").length;

  console.log(JSON.stringify({
    blocked,
    partial,
    realWorldCases: results.length,
    supported,
  }, null, 2));
}

if (import.meta.main) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
