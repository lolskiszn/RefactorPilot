export function detectFlaskPatterns(source) {
  const text = String(source ?? "");
  return {
    blueprints: [...text.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*Blueprint\(/g)].map((match) => match[1]),
    errorHandlers: [...text.matchAll(/@(app|[A-Za-z_][A-Za-z0-9_]*)\.errorhandler\(\s*([^)]+)\)/g)].map((match) => ({
      code: match[2].trim(),
      owner: match[1],
    })),
    framework: "flask",
    methods: [...text.matchAll(/@(app|[A-Za-z_][A-Za-z0-9_]*)\.route\(\s*["']([^"']+)["'](?:,\s*methods=\[([^\]]+)\])?/g)].map((match) => ({
      methods: match[3] ?? "GET",
      owner: match[1],
      route: match[2],
    })),
    requestArgs: [...text.matchAll(/request\.args\.get\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]),
  };
}
