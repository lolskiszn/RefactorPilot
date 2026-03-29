const GIN_MIDDLEWARE_RE = /\.Use\(([^)]+)\)/g;
const STANDARD_MIDDLEWARE_RE = /([A-Za-z_][A-Za-z0-9_]*)\(\s*handler\s*\)/g;
const AUTH_HINT_RE = /(auth|jwt|session|oauth)/i;
const LOGGING_HINT_RE = /(log|logger|logging|zap|slog)/i;
const RECOVERY_HINT_RE = /(recover|panic)/i;

function classifyMiddleware(name) {
  if (AUTH_HINT_RE.test(name)) {
    return "auth";
  }
  if (LOGGING_HINT_RE.test(name)) {
    return "logging";
  }
  if (RECOVERY_HINT_RE.test(name)) {
    return "recovery";
  }
  return "generic";
}

export function analyzeMiddleware(source, framework = "net/http") {
  const text = String(source ?? "");
  const names = [];

  for (const match of text.matchAll(GIN_MIDDLEWARE_RE)) {
    const parts = match[1].split(",").map((part) => part.trim()).filter(Boolean);
    names.push(...parts);
  }

  for (const match of text.matchAll(STANDARD_MIDDLEWARE_RE)) {
    names.push(match[1]);
  }

  const deduped = [...new Set(names)];
  return deduped.map((name, index) => ({
    framework,
    index,
    interceptorName: `${sanitizeName(name)}Interceptor`,
    kind: classifyMiddleware(name),
    name,
  }));
}

export function generateInterceptors(middleware = []) {
  return middleware.map((entry) => ({
    kind: entry.kind,
    name: entry.interceptorName,
    source: `func ${entry.interceptorName}(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {\n    return handler(ctx, req)\n}`,
  }));
}

function sanitizeName(value) {
  return String(value ?? "middleware")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("") || "Middleware";
}
