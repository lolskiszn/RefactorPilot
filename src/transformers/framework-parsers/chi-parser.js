export function detectChiPatterns(source) {
  const text = String(source ?? "");
  return {
    framework: "chi",
    mounts: [...text.matchAll(/\.Mount\(\s*["']([^"']+)["']/g)].map((match) => match[1]),
    middleware: [...text.matchAll(/\.Use\(([^)]+)\)/g)].map((match) => match[1]),
    params: [...text.matchAll(/chi\.URLParam\(\s*\w+\s*,\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]),
  };
}
