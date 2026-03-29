import path from "node:path";
import { fileURLToPath } from "node:url";

import { previewFieldRename, scanWorkspace } from "../orchestration/index.js";
import { applyFieldRename, validateFieldRenamePlan } from "./apply.js";
import { jsonResponse, notFoundResponse, readJsonBody, sendFile } from "./http.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.join(__dirname, "static");

export function createRequestHandler({ workspace }) {
  return async function requestHandler(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    const route = url.pathname;

    try {
      if (route === "/" || route === "/index.html") {
        return sendFile(res, path.join(STATIC_DIR, "index.html"), "text/html; charset=utf-8");
      }
      if (route === "/app.css") {
        return sendFile(res, path.join(STATIC_DIR, "app.css"), "text/css; charset=utf-8");
      }
      if (route === "/app.js") {
        return sendFile(res, path.join(STATIC_DIR, "app.js"), "application/javascript; charset=utf-8");
      }
      if (route === "/api/health") {
        return jsonResponse(res, {
          ok: true,
          workspace,
        });
      }
      if (route === "/api/scan" && req.method === "GET") {
        const targetWorkspace = url.searchParams.get("workspace") || workspace;
        const scan = await scanWorkspace(targetWorkspace);
        return jsonResponse(res, summarizeScan(scan));
      }
      if (route === "/api/preview" && req.method === "POST") {
        const body = await readJsonBody(req);
        const targetWorkspace = body.workspace || workspace;
        const fromField = body.field || body.from;
        const toField = body.to;
        if (!fromField || !toField) {
          return jsonResponse(res, { ok: false, error: "Missing field or to" }, 400);
        }

        const report = await previewFieldRename(targetWorkspace, fromField, toField);
        return jsonResponse(res, {
          ok: true,
          report: decorateReport(report),
        });
      }
      if (route === "/api/apply" && req.method === "POST") {
        const body = await readJsonBody(req);
        const targetWorkspace = body.workspace || workspace;
        const fromField = body.field || body.from;
        const toField = body.to;
        if (!fromField || !toField) {
          return jsonResponse(res, { ok: false, error: "Missing field or to" }, 400);
        }

        const result = await applyFieldRename(targetWorkspace, fromField, toField);
        return jsonResponse(res, {
          ok: true,
          result,
        });
      }
      if (route === "/api/validate" && req.method === "POST") {
        const body = await readJsonBody(req);
        const targetWorkspace = body.workspace || workspace;
        const fromField = body.field || body.from;
        const toField = body.to;
        if (!fromField || !toField) {
          return jsonResponse(res, { ok: false, error: "Missing field or to" }, 400);
        }

        const report = await previewFieldRename(targetWorkspace, fromField, toField);
        return jsonResponse(res, {
          ok: true,
          validation: validateFieldRenamePlan(report.plan),
        });
      }

      return notFoundResponse(res);
    } catch (error) {
      return jsonResponse(
        res,
        {
          ok: false,
          error: error.message,
        },
        500,
      );
    }
  };
}

function summarizeScan(scan) {
  return {
    ok: true,
    workspace: scan.rootDir,
    summary: {
      scannedFiles: scan.files.length,
      graphNodes: scan.graph.nodes.length,
      graphEdges: scan.graph.edges.length,
      languages: [...new Set(scan.files.map((file) => file.language))],
    },
    files: scan.files.map((file) => ({
      path: file.path,
      language: file.language,
      symbols: file.symbols.length,
      fields: file.fields.length,
      endpoints: file.endpoints.length,
    })),
  };
}

function decorateReport(report) {
  return {
    ...report,
    summary: {
      ...report.summary,
      warnings: report.plan.notes,
    },
  };
}
