import assert from "node:assert/strict";

import { detectChiPatterns } from "../../src/transformers/framework-parsers/chi-parser.js";
import { detectFastApiPatterns } from "../../src/transformers/framework-parsers/fastapi-parser.js";
import { detectFlaskPatterns } from "../../src/transformers/framework-parsers/flask-parser.js";
import { detectGinPatterns } from "../../src/transformers/framework-parsers/gin-parser.js";
import { detectMuxPatterns } from "../../src/transformers/framework-parsers/mux-parser.js";
import { analyzeMiddleware } from "../../src/transformers/middleware-transformer.js";

export async function run() {
  const gin = detectGinPatterns(`router.Use(AuthMiddleware, Logging)\n c.Param("id")\n c.JSON(404, err)\n c.BindJSON(&req)`);
  const chi = detectChiPatterns(`r.Use(Auth)\n chi.URLParam(r, "id")\n r.Mount("/api/v1", subrouter)`);
  const mux = detectMuxPatterns(`mux.Vars(r)["id"]\n r.PathPrefix("/api")\n r.Methods("GET")`);
  const fastapi = detectFastApiPatterns(`@app.get("/users/{id}")\ndef get_user(dep=Depends(auth_dep)): pass\nclass User(BaseModel): pass`);
  const flask = detectFlaskPatterns(`@app.route("/users/<id>", methods=["GET"])\ndef get_user():\n  request.args.get("limit")`);
  const fastapiRouter = detectFastApiPatterns(`router = APIRouter()\n@router.get("/teams/{team_id}")\ndef get_team(dep=Depends(auth_dep)): pass\napp.include_router(router)`);
  const flaskBlueprint = detectFlaskPatterns(`bp = Blueprint("users", __name__)\n@bp.route("/users/<id>", methods=["GET"])\ndef get_user():\n  request.args.get("page")\n@bp.errorhandler(404)\ndef missing(err):\n  return {}, 404`);

  assert.equal(gin.framework, "gin");
  assert.ok(gin.params.includes("id"));
  assert.ok(gin.middleware.some((entry) => entry.includes("AuthMiddleware")));
  assert.ok(gin.bindings.includes("req"));
  assert.equal(chi.framework, "chi");
  assert.ok(chi.params.includes("id"));
  assert.ok(chi.mounts.includes("/api/v1"));
  assert.equal(mux.framework, "gorilla/mux");
  assert.ok(mux.params.includes("id"));
  assert.ok(mux.prefixes.includes("/api"));
  assert.equal(fastapi.framework, "fastapi");
  assert.ok(fastapi.dependencies.includes("auth_dep"));
  assert.equal(fastapi.methods[0].route, "/users/{id}");
  assert.ok(fastapiRouter.routers.includes("router"));
  assert.ok(fastapiRouter.includeRouters.includes("router"));
  assert.equal(fastapiRouter.methods[0].owner, "router");
  assert.equal(flask.framework, "flask");
  assert.equal(flask.methods[0].route, "/users/<id>");
  assert.ok(flask.requestArgs.includes("limit"));
  assert.ok(flaskBlueprint.blueprints.includes("bp"));
  assert.equal(flaskBlueprint.methods[0].owner, "bp");
  assert.equal(flaskBlueprint.errorHandlers[0].code, "404");
  assert.ok(flaskBlueprint.requestArgs.includes("page"));

  const middleware = analyzeMiddleware(`router.Use(AuthMiddleware, LoggingMiddleware)\nRecovery(handler)`, "gin");
  assert.ok(middleware.length >= 2);

  console.log("framework matrix checks passed");
}

if (import.meta.main) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
