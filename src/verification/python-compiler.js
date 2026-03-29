function parsePythonCompilerErrors(stderr, filePath) {
  const issues = [];
  for (const line of String(stderr ?? "").split(/\r?\n/).filter(Boolean)) {
    if (/ModuleNotFoundError|ImportError/i.test(line)) {
      issues.push({
        category: "ImportError",
        file: filePath,
        message: line.trim(),
      });
      continue;
    }
    if (/NameError|undefined name/i.test(line)) {
      issues.push({
        category: "UndefinedSymbol",
        file: filePath,
        message: line.trim(),
      });
      continue;
    }
    if (/SyntaxError|IndentationError|mypy:/i.test(line)) {
      issues.push({
        category: "SyntaxError",
        file: filePath,
        message: line.trim(),
      });
    }
  }
  return issues;
}

function heuristicPythonIssues(filePath, content) {
  const text = String(content ?? "");
  const issues = [];
  const lines = text.split(/\r?\n/);
  let balance = 0;
  for (const ch of text) {
    if (ch === "(" || ch === "[" || ch === "{") {
      balance += 1;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      balance -= 1;
    }
  }
  if (balance !== 0) {
    issues.push({
      category: "SyntaxError",
      file: filePath,
      message: "Unbalanced delimiters in Python output.",
    });
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*(def|class)\s+/.test(line)) {
      const next = lines[index + 1] ?? "";
      if (next.trim() && !/^\s+/.test(next)) {
        issues.push({
          category: "SyntaxError",
          file: filePath,
          message: `Expected indented block after line ${index + 1}.`,
        });
      }
    }
  }

  if (/build_default_client\(/.test(text) && !/from grpc_client import build_default_client/.test(text)) {
    issues.push({
      category: "ImportError",
      file: filePath,
      importName: "grpc_client.build_default_client",
      message: "Missing build_default_client import.",
      symbol: "build_default_client",
    });
  }

  return issues;
}

export async function verifyPythonCompilation(outputs, options = {}) {
  const pythonOutputs = (outputs ?? []).filter((entry) => entry.path?.endsWith(".py"));
  if (pythonOutputs.length === 0) {
    return {
      checked: true,
      issues: [],
      mode: "heuristic",
      passed: true,
      status: "skipped",
    };
  }

  const runner = options.runner;
  const heuristicIssues = pythonOutputs.flatMap((entry) => heuristicPythonIssues(entry.path, entry.content));

  if (!runner) {
    return {
      checked: true,
      files: pythonOutputs.map((entry) => entry.path),
      issues: heuristicIssues,
      mode: "heuristic",
      passed: heuristicIssues.length === 0,
      status: heuristicIssues.length === 0 ? "passed" : "failed",
    };
  }

  const result = await runner({
    files: pythonOutputs,
    workspace: options.workspace,
  });
  const issues = [
    ...heuristicIssues,
    ...parsePythonCompilerErrors(result.stderr, pythonOutputs[0].path),
  ];
  return {
    checked: result.code !== 127,
    files: pythonOutputs.map((entry) => entry.path),
    issues,
    mode: "process",
    passed: result.code === 0 && issues.length === 0,
    raw: result,
    status: result.code === 127 ? "skipped" : issues.length === 0 ? "passed" : "failed",
  };
}

export { parsePythonCompilerErrors };
