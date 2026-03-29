export function detectGinPatterns(source) {
  const text = String(source ?? "");
  return {
    bindings: [...text.matchAll(/c\.BindJSON\(\s*&([A-Za-z_][A-Za-z0-9_]*)\s*\)/g)].map((match) => match[1]),
    framework: "gin",
    middleware: [...text.matchAll(/\.Use\(([^)]+)\)/g)].map((match) => match[1]),
    params: [...text.matchAll(/c\.Param\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]),
    responses: [...text.matchAll(/c\.JSON\(\s*(\d{3})\s*,/g)].map((match) => Number(match[1])),
  };
}
