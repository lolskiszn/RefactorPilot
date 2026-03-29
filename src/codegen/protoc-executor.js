import { spawn } from "node:child_process";

function parseCommand(command) {
  const tokens = [];
  const matcher = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of String(command ?? "").matchAll(matcher)) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  const [file, ...args] = tokens;
  return {
    args,
    file,
  };
}

function parseProtoFields(body) {
  const fields = [];
  const fieldRe = /^\s*[A-Za-z0-9_.]+\s+([a-zA-Z_][A-Za-z0-9_]*)\s*=\s*(\d+)\s*;/gm;
  for (const match of String(body ?? "").matchAll(fieldRe)) {
    fields.push({
      name: match[1],
      number: Number(match[2]),
    });
  }
  return fields;
}

function heuristicProtoIssues(protoPath, content) {
  const text = String(content ?? "");
  const issues = [];
  if (!/^syntax\s*=\s*"proto3";/m.test(text)) {
    issues.push({
      category: "SyntaxError",
      file: protoPath,
      message: "Missing proto3 syntax declaration.",
    });
  }
  if (!/^package\s+[A-Za-z0-9_.]+;/m.test(text)) {
    issues.push({
      category: "PackageError",
      file: protoPath,
      message: "Missing package declaration.",
    });
  }

  const braceDelta = (text.match(/\{/g) ?? []).length - (text.match(/\}/g) ?? []).length;
  if (braceDelta !== 0) {
    issues.push({
      category: "SyntaxError",
      file: protoPath,
      message: "Unbalanced braces in proto output.",
    });
  }

  const messageRe = /message\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)\}/g;
  for (const match of text.matchAll(messageRe)) {
    const fields = parseProtoFields(match[2]);
    const numbers = new Set();
    const names = new Set();
    for (const field of fields) {
      if (numbers.has(field.number)) {
        issues.push({
          category: "ProtoConflict",
          file: protoPath,
          message: `Field number ${field.number} already used in message ${match[1]}.`,
        });
      }
      if (names.has(field.name)) {
        issues.push({
          category: "ProtoConflict",
          file: protoPath,
          message: `Field name ${field.name} already used in message ${match[1]}.`,
        });
      }
      numbers.add(field.number);
      names.add(field.name);
    }
  }

  return issues;
}

function parseProtocErrors(stderr, fileHint) {
  const text = String(stderr ?? "");
  const issues = [];

  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    if (/already been used|already used/i.test(line)) {
      issues.push({
        category: "ProtoConflict",
        file: fileHint,
        message: line.trim(),
      });
      continue;
    }
    if (/Import .* was not found/i.test(line)) {
      issues.push({
        category: "ImportError",
        file: fileHint,
        message: line.trim(),
      });
      continue;
    }
    if (/reserved/i.test(line)) {
      issues.push({
        category: "ReservedNameViolation",
        file: fileHint,
        message: line.trim(),
      });
      continue;
    }
    if (/error/i.test(line)) {
      issues.push({
        category: "SyntaxError",
        file: fileHint,
        message: line.trim(),
      });
    }
  }

  return issues;
}

async function runProcess(file, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5000;
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      child.kill();
      resolve({
        code: 124,
        stderr: "Process timed out.",
        stdout: "",
      });
    }, timeoutMs);

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        code: 127,
        stderr: error.message,
        stdout,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code: code ?? 1,
        stderr,
        stdout,
      });
    });
  });
}

export async function executeProtocPlan(plan, options = {}) {
  const outputs = options.outputs ?? [];
  const protoOutput = outputs.find((entry) => entry.kind === "proto");
  const heuristicIssues = heuristicProtoIssues(plan?.protoPath ?? protoOutput?.path ?? "generated.proto", protoOutput?.content ?? "");
  const runner = options.runner;

  if (!plan?.commands?.length) {
    return {
      checked: true,
      commands: [],
      issues: heuristicIssues,
      mode: "heuristic",
      passed: heuristicIssues.length === 0,
      status: heuristicIssues.length === 0 ? "passed" : "failed",
    };
  }

  if (!runner) {
    return {
      checked: true,
      commands: plan.commands,
      issues: heuristicIssues,
      mode: "heuristic",
      passed: heuristicIssues.length === 0,
      status: heuristicIssues.length === 0 ? "passed" : "failed",
    };
  }

  const commandResults = [];
  const issues = [...heuristicIssues];
  let available = true;

  for (const command of plan.commands) {
    const parsed = parseCommand(command);
    const result = await runner({
      args: parsed.args,
      command,
      cwd: plan.workspace,
      file: parsed.file,
    });
    commandResults.push({
      ...result,
      command,
    });
    if (result.code === 127) {
      available = false;
    }
    if (result.code !== 0) {
      issues.push(...parseProtocErrors(result.stderr, plan.protoPath));
    }
  }

  return {
    checked: available,
    commands: plan.commands,
    issues,
    mode: "process",
    passed: available && issues.length === 0 && commandResults.every((entry) => entry.code === 0),
    results: commandResults,
    status: !available ? "skipped" : issues.length === 0 ? "passed" : "failed",
  };
}

export async function executeProtocPlanWithLocalRunner(plan, options = {}) {
  return executeProtocPlan(plan, {
    ...options,
    runner: async ({ file, args, cwd }) => runProcess(file, args, {
      cwd,
      timeoutMs: options.timeoutMs,
    }),
  });
}

export { parseProtocErrors };
