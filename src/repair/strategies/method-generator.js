function buildStub(symbol) {
  return `
func (s *Service) ${symbol}(ctx context.Context, req *struct{}) (*struct{}, error) {
    _ = ctx
    _ = req
    return &struct{}{}, nil
}
`;
}

function matchesIssueFile(entryPath, issueFile) {
  if (!issueFile) {
    return true;
  }
  const normalizedEntry = String(entryPath).replace(/\\/g, "/");
  const normalizedIssue = String(issueFile).replace(/\\/g, "/");
  return normalizedEntry === normalizedIssue || normalizedIssue.endsWith(normalizedEntry) || normalizedEntry.endsWith(normalizedIssue);
}

export const methodGenerator = {
  id: "method-generator",
  canRepair(issue) {
    return issue.kind === "undefined_symbol" && Boolean(issue.symbol);
  },
  repair(outputs, issue) {
    let changed = false;
    const nextOutputs = outputs.map((entry) => {
      if (!matchesIssueFile(entry.path, issue.file) || !entry.path.endsWith(".go")) {
        return entry;
      }
      if (new RegExp(`func\\s+\\(s \\*Service\\)\\s+${issue.symbol}\\b`).test(entry.content)) {
        return entry;
      }
      const updated = `${entry.content.trimEnd()}\n${buildStub(issue.symbol)}\n`;
      changed = true;
      return {
        ...entry,
        content: updated,
      };
    });
    return {
      applied: changed,
      outputs: nextOutputs,
      summary: changed ? `Generated stub method ${issue.symbol}.` : null,
    };
  },
};
