const GO_SYMBOL_IMPORTS = new Map([
  ["context", "context"],
  ["grpc", "google.golang.org/grpc"],
  ["codes", "google.golang.org/grpc/codes"],
  ["status", "google.golang.org/grpc/status"],
]);

function updateGoImports(content, importPath) {
  if (!importPath || String(content).includes(`"${importPath}"`)) {
    return content;
  }
  if (/import\s*\(/.test(content)) {
    return content.replace(/import\s*\(([\s\S]*?)\)/, (full, body) => {
      const lines = body
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      lines.push(`"${importPath}"`);
      const ordered = [...new Set(lines)].sort();
      return `import (\n${ordered.map((line) => `    ${line}`).join("\n")}\n)`;
    });
  }
  return content.replace(/^package\s+[^\n]+\n/m, (match) => `${match}\nimport (\n    "${importPath}"\n)\n`);
}

function updatePythonImports(content, symbol) {
  if (symbol === "build_default_client" && !/from grpc_client import build_default_client/.test(content)) {
    return `from grpc_client import build_default_client\n\n${content.replace(/^\s+/, "")}`;
  }
  if (symbol === "grpc" && !/^import grpc$/m.test(content)) {
    return `import grpc\n\n${content.replace(/^\s+/, "")}`;
  }
  return content;
}

function matchesIssueFile(entryPath, issueFile) {
  if (!issueFile) {
    return true;
  }
  const normalizedEntry = String(entryPath).replace(/\\/g, "/");
  const normalizedIssue = String(issueFile).replace(/\\/g, "/");
  return normalizedEntry === normalizedIssue || normalizedIssue.endsWith(normalizedEntry) || normalizedEntry.endsWith(normalizedIssue);
}

export const importFixer = {
  id: "import-fixer",
  canRepair(issue) {
    return issue.kind === "missing_import";
  },
  repair(outputs, issue) {
    let changed = false;
    const nextOutputs = outputs.map((entry) => {
      if (!matchesIssueFile(entry.path, issue.file)) {
        return entry;
      }
      if (entry.path.endsWith(".go")) {
        const importPath = issue.importName ?? GO_SYMBOL_IMPORTS.get(issue.symbol ?? "");
        const updated = updateGoImports(entry.content, importPath);
        changed ||= updated !== entry.content;
        return {
          ...entry,
          content: updated,
        };
      }
      if (entry.path.endsWith(".py")) {
        const updated = updatePythonImports(entry.content, issue.symbol ?? issue.importName);
        changed ||= updated !== entry.content;
        return {
          ...entry,
          content: updated,
        };
      }
      return entry;
    });
    return {
      applied: changed,
      outputs: nextOutputs,
      summary: changed ? `Added missing import for ${issue.symbol ?? issue.importName}.` : null,
    };
  },
};
