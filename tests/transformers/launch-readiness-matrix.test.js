import assert from "node:assert/strict";

import { analyzeComplexHandlers } from "../../src/transformers/complex-handler-transformer.js";
import { detectChiPatterns } from "../../src/transformers/framework-parsers/chi-parser.js";
import { detectFastApiPatterns } from "../../src/transformers/framework-parsers/fastapi-parser.js";
import { detectFlaskPatterns } from "../../src/transformers/framework-parsers/flask-parser.js";
import { detectGinPatterns } from "../../src/transformers/framework-parsers/gin-parser.js";
import { detectMuxPatterns } from "../../src/transformers/framework-parsers/mux-parser.js";

function withCategory(category, result) {
  return {
    category,
    ...result,
  };
}

function evaluateNetHttpScenario({ earlyReturn, multipart, websocket, goroutine, loop, route }) {
  const body = `package main
import (
  "encoding/json"
  "net/http"
)
func Handle(w http.ResponseWriter, r *http.Request) {
  ${multipart ? "r.ParseMultipartForm(10 << 20)" : ""}
  ${websocket ? "upgrader.Upgrade(w, r, nil)" : ""}
  ${goroutine ? "go audit(r.Context())" : ""}
  ${loop ? "for _, item := range []string{\"a\", \"b\"} { _ = item }" : ""}
  ${earlyReturn ? "if err := validate(); err != nil { http.Error(w, \"bad\", 400); return }" : ""}
  json.NewEncoder(w).Encode(map[string]string{\"ok\": \"true\"})
}`;
  const result = analyzeComplexHandlers(body, { route });
  const handler = result.handlers[0];
  if (websocket) {
    return withCategory("net/http", {
      outcome: handler.safeToTransform ? "unexpected" : "blocked",
      safeToTransform: handler.safeToTransform,
    });
  }
  if (multipart || goroutine) {
    return withCategory("net/http", {
      outcome: handler.safeToTransform ? "partial" : "blocked",
      safeToTransform: handler.safeToTransform,
    });
  }
  return withCategory("net/http", {
    outcome: handler.safeToTransform ? "supported" : "unexpected",
    safeToTransform: handler.safeToTransform,
  });
}

function evaluateGinScenario({ bind, middleware, param, responseCode }) {
  const source = `
router${middleware ? ".Use(AuthMiddleware, LoggingMiddleware)" : ""}
func create(c *gin.Context) {
  ${param ? 'id := c.Param("id")' : ""}
  ${bind ? "c.BindJSON(&req)" : ""}
  c.JSON(${responseCode}, gin.H{"ok": true})
}`;
  const result = detectGinPatterns(source);
  const supported = (!param || result.params.includes("id")) && (!bind || result.bindings.includes("req"));
  if (responseCode >= 500) {
    return withCategory("gin", {
      outcome: supported ? "partial" : "unexpected",
    });
  }
  return withCategory("gin", {
    outcome: supported ? "supported" : "unexpected",
  });
}

function evaluateChiScenario({ mount, middleware, param }) {
  const source = `
r${middleware ? ".Use(Auth)" : ""}
${mount ? 'r.Mount("/api/v1", apiRouter)' : ""}
func get(w http.ResponseWriter, r *http.Request) {
  ${param ? 'id := chi.URLParam(r, "id")' : ""}
}`;
  const result = detectChiPatterns(source);
  const supported = (!mount || result.mounts.includes("/api/v1")) && (!param || result.params.includes("id"));
  return withCategory("chi", {
    outcome: supported ? "supported" : "unexpected",
  });
}

function evaluateMuxScenario({ prefix, methods, param, headers }) {
  const source = `
r := mux.NewRouter()
${prefix ? 's := r.PathPrefix("/api").Subrouter()' : ""}
${headers ? 'r.Headers("X-Requested-With", "XMLHttpRequest")' : ""}
r.HandleFunc("/users/{id}", getUser)${methods ? '.Methods("GET", "POST")' : ""}
${param ? 'vars := mux.Vars(r); _ = vars["id"]' : ""}
`;
  const result = detectMuxPatterns(source);
  const supported = (!prefix || result.prefixes.includes("/api")) && (!param || result.params.includes("id"));
  return withCategory("mux", {
    outcome: headers ? (supported ? "partial" : "unexpected") : supported ? "supported" : "unexpected",
  });
}

function evaluateFastApiScenario({ router, dependency, websocket, model }) {
  const source = `
${router ? "router = APIRouter()" : ""}
@${router ? "router" : "app"}.${websocket ? "websocket" : "get"}("/users/{id}")
def get_user(${dependency ? "user=Depends(current_user)" : ""}):
    return {"ok": True}
${model ? "class User(BaseModel):\n    id: int" : ""}
${router ? "app.include_router(router)" : ""}
`;
  const result = detectFastApiPatterns(source);
  if (websocket) {
    return withCategory("fastapi", {
      outcome: result.websockets.length === 1 ? "partial" : "unexpected",
    });
  }
  const supported = (!router || result.routers.includes("router")) && (!dependency || result.dependencies.includes("current_user"));
  return withCategory("fastapi", {
    outcome: supported ? "supported" : "unexpected",
  });
}

function evaluateFlaskScenario({ blueprint, errorHandler, args }) {
  const source = `
${blueprint ? 'bp = Blueprint("users", __name__)' : ""}
@${blueprint ? "bp" : "app"}.route("/users/<id>", methods=["GET"])
def get_user():
  ${args ? 'request.args.get("page")' : ""}
  return {}
${errorHandler ? `@${blueprint ? "bp" : "app"}.errorhandler(404)\ndef missing(err):\n  return {}, 404` : ""}
`;
  const result = detectFlaskPatterns(source);
  const supported = (!blueprint || result.blueprints.includes("bp")) && (!args || result.requestArgs.includes("page"));
  if (errorHandler) {
    return withCategory("flask", {
      outcome: supported && result.errorHandlers.length > 0 ? "supported" : "unexpected",
    });
  }
  return withCategory("flask", {
    outcome: supported ? "supported" : "unexpected",
  });
}

export async function run() {
  const results = [];

  for (const scenario of [
    { earlyReturn: true, multipart: false, websocket: false, goroutine: false, loop: false, route: "/users/{id}" },
    { earlyReturn: false, multipart: false, websocket: false, goroutine: false, loop: true, route: "/users/{id}" },
    { earlyReturn: true, multipart: true, websocket: false, goroutine: false, loop: false, route: "/upload/{id}" },
    { earlyReturn: false, multipart: false, websocket: true, goroutine: false, loop: false, route: "/stream" },
    { earlyReturn: true, multipart: false, websocket: false, goroutine: true, loop: false, route: "/jobs/{id}" },
    { earlyReturn: false, multipart: false, websocket: false, goroutine: false, loop: false, route: "/health" },
    { earlyReturn: true, multipart: false, websocket: false, goroutine: false, loop: true, route: "/teams/{team_id}/users/{id}" },
    { earlyReturn: false, multipart: true, websocket: false, goroutine: false, loop: true, route: "/imports/{id}" },
    { earlyReturn: true, multipart: false, websocket: false, goroutine: true, loop: true, route: "/async/{id}" },
    { earlyReturn: false, multipart: false, websocket: false, goroutine: false, loop: false, route: "/users/{id}/posts/{post_id}" },
  ]) {
    results.push(evaluateNetHttpScenario(scenario));
  }

  for (const scenario of [
    { bind: true, middleware: true, param: true, responseCode: 200 },
    { bind: true, middleware: false, param: false, responseCode: 201 },
    { bind: false, middleware: true, param: true, responseCode: 404 },
    { bind: true, middleware: true, param: true, responseCode: 500 },
    { bind: false, middleware: false, param: true, responseCode: 200 },
    { bind: true, middleware: false, param: true, responseCode: 422 },
    { bind: true, middleware: true, param: false, responseCode: 202 },
    { bind: false, middleware: true, param: true, responseCode: 401 },
    { bind: true, middleware: false, param: true, responseCode: 503 },
    { bind: false, middleware: false, param: false, responseCode: 204 },
  ]) {
    results.push(evaluateGinScenario(scenario));
  }

  for (const scenario of [
    { mount: true, middleware: true, param: true },
    { mount: false, middleware: true, param: true },
    { mount: true, middleware: false, param: false },
    { mount: false, middleware: false, param: true },
    { mount: true, middleware: true, param: false },
    { mount: false, middleware: false, param: false },
    { mount: true, middleware: false, param: true },
    { mount: false, middleware: true, param: false },
    { mount: true, middleware: true, param: true },
  ]) {
    results.push(evaluateChiScenario(scenario));
  }

  for (const scenario of [
    { prefix: true, methods: true, param: true, headers: false },
    { prefix: false, methods: true, param: true, headers: false },
    { prefix: true, methods: false, param: false, headers: false },
    { prefix: true, methods: true, param: true, headers: true },
    { prefix: false, methods: false, param: true, headers: false },
    { prefix: true, methods: true, param: false, headers: true },
    { prefix: false, methods: true, param: false, headers: false },
    { prefix: true, methods: false, param: true, headers: false },
    { prefix: false, methods: true, param: true, headers: true },
  ]) {
    results.push(evaluateMuxScenario(scenario));
  }

  for (const scenario of [
    { router: true, dependency: true, websocket: false, model: true },
    { router: false, dependency: true, websocket: false, model: false },
    { router: true, dependency: false, websocket: false, model: true },
    { router: true, dependency: true, websocket: true, model: false },
    { router: false, dependency: false, websocket: false, model: true },
    { router: true, dependency: false, websocket: true, model: false },
    { router: false, dependency: true, websocket: false, model: true },
    { router: true, dependency: true, websocket: false, model: false },
    { router: false, dependency: false, websocket: true, model: false },
  ]) {
    results.push(evaluateFastApiScenario(scenario));
  }

  for (const scenario of [
    { blueprint: true, errorHandler: true, args: true },
    { blueprint: false, errorHandler: false, args: true },
    { blueprint: true, errorHandler: false, args: false },
    { blueprint: false, errorHandler: true, args: true },
    { blueprint: true, errorHandler: true, args: false },
    { blueprint: false, errorHandler: false, args: false },
    { blueprint: true, errorHandler: false, args: true },
    { blueprint: false, errorHandler: true, args: false },
    { blueprint: true, errorHandler: true, args: true },
  ]) {
    results.push(evaluateFlaskScenario(scenario));
  }

  const unexpected = results.filter((entry) => entry.outcome === "unexpected");
  assert.equal(unexpected.length, 0, `Unexpected unsupported scenarios: ${JSON.stringify(unexpected)}`);

  const supported = results.filter((entry) => entry.outcome === "supported").length;
  const partial = results.filter((entry) => entry.outcome === "partial").length;
  const blocked = results.filter((entry) => entry.outcome === "blocked").length;
  const categorySummary = Object.fromEntries(
    [...new Set(results.map((entry) => entry.category))].map((category) => {
      const entries = results.filter((entry) => entry.category === category);
      const supportedCount = entries.filter((entry) => entry.outcome === "supported").length;
      const partialCount = entries.filter((entry) => entry.outcome === "partial").length;
      const blockedCount = entries.filter((entry) => entry.outcome === "blocked").length;
      return [category, {
        blocked: blockedCount,
        cases: entries.length,
        partial: partialCount,
        safeHandlingRate: Number(((supportedCount + partialCount + blockedCount) / entries.length).toFixed(2)),
        supportRate: Number((supportedCount / entries.length).toFixed(2)),
        supported: supportedCount,
      }];
    }),
  );

  assert.equal(results.length, 56);
  assert.ok(supported >= 40);
  assert.ok(blocked >= 2);

  console.log(JSON.stringify({
    blocked,
    categories: categorySummary,
    launchCases: results.length,
    partial,
    supported,
    supportRate: Number((supported / results.length).toFixed(2)),
    safeHandlingRate: Number(((supported + partial + blocked) / results.length).toFixed(2)),
  }, null, 2));
}

if (import.meta.main) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
