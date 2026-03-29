export function detectMuxPatterns(source) {
  const text = String(source ?? "");
  const params = new Set([
    ...[...text.matchAll(/mux\.Vars\(\w+\)\s*\[\s*["']([^"']+)["']\s*\]/g)].map((match) => match[1]),
    ...[...text.matchAll(/["'][^"']*\{([^}]+)\}[^"']*["']/g)].map((match) => match[1]),
  ]);
  return {
    framework: "gorilla/mux",
    methods: [...text.matchAll(/\.Methods\(([^)]+)\)/g)].map((match) => match[1]),
    params: [...params],
    prefixes: [...text.matchAll(/\.PathPrefix\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]),
  };
}
