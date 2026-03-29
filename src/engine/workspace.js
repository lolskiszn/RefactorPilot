import path from "node:path";

import { analyzeGoSource, analyzePythonSource, analyzeTypeScriptSource } from "../orchestration/frontends/index.js";
import { buildGraph } from "./graph.js";
import { readText, relativeTo, walkWorkspace } from "../shared/file-system.js";

const SUPPORTED_EXTENSIONS = new Set([".go", ".py", ".ts", ".tsx", ".js", ".jsx"]);

export async function scanWorkspace(rootDir, options = {}) {
  const absoluteRoot = path.resolve(rootDir);
  const files = await walkWorkspace(absoluteRoot, SUPPORTED_EXTENSIONS);
  const analyses = [];
  const includeSource = options.includeSource !== false;
  const compactGraph = Boolean(options.compactGraph);

  for (const filePath of files) {
    const source = await readText(filePath);
    const relativePath = relativeTo(absoluteRoot, filePath);
    const extension = path.extname(filePath);
    const base = {
      absolutePath: filePath,
      path: relativePath,
    };

    if (extension === ".go") {
      analyses.push({
        ...base,
        ...analyzeGoSource(source, relativePath),
        ...(includeSource ? { source } : {}),
      });
    } else if (extension === ".py") {
      analyses.push({
        ...base,
        ...analyzePythonSource(source, relativePath),
        ...(includeSource ? { source } : {}),
      });
    } else {
      analyses.push({
        ...base,
        ...analyzeTypeScriptSource(source, relativePath),
        ...(includeSource ? { source } : {}),
      });
    }
  }

  const scanResult = {
    files: analyses,
    rootDir: absoluteRoot,
  };

  return {
    ...scanResult,
    graph: buildGraph(scanResult, {
      compactMetadata: compactGraph,
    }),
  };
}
