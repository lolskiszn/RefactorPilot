function swapType(text, fromType, toType) {
  if (!fromType || !toType) {
    return text;
  }
  return String(text).replace(new RegExp(`\\b${fromType}\\b`, "g"), toType);
}

function matchesIssueFile(entryPath, issueFile) {
  if (!issueFile) {
    return true;
  }
  const normalizedEntry = String(entryPath).replace(/\\/g, "/");
  const normalizedIssue = String(issueFile).replace(/\\/g, "/");
  return normalizedEntry === normalizedIssue || normalizedIssue.endsWith(normalizedEntry) || normalizedEntry.endsWith(normalizedIssue);
}

export const typeAdjuster = {
  id: "type-adjuster",
  canRepair(issue) {
    return issue.kind === "type_mismatch" || issue.kind === "proto_conflict";
  },
  repair(outputs, issue) {
    let changed = false;
    const nextOutputs = outputs.map((entry) => {
      if (issue.file && !matchesIssueFile(entry.path, issue.file) && !(issue.kind === "type_mismatch" && entry.path.endsWith(".proto"))) {
        return entry;
      }
      let updated = entry.content;
      if (issue.kind === "type_mismatch") {
        if (/int32/i.test(issue.expectedType ?? "") && /\bint64\b/i.test(issue.message ?? "")) {
          updated = swapType(updated, "int64", "int32");
        } else if (/int64/i.test(issue.expectedType ?? "") && /\bint32\b/i.test(issue.message ?? "")) {
          updated = swapType(updated, "int32", "int64");
        }
      }
      if (issue.kind === "proto_conflict" && issue.conflictNumber && entry.path.endsWith(".proto")) {
        updated = updated.replace(new RegExp(`=\\s*${issue.conflictNumber}\\s*;`), `= ${issue.conflictNumber + 1};`);
      }
      changed ||= updated !== entry.content;
      return {
        ...entry,
        content: updated,
      };
    });
    return {
      applied: changed,
      outputs: nextOutputs,
      summary: changed ? `Adjusted generated types for ${issue.file ?? "artifact"}.` : null,
    };
  },
};
