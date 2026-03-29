function now() {
  return new Date().toISOString();
}

function detectGoTraceHints(file, targetField) {
  const source = String(file.source ?? "");
  const events = [];

  if (/json\.(Marshal|Unmarshal|NewEncoder|NewDecoder)/.test(source)) {
    events.push({
      type: "json_boundary",
      language: "go",
      file: file.path,
      field: targetField,
      timestamp: now(),
    });
  }

  if (/reflect\./.test(source) || /map\s*\[\s*string\s*\]\s*interface\s*\{\s*\}/.test(source)) {
    events.push({
      type: "dynamic_access",
      language: "go",
      file: file.path,
      field: targetField,
      timestamp: now(),
    });
  }

  return events;
}

function detectPythonTraceHints(file, targetField) {
  const source = String(file.source ?? "");
  const events = [];

  if (/payload\[[A-Za-z_][A-Za-z0-9_]*\]/.test(source) || /\.get\(\s*[A-Za-z_][A-Za-z0-9_]*\s*\)/.test(source)) {
    events.push({
      type: "dynamic_access",
      language: "python",
      file: file.path,
      field: targetField,
      timestamp: now(),
    });
  }

  if (/\.json\s*\(\s*\)|json\.(loads|dumps)/.test(source)) {
    events.push({
      type: "json_boundary",
      language: "python",
      file: file.path,
      field: targetField,
      timestamp: now(),
    });
  }

  return events;
}

export function buildInstrumentationPlan(scanResult, targetField) {
  return {
    go: {
      agent: "runtime/trace + trace.WithRegion/Log",
      eventShape: {
        type: "field_access",
        package: "models",
        struct: "User",
        field: targetField,
        timestamp: now(),
        goroutine_id: "g1",
        stack_hash: "hash",
      },
    },
    python: {
      agent: "sys.monitoring/sys.settrace compatible hook",
      eventShape: {
        type: "attribute_access",
        module: "models",
        class: "User",
        attr: targetField,
        timestamp: now(),
        thread_id: "t1",
      },
    },
    files: (scanResult.files ?? []).map((file) => file.path),
  };
}

export function collectDynamicTraceHints(scanResult, targetField) {
  const events = [];

  for (const file of scanResult.files ?? []) {
    if (file.language === "go") {
      events.push(...detectGoTraceHints(file, targetField));
    }
    if (file.language === "python") {
      events.push(...detectPythonTraceHints(file, targetField));
    }
  }

  return {
    events,
    plan: buildInstrumentationPlan(scanResult, targetField),
  };
}
