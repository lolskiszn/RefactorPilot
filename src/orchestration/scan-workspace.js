import path from "node:path";

import { analyzeGoSource, analyzePythonSource, analyzeTypeScriptSource } from "./frontends/index.js";
import { buildGraph } from "../engine/graph.js";
import { readText, relativeTo, walkWorkspace } from "../shared/file-system.js";

const SUPPORTED_EXTENSIONS = new Set([".go", ".py", ".ts", ".tsx", ".js", ".jsx"]);

export async function scanWorkspace(rootDir, options = {}) {
  const absoluteRoot = path.resolve(rootDir);
  const filePaths = await walkWorkspace(absoluteRoot, SUPPORTED_EXTENSIONS);
  const files = [];
  const includeSource = options.includeSource !== false;
  const compactGraph = Boolean(options.compactGraph);

  for (const filePath of filePaths) {
    const source = await readText(filePath);
    const relativePath = relativeTo(absoluteRoot, filePath);
    const extension = path.extname(filePath);
    const analysis =
      extension === ".go"
        ? analyzeGoSource(source, relativePath)
        : extension === ".py"
          ? analyzePythonSource(source, relativePath)
          : analyzeTypeScriptSource(source, relativePath);

    files.push({
      ...analysis,
      absolutePath: filePath,
      parser: {
        language: analysis.language,
        maturity: "heuristic",
      },
      ...(includeSource ? { source } : {}),
    });
  }

  const scanResult = {
    files,
    rootDir: absoluteRoot,
  };

  return {
    ...scanResult,
    graph: buildGraph(scanResult, {
      compactMetadata: compactGraph,
    }),
  };
}
