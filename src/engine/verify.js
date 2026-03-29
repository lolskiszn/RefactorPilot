import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";

export async function inspectWorkspaceEnvironment(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const manifests = await detectManifests(root);

  return {
    build: detectBuildCommands(root, manifests),
    git: await inspectGit(root),
    manifests,
    tests: detectTestCommands(root, manifests),
  };
}

async function detectManifests(root) {
  const result = {
    goMod: fs.existsSync(path.join(root, "go.mod")),
    packageJson: false,
    pyprojectToml: fs.existsSync(path.join(root, "pyproject.toml")),
    setupPy: fs.existsSync(path.join(root, "setup.py")),
  };

  try {
    const packageJsonPath = path.join(root, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
      result.packageJson = true;
      result.packageScripts = {
        build: Boolean(packageJson?.scripts?.build),
        test: Boolean(packageJson?.scripts?.test),
      };
    }
  } catch {
    result.packageJson = true;
    result.packageScripts = {
      build: false,
      test: false,
    };
  }

  return result;
}

function detectBuildCommands(root, manifests) {
  const commands = [];

  if (manifests.goMod || hasExtension(root, ".go")) {
    commands.push({ label: "Go build", command: "go build ./..." });
    commands.push({ label: "Go test", command: "go test ./..." });
  }

  if (manifests.pyprojectToml || manifests.setupPy || hasExtension(root, ".py")) {
    commands.push({ label: "Python syntax", command: "python -m py_compile <files>" });
    commands.push({ label: "Python tests", command: "python -m pytest" });
  }

  if (manifests.packageJson) {
    commands.push({ label: "Node build", command: "npm.cmd run build" });
    commands.push({ label: "Node tests", command: "npm.cmd test" });
  }

  return commands;
}

function detectTestCommands(root, manifests) {
  return detectBuildCommands(root, manifests).filter((entry) => /test/i.test(entry.label));
}

async function inspectGit(root) {
  try {
    const status = await runCommand("git", ["-C", root, "status", "--short", "--branch"], root);
    return {
      available: true,
      clean: status.stdout.trim().split(/\r?\n/).slice(1).every((line) => !line.trim()),
      status: status.stdout.trim(),
    };
  } catch {
    return {
      available: false,
      clean: false,
      status: "not a git repository",
    };
  }
}

function hasExtension(root, extension) {
  try {
    return fs.readdirSync(root, { withFileTypes: true }).some((entry) => entry.isFile() && entry.name.endsWith(extension));
  } catch {
    return false;
  }
}

function runCommand(command, args, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr || `${command} exited with code ${code}`));
    });
  });
}
