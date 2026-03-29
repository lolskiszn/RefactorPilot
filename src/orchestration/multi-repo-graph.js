import fs from "node:fs/promises";
import path from "node:path";

const SOURCE_EXTENSIONS = new Set([".go", ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx"]);
const MANIFEST_FILES = ["go.mod", "package.json", "pyproject.toml", "requirements.txt", "setup.py"];

function normalizeKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function splitKeyVariants(value) {
  const text = String(value ?? "");
  const variants = new Set();

  if (!text.trim()) {
    return variants;
  }

  variants.add(normalizeKey(text));

  for (const segment of text.split(/[\\/]/g)) {
    if (!segment) {
      continue;
    }

    variants.add(normalizeKey(segment));
  }

  return variants;
}

function mergeLanguage(current, next) {
  if (!current || current === "mixed") {
    return next;
  }
  if (!next || next === current) {
    return current;
  }
  return "mixed";
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function walkSourceFiles(rootDir) {
  const files = [];
  async function visit(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist" || entry.name === "coverage") {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
        continue;
      }

      if (SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  }

  await visit(rootDir);
  return files.sort();
}

function parseGoModule(goModText) {
  const match = goModText.match(/^\s*module\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function parsePyProjectName(pyprojectText) {
  const match = pyprojectText.match(/^\s*name\s*=\s*["']([^"']+)["']\s*$/m);
  return match ? match[1].trim() : null;
}

function parseSetupPyName(setupPyText) {
  const match = setupPyText.match(/name\s*=\s*["']([^"']+)["']/);
  return match ? match[1].trim() : null;
}

function parseRequirements(requirementsText) {
  const names = [];
  for (const rawLine of requirementsText.split(/\r?\n/g)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("-")) {
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_.@/-]+)/);
    if (match) {
      names.push(match[1].trim());
    }
  }
  return names;
}

function manifestNameFromPackageJson(packageJson) {
  return typeof packageJson?.name === "string" && packageJson.name.trim() ? packageJson.name.trim() : null;
}

function extractPackageJsonDependencies(packageJson) {
  const result = [];
  for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const entries = packageJson?.[section];
    if (!entries || typeof entries !== "object") {
      continue;
    }

    for (const dependencyName of Object.keys(entries)) {
      result.push(dependencyName);
    }
  }
  return result;
}

function extractGoReferences(sourceText) {
  const refs = [];
  const importBlockRegex = /import\s*\(([\s\S]*?)\)/g;
  const singleImportRegex = /^\s*import\s+"([^"]+)"/gm;

  for (const blockMatch of sourceText.matchAll(importBlockRegex)) {
    const block = blockMatch[1];
    for (const line of block.split(/\r?\n/g)) {
      const trimmed = line.replace(/\/\/.*$/, "").trim();
      if (!trimmed) {
        continue;
      }

      const match = trimmed.match(/(?:[A-Za-z0-9_.-]+\s+)?("([^"]+)")/);
      if (match?.[2]) {
        refs.push(match[2]);
      }
    }
  }

  for (const match of sourceText.matchAll(singleImportRegex)) {
    refs.push(match[1]);
  }

  return refs;
}

function extractJavaScriptReferences(sourceText) {
  const refs = [];
  const patterns = [
    /import\s+[^'"]+\s+from\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of sourceText.matchAll(pattern)) {
      refs.push(match[1]);
    }
  }

  return refs;
}

function extractPythonReferences(sourceText) {
  const refs = [];
  const patterns = [
    /^\s*from\s+([A-Za-z0-9_./-]+)\s+import\s+/gm,
    /^\s*import\s+([A-Za-z0-9_./-]+)(?:\s+as\s+[A-Za-z0-9_]+)?/gm,
    /__import__\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of sourceText.matchAll(pattern)) {
      refs.push(match[1]);
    }
  }

  return refs;
}

function extractSourceReferences(filePath, sourceText) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".go") {
    return extractGoReferences(sourceText);
  }
  if (ext === ".py") {
    return extractPythonReferences(sourceText);
  }
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs" || ext === ".ts" || ext === ".tsx") {
    return extractJavaScriptReferences(sourceText);
  }
  return [];
}

async function discoverRepos(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const repos = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const repoPath = path.join(rootDir, entry.name);
    const manifests = [];
    for (const manifestName of MANIFEST_FILES) {
      if (await fileExists(path.join(repoPath, manifestName))) {
        manifests.push(manifestName);
      }
    }

    if (manifests.length === 0) {
      continue;
    }

    repos.push({
      dirName: entry.name,
      manifests,
      path: repoPath,
    });
  }

  return repos.sort((left, right) => left.dirName.localeCompare(right.dirName));
}

async function readRepoMetadata(repoEntry) {
  const manifestDetails = {};
  const aliases = new Set([repoEntry.dirName, path.basename(repoEntry.path)]);
  const dependencyKeys = new Set();
  let language = "mixed";

  if (repoEntry.manifests.includes("go.mod")) {
    const goModText = await fs.readFile(path.join(repoEntry.path, "go.mod"), "utf8");
    const moduleName = parseGoModule(goModText);
    manifestDetails.goMod = { module: moduleName };
    language = mergeLanguage(language, "go");
    if (moduleName) {
      aliases.add(moduleName);
    }
  }

  if (repoEntry.manifests.includes("package.json")) {
    const packageJson = await readJson(path.join(repoEntry.path, "package.json"));
    const name = manifestNameFromPackageJson(packageJson);
    const dependencies = extractPackageJsonDependencies(packageJson);
    manifestDetails.packageJson = { dependencies, name };
    language = mergeLanguage(language, "javascript");
    if (name) {
      aliases.add(name);
    }
    for (const dependencyName of dependencies) {
      dependencyKeys.add(dependencyName);
    }
  }

  if (repoEntry.manifests.includes("pyproject.toml")) {
    const pyprojectText = await fs.readFile(path.join(repoEntry.path, "pyproject.toml"), "utf8");
    const name = parsePyProjectName(pyprojectText);
    manifestDetails.pyproject = { name };
    language = mergeLanguage(language, "python");
    if (name) {
      aliases.add(name);
    }
  }

  if (repoEntry.manifests.includes("requirements.txt")) {
    const requirementsText = await fs.readFile(path.join(repoEntry.path, "requirements.txt"), "utf8");
    const names = parseRequirements(requirementsText);
    manifestDetails.requirements = { names };
    language = mergeLanguage(language, "python");
    for (const requirement of names) {
      dependencyKeys.add(requirement);
    }
  }

  if (repoEntry.manifests.includes("setup.py")) {
    const setupPyText = await fs.readFile(path.join(repoEntry.path, "setup.py"), "utf8");
    const name = parseSetupPyName(setupPyText);
    manifestDetails.setupPy = { name };
    language = mergeLanguage(language, "python");
    if (name) {
      aliases.add(name);
    }
  }

  const sourceFiles = await walkSourceFiles(repoEntry.path);
  const sourceReferences = [];
  for (const sourceFile of sourceFiles) {
    const sourceText = await fs.readFile(sourceFile, "utf8");
    for (const reference of extractSourceReferences(sourceFile, sourceText)) {
      sourceReferences.push({
        file: sourceFile,
        reference,
      });
    }
  }

  return {
    aliases,
    dependencyKeys,
    id: repoEntry.dirName,
    language,
    manifests: repoEntry.manifests,
    manifestDetails,
    path: repoEntry.path,
    sourceFiles,
    sourceReferences,
  };
}

function buildMatcherIndex(repos) {
  const keyToRepos = new Map();

  for (const repo of repos) {
    const keys = new Set();
    for (const alias of repo.aliases) {
      for (const key of splitKeyVariants(alias)) {
        if (key) {
          keys.add(key);
        }
      }
    }

    repo.matchKeys = keys;
    for (const key of keys) {
      if (!keyToRepos.has(key)) {
        keyToRepos.set(key, new Set());
      }
      keyToRepos.get(key).add(repo.id);
    }
  }

  return keyToRepos;
}

function matchReferenceToRepo(reference, keyToRepos, ownerRepoId) {
  const candidates = new Set();
  for (const key of splitKeyVariants(reference)) {
    const matches = keyToRepos.get(key);
    if (!matches) {
      continue;
    }

    for (const repoId of matches) {
      if (repoId !== ownerRepoId) {
        candidates.add(repoId);
      }
    }
  }

  return candidates.size === 1 ? [...candidates][0] : null;
}

function buildTopoOrder(repos, edges, selectedIds = null) {
  const selected = selectedIds ? new Set(selectedIds) : new Set(repos.map((repo) => repo.id));
  const incomingCounts = new Map();
  const outgoing = new Map();

  for (const repo of repos) {
    if (!selected.has(repo.id)) {
      continue;
    }
    incomingCounts.set(repo.id, 0);
    outgoing.set(repo.id, new Set());
  }

  for (const edge of edges) {
    if (!selected.has(edge.from) || !selected.has(edge.to)) {
      continue;
    }

    outgoing.get(edge.from).add(edge.to);
    incomingCounts.set(edge.to, (incomingCounts.get(edge.to) ?? 0) + 1);
  }

  const queue = [...incomingCounts.entries()]
    .filter(([, count]) => count === 0)
    .map(([repoId]) => repoId)
    .sort((left, right) => left.localeCompare(right));

  const order = [];
  while (queue.length > 0) {
    const current = queue.shift();
    order.push(current);

    const neighbors = [...(outgoing.get(current) ?? [])].sort((left, right) => left.localeCompare(right));
    for (const next of neighbors) {
      incomingCounts.set(next, incomingCounts.get(next) - 1);
      if (incomingCounts.get(next) === 0) {
        queue.push(next);
        queue.sort((left, right) => left.localeCompare(right));
      }
    }
  }

  if (order.length !== selected.size) {
    return [...selected].sort((left, right) => left.localeCompare(right));
  }

  return order;
}

function collectDownstreamRepos(startRepoId, edges) {
  const dependents = new Map();
  for (const edge of edges) {
    if (!dependents.has(edge.from)) {
      dependents.set(edge.from, new Set());
    }
    dependents.get(edge.from).add(edge.to);
  }

  const impacted = new Set([startRepoId]);
  const queue = [startRepoId];

  while (queue.length > 0) {
    const current = queue.shift();
    const children = [...(dependents.get(current) ?? [])].sort((left, right) => left.localeCompare(right));
    for (const child of children) {
      if (impacted.has(child)) {
        continue;
      }
      impacted.add(child);
      queue.push(child);
    }
  }

  return impacted;
}

function relativePath(rootDir, filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join(path.posix.sep);
}

export async function buildMultiRepoGraph(rootDir, options = {}) {
  const repoEntries = await discoverRepos(rootDir);
  const repos = [];

  for (const entry of repoEntries) {
    repos.push(await readRepoMetadata(entry));
  }

  const keyToRepos = buildMatcherIndex(repos);
  const edges = [];
  const seenEdges = new Set();

  for (const repo of repos) {
    const refs = [...repo.dependencyKeys, ...repo.sourceReferences.map((entry) => entry.reference)];
    const seenRefs = new Set();

    for (const ref of refs) {
      const trimmed = ref.trim();
      if (!trimmed || seenRefs.has(trimmed)) {
        continue;
      }
      seenRefs.add(trimmed);

      const matchedRepoId = matchReferenceToRepo(trimmed, keyToRepos, repo.id);
      if (!matchedRepoId) {
        continue;
      }

      const edgeKey = `${matchedRepoId}->${repo.id}`;
      if (seenEdges.has(edgeKey)) {
        continue;
      }
      seenEdges.add(edgeKey);

      edges.push({
        from: matchedRepoId,
        kind: "dependency",
        reason: `matched reference "${trimmed}" in ${repo.id}`,
        to: repo.id,
      });
    }
  }

  for (const repo of repos) {
    repo.dependencies = [...new Set(edges.filter((edge) => edge.to === repo.id).map((edge) => edge.from))].sort((left, right) => left.localeCompare(right));
    repo.dependents = [...new Set(edges.filter((edge) => edge.from === repo.id).map((edge) => edge.to))].sort((left, right) => left.localeCompare(right));
  }

  const focusRepoId = options.focusRepo ?? options.entryRepo ?? options.repo ?? options.changedRepo ?? options.migratedRepo ?? null;
  const impactedSet = focusRepoId && repos.some((repo) => repo.id === focusRepoId)
    ? collectDownstreamRepos(focusRepoId, edges)
    : new Set(repos.map((repo) => repo.id));
  const coordinationOrder = buildTopoOrder(repos, edges, impactedSet);

  return {
    coordinationOrder,
    edges,
    graph: {
      edges,
      nodes: repos.map((repo) => ({
        id: repo.id,
        kind: "repo",
        language: repo.language,
        manifests: repo.manifests,
        path: repo.path,
      })),
    },
    impactedRepos: coordinationOrder,
    repos: repos.map((repo) => ({
      aliases: [...repo.aliases].sort((left, right) => left.localeCompare(right)),
      dependencies: repo.dependencies,
      dependents: repo.dependents,
      id: repo.id,
      language: repo.language,
      manifests: repo.manifests,
      manifestDetails: repo.manifestDetails,
      path: repo.path,
      sourceFiles: repo.sourceFiles.map((filePath) => relativePath(rootDir, filePath)),
      sourceReferences: repo.sourceReferences.map((entry) => ({
        file: relativePath(rootDir, entry.file),
        reference: entry.reference,
      })),
    })),
    rootDir: path.resolve(rootDir),
  };
}

export async function planCoordinatedMigration(rootDir, sourceRepo, options = {}) {
  const graph = await buildMultiRepoGraph(rootDir, {
    ...options,
    focusRepo: sourceRepo,
  });

  return {
    graph,
    impactedRepos: graph.impactedRepos,
    sourceRepo,
  };
}
