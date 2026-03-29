const state = {
  workspace: "",
  scan: null,
  report: null,
  result: null,
};

const workspaceInput = document.getElementById("workspace");
const fieldInput = document.getElementById("field");
const toInput = document.getElementById("to");
const summaryEl = document.getElementById("summary");
const warningsEl = document.getElementById("warnings");
const impactedEl = document.getElementById("impacted");
const replacementsEl = document.getElementById("replacements");
const resultEl = document.getElementById("result");

document.getElementById("scan-btn").addEventListener("click", () => {
  runSafe(loadScan, summaryEl);
});

document.getElementById("preview-btn").addEventListener("click", () => {
  runSafe(loadPreview, resultEl);
});

document.getElementById("apply-btn").addEventListener("click", () => {
  runSafe(loadApply, resultEl);
});

workspaceInput.addEventListener("change", () => {
  state.workspace = workspaceInput.value.trim();
});

workspaceInput.value = state.workspace;
bootstrap().catch((error) => {
  renderError(resultEl, error.message);
});

async function bootstrap() {
  const health = await apiGet("/api/health");
  state.workspace = health.workspace || "";
  workspaceInput.value = state.workspace;
  await loadScan();
  await loadPreview();
}

async function runSafe(action, target) {
  try {
    await action();
  } catch (error) {
    renderError(target, error.message);
  }
}

async function loadScan() {
  state.workspace = workspaceInput.value.trim() || state.workspace;
  const data = await apiGet(`/api/scan?workspace=${encodeURIComponent(state.workspace)}`);
  if (data.ok === false) {
    throw new Error(data.error || "Scan failed");
  }
  state.scan = data;
  renderScan(data);
}

async function loadPreview() {
  const body = {
    workspace: workspaceInput.value.trim() || state.workspace,
    field: fieldInput.value.trim(),
    to: toInput.value.trim(),
  };
  const data = await apiPost("/api/preview", body);
  if (data.ok === false) {
    throw new Error(data.error || "Preview failed");
  }
  state.report = data.report;
  renderPreview(data.report);
}

async function loadApply() {
  const body = {
    workspace: workspaceInput.value.trim() || state.workspace,
    field: fieldInput.value.trim(),
    to: toInput.value.trim(),
  };
  const data = await apiPost("/api/apply", body);
  if (data.ok === false) {
    renderError(resultEl, data.error || "Apply failed");
    return;
  }
  state.result = data.result;
  renderApply(data.result);
}

function renderScan(data) {
  summaryEl.innerHTML = "";
  summaryEl.append(metric("Workspace", data.workspace));
  summaryEl.append(metric("Files", String(data.summary.scannedFiles)));
  summaryEl.append(metric("Graph Nodes", String(data.summary.graphNodes)));
  summaryEl.append(metric("Graph Edges", String(data.summary.graphEdges)));
  summaryEl.append(metric("Languages", data.summary.languages.join(", ") || "none"));
}

function renderPreview(report) {
  const confidenceClass = report.summary.confidence === "low" ? "danger" : report.summary.confidence === "medium" ? "warn" : "";
  warningsEl.innerHTML = "";
  warningsEl.append(item("Confidence", report.summary.confidence, confidenceClass));
  for (const note of report.plan.notes) {
    warningsEl.append(item("Note", note));
  }

  impactedEl.innerHTML = "";
  if (report.plan.impactedFiles.length === 0) {
    impactedEl.append(item("Impacted Files", "None found"));
  } else {
    report.plan.impactedFiles.forEach((entry) => {
      impactedEl.append(
        item(
          entry.path,
          `${entry.language} • fields ${entry.fieldMatches.length} • usages ${entry.usageMatches.length}`,
        ),
      );
    });
  }

  replacementsEl.innerHTML = "";
  if (report.plan.replacements.length === 0) {
    replacementsEl.append(item("Replacement Preview", "No candidates"));
  } else {
    report.plan.replacements.slice(0, 12).forEach((replacement) => {
      replacementsEl.append(
        item(
          `${replacement.path}:${replacement.line}:${replacement.column}`,
          `${replacement.before} -> ${replacement.after}`,
        ),
      );
    });
  }
}

function renderApply(result) {
  resultEl.innerHTML = "";
  if (result.ok) {
    resultEl.append(item("Status", `Applied to ${result.changedFiles.length} files`, ""));
    resultEl.append(item("Backup", result.backupRoot));
    result.changedFiles.forEach((file) => resultEl.append(item("Changed", file)));
    return;
  }

  resultEl.append(item("Status", result.status));
  if (result.error) {
    resultEl.append(item("Error", result.error));
  }
  if (result.validation) {
    result.validation.issues.forEach((issue) => {
      resultEl.append(item(issue.kind, issue.message));
    });
  }
}

function metric(label, value) {
  const el = document.createElement("div");
  el.className = "metric";
  el.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>`;
  return el;
}

function item(title, description, statusClass = "") {
  const el = document.createElement("div");
  el.className = "item";
  el.innerHTML = `
    <div class="status ${statusClass}">${escapeHtml(title)}</div>
    <div>${escapeHtml(description)}</div>
  `;
  return el;
}

function renderError(target, message) {
  target.innerHTML = "";
  target.append(item("Error", message, "danger"));
}

async function apiGet(url) {
  const response = await fetch(url);
  return response.json();
}

async function apiPost(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return response.json();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
