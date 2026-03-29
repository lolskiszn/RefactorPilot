import { analyzeHttpErrors, renderGrpcErrorReturn } from "./error-mapper.js";
import { analyzeMiddleware, generateInterceptors } from "./middleware-transformer.js";
import { detectChiPatterns } from "./framework-parsers/chi-parser.js";
import { detectFastApiPatterns } from "./framework-parsers/fastapi-parser.js";
import { detectFlaskPatterns } from "./framework-parsers/flask-parser.js";
import { detectGinPatterns } from "./framework-parsers/gin-parser.js";
import { detectMuxPatterns } from "./framework-parsers/mux-parser.js";

const HANDLER_RE = /func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s+http\.ResponseWriter\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s+\*http\.Request\s*\)\s*\{([\s\S]*?)\n\}/g;
const ROUTE_PARAM_RE = /\/\{([^}]+)\}/g;

function detectFramework(source) {
  const text = String(source ?? "");
  if (/gin\./.test(text) || /\bc \*gin\.Context\b/.test(text)) {
    return detectGinPatterns(text);
  }
  if (/chi\./.test(text)) {
    return detectChiPatterns(text);
  }
  if (/mux\./.test(text)) {
    return detectMuxPatterns(text);
  }
  if (/@app\.(get|post|put|patch|delete)\(/.test(text) || /\bFastAPI\(/.test(text)) {
    return detectFastApiPatterns(text);
  }
  if (/@app\.route\(/.test(text) || /\bFlask\(/.test(text)) {
    return detectFlaskPatterns(text);
  }
  return {
    framework: "net/http",
  };
}

function extractRouteParams(route) {
  return [...String(route ?? "").matchAll(ROUTE_PARAM_RE)].map((match) => match[1]);
}

function classifyComplexity(body, frameworkInfo, errors, middleware) {
  const reasons = [];
  let score = 0.45;

  if ((frameworkInfo.framework ?? "net/http") === "net/http") {
    score += 0.2;
    reasons.push("standard-library-handler");
  }
  if (errors.length > 0) {
    score += 0.1;
    reasons.push("mappable-http-errors");
  }
  if (middleware.length <= 2) {
    score += 0.1;
    reasons.push("shallow-middleware-chain");
  }
  if (/for\s+|range\s+/.test(body)) {
    score -= 0.1;
    reasons.push("loop-detected");
  }
  if (/goroutine|go\s+[A-Za-z_]/.test(body)) {
    score -= 0.2;
    reasons.push("goroutine-detected");
  }
  if (/websocket|Upgrader|Upgrade\(/i.test(body)) {
    score = Math.min(score, 0.2);
    reasons.push("websocket-blocker");
  }
  if (/multipart\/form-data|ParseMultipartForm|FormFile\(/.test(body)) {
    score = Math.min(score, 0.35);
    reasons.push("multipart-warning");
  }

  return {
    reasons,
    score: Math.max(0, Math.min(1, Number(score.toFixed(2)))),
  };
}

function buildGrpcHandler(handlerName, requestType, responseType, body, errors) {
  const mappedErrors = errors.map((entry) => `    // ${entry.kind} ${entry.httpCode} -> ${entry.grpcCode}\n    ${renderGrpcErrorReturn(entry)}`);
  const transformedBody = body
    .replace(/json\.NewDecoder\(\s*\w+\.Body\s*\)\.Decode\(\s*&([A-Za-z_][A-Za-z0-9_]*)\s*\)/g, "$1 = req")
    .replace(/json\.NewEncoder\(\s*\w+\s*\)\.Encode\(\s*([^)]+)\)/g, "return &" + responseType + "{}, nil")
    .replace(/http\.Error\([^)]+\)\s*\n\s*return/g, mappedErrors[0] ?? "    return nil, status.Errorf(codes.Internal, \"handler error\")")
    .trim();

  return `func (s *Service) ${handlerName}(ctx context.Context, req *${requestType}) (*${responseType}, error) {\n    _ = ctx\n    _ = req\n${mappedErrors.join("\n")}\n    ${transformedBody || `return &${responseType}{}, nil`}\n}\n`;
}

export function analyzeComplexHandlers(source, options = {}) {
  const text = String(source ?? "");
  const frameworkInfo = detectFramework(text);
  const middleware = analyzeMiddleware(text, frameworkInfo.framework);
  const interceptors = generateInterceptors(middleware);
  const handlers = [];

  for (const match of text.matchAll(HANDLER_RE)) {
    const name = match[1];
    const body = match[4];
    const errors = analyzeHttpErrors(body);
    const complexity = classifyComplexity(body, frameworkInfo, errors, middleware);
    handlers.push({
      errors,
      framework: frameworkInfo.framework,
      grpcPreview: buildGrpcHandler(name, `${name}Request`, `${name}Response`, body, errors),
      interceptors,
      middleware,
      name,
      pathParams: frameworkInfo.params ?? [],
      routeParams: extractRouteParams(options.route ?? ""),
      safeToTransform: complexity.score >= 0.5 && !complexity.reasons.includes("websocket-blocker"),
      score: complexity.score,
      scoreReasons: complexity.reasons,
    });
  }

  return {
    framework: frameworkInfo.framework,
    handlers,
    interceptors,
    middleware,
    warnings: handlers.flatMap((handler) => handler.scoreReasons.filter((reason) => /warning|blocker|goroutine/.test(reason))),
  };
}
