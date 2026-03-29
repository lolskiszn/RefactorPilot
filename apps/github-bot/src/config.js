import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_CONFIG = {
  autoResolve: false,
  commentOnPullRequest: true,
  coordinated: false,
  createCheckRuns: true,
  ignoredPaths: ["**/*.md", "docs/**", "node_modules/**"],
  patterns: ["api-contract-rename", "rest-to-grpc"],
  previewBaseUrl: "https://refactorpilot.dev/preview",
  readOnly: true,
  review: {
    includeDoctorCommand: true,
    includePreviewCommand: true,
  },
};

export async function loadRefactorPilotConfig(rootDir) {
  const configPath = path.join(rootDir, ".refactorpilot.yml");
  try {
    const contents = await fs.readFile(configPath, "utf8");
    return mergeConfig(DEFAULT_CONFIG, parseYaml(contents));
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

function parseYaml(contents) {
  const result = {};
  const lines = String(contents ?? "").split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.replace(/\t/g, "  ");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z0-9_.-]+):(?:\s*(.*))?$/);
    if (!match) {
      continue;
    }

    const key = match[1];
    const value = match[2] ?? "";

    if (value) {
      result[key] = parseScalar(value);
      continue;
    }

    const next = findNextMeaningfulLine(lines, index + 1);
    if (!next) {
      result[key] = {};
      continue;
    }

    if (next.trimmed.startsWith("- ")) {
      const items = [];
      let cursor = index + 1;
      while (cursor < lines.length) {
        const candidateRaw = lines[cursor];
        const candidate = candidateRaw.replace(/\t/g, "  ");
        const candidateTrimmed = candidate.trim();
        if (!candidateTrimmed) {
          cursor += 1;
          continue;
        }

        const candidateIndent = candidate.match(/^ */)?.[0].length ?? 0;
        if (candidateIndent <= (line.match(/^ */)?.[0].length ?? 0)) {
          break;
        }

        if (candidateTrimmed.startsWith("- ")) {
          items.push(parseScalar(candidateTrimmed.slice(2)));
        }
        cursor += 1;
      }
      result[key] = items;
      index = cursor - 1;
      continue;
    }

    const nested = {};
    const baseIndent = line.match(/^ */)?.[0].length ?? 0;
    let cursor = index + 1;
    while (cursor < lines.length) {
      const candidateRaw = lines[cursor];
      const candidate = candidateRaw.replace(/\t/g, "  ");
      const candidateTrimmed = candidate.trim();
      if (!candidateTrimmed) {
        cursor += 1;
        continue;
      }

      const candidateIndent = candidate.match(/^ */)?.[0].length ?? 0;
      if (candidateIndent <= baseIndent) {
        break;
      }

      const nestedMatch = candidateTrimmed.match(/^([A-Za-z0-9_.-]+):(?:\s*(.*))?$/);
      if (nestedMatch) {
        const nestedKey = nestedMatch[1];
        const nestedValue = nestedMatch[2] ?? "";
        nested[nestedKey] = nestedValue ? parseScalar(nestedValue) : true;
      }
      cursor += 1;
    }
    result[key] = nested;
    index = cursor - 1;
  }

  return result;
}

function parseScalar(value) {
  const trimmed = String(value ?? "").trim();
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => item.replace(/^["']|["']$/g, ""));
  }
  return trimmed.replace(/^["']|["']$/g, "");
}

function mergeConfig(base, override) {
  const merged = structuredClone(base);
  for (const [key, value] of Object.entries(override ?? {})) {
    if (value && typeof value === "object" && !Array.isArray(value) && merged[key] && typeof merged[key] === "object" && !Array.isArray(merged[key])) {
      merged[key] = mergeConfig(merged[key], value);
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

function findNextMeaningfulLine(lines, startIndex) {
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    return { line, trimmed };
  }
  return null;
}
