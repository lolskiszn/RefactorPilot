const REQUIRED_IMPORTS = [
  { packageName: "context", symbol: "context." },
  { packageName: "google.golang.org/grpc", symbol: "grpc." },
  { packageName: "google.golang.org/grpc/codes", symbol: "codes." },
  { packageName: "google.golang.org/grpc/status", symbol: "status." },
];

function parseImportBlock(content) {
  const importBlock = String(content ?? "").match(/import\s*\(([\s\S]*?)\)/);
  if (!importBlock) {
    return [];
  }
  return [...importBlock[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function parseGoCompilerErrors(stderr, filePath) {
  const issues = [];
  for (const line of String(stderr ?? "").split(/\r?\n/).filter(Boolean)) {
    if (/undefined:/i.test(line)) {
      issues.push({
        category: "UndefinedSymbol",
        file: filePath,
        message: line.trim(),
      });
      continue;
    }
    if (/cannot use .* as .*/i.test(line)) {
      issues.push({
        category: "TypeMismatch",
        file: filePath,
        message: line.trim(),
      });
      continue;
    }
    if (/syntax error|expected/i.test(line)) {
      issues.push({
        category: "SyntaxError",
        file: filePath,
        message: line.trim(),
      });
    }
  }
  return issues;
}

function heuristicGoIssues(filePath, content) {
  const text = String(content ?? "");
  const issues = [];
  if (!/^package\s+[A-Za-z_][A-Za-z0-9_]*/m.test(text)) {
    issues.push({
      category: "SyntaxError",
      file: filePath,
      message: "Missing package declaration.",
    });
  }

  const pairs = [
    ["{", "}"],
    ["(", ")"],
  ];
  for (const [left, right] of pairs) {
    const delta = (text.split(left).length - 1) - (text.split(right).length - 1);
    if (delta !== 0) {
      issues.push({
        category: "SyntaxError",
        file: filePath,
        message: `Unbalanced ${left}${right} pair.`,
      });
    }
  }

  const imports = parseImportBlock(text);
  for (const entry of REQUIRED_IMPORTS) {
    if (text.includes(entry.symbol) && !imports.includes(entry.packageName)) {
      issues.push({
        category: "ImportError",
        file: filePath,
        importName: entry.packageName,
        message: `Missing import ${entry.packageName}.`,
        symbol: entry.symbol.replace(/\.$/, ""),
      });
    }
  }

  return issues;
}

export async function verifyGoCompilation(outputs, options = {}) {
  const goOutputs = (outputs ?? []).filter((entry) => entry.path?.endsWith(".go"));
  if (goOutputs.length === 0) {
    return {
      checked: true,
      issues: [],
      mode: "heuristic",
      passed: true,
      status: "skipped",
    };
  }

  const runner = options.runner;
  const heuristicIssues = goOutputs.flatMap((entry) => heuristicGoIssues(entry.path, entry.content));

  if (!runner) {
    return {
      checked: true,
      files: goOutputs.map((entry) => entry.path),
      issues: heuristicIssues,
      mode: "heuristic",
      passed: heuristicIssues.length === 0,
      status: heuristicIssues.length === 0 ? "passed" : "failed",
    };
  }

  const result = await runner({
    files: goOutputs,
    workspace: options.workspace,
  });
  const issues = [
    ...heuristicIssues,
    ...parseGoCompilerErrors(result.stderr, goOutputs[0].path),
  ];
  return {
    checked: result.code !== 127,
    files: goOutputs.map((entry) => entry.path),
    issues,
    mode: "process",
    passed: result.code === 0 && issues.length === 0,
    raw: result,
    status: result.code === 127 ? "skipped" : issues.length === 0 ? "passed" : "failed",
  };
}

export { parseGoCompilerErrors };
