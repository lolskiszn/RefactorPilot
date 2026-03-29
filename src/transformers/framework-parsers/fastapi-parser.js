export function detectFastApiPatterns(source) {
  const text = String(source ?? "");
  return {
    dependencies: [...text.matchAll(/Depends\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/g)].map((match) => match[1]),
    framework: "fastapi",
    includeRouters: [...text.matchAll(/(?:app|router)\.include_router\(\s*([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[1]),
    methods: [...text.matchAll(/@(app|router)\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g)].map((match) => ({
      owner: match[1],
      method: match[2].toUpperCase(),
      route: match[3],
    })),
    models: [...text.matchAll(/class\s+([A-Za-z_][A-Za-z0-9_]*)\((?:BaseModel|pydantic\.BaseModel)\)/g)].map((match) => match[1]),
    routers: [...text.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*APIRouter\(/g)].map((match) => match[1]),
    websockets: [...text.matchAll(/@(app|router)\.websocket\(\s*["']([^"']+)["']/g)].map((match) => ({
      owner: match[1],
      route: match[2],
    })),
  };
}
