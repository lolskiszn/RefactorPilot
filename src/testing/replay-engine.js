import fs from "node:fs/promises";

function sortObject(value) {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortObject(item)]),
    );
  }
  return value;
}

function canonicalizeBody(body, plan) {
  if (body === null || body === undefined) {
    return body;
  }
  if (Array.isArray(body)) {
    return body.map((item) => canonicalizeBody(item, plan));
  }
  if (body && typeof body === "object") {
    const result = {};
    for (const [key, value] of Object.entries(body)) {
      const nextKey = key === plan?.fromField ? plan?.toField : key;
      result[nextKey] = canonicalizeBody(value, plan);
    }
    return sortObject(result);
  }
  return body;
}

function compareJson(left, right, plan) {
  const leftCanonical = canonicalizeBody(left, plan);
  const rightCanonical = canonicalizeBody(right, plan);
  return JSON.stringify(leftCanonical) === JSON.stringify(rightCanonical);
}

function compareSchema(left, right) {
  if (left === null || right === null) {
    return left === right;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => compareSchema(item, right[index]));
  }
  if (typeof left === "object" && typeof right === "object") {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return JSON.stringify(leftKeys) === JSON.stringify(rightKeys);
  }
  return typeof left === typeof right;
}

export async function loadReplayFixture(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export function compareReplayFixtures(originalFixture, migratedFixture, options = {}) {
  const mode = options.mode ?? "semantic";
  const plan = options.plan ?? null;
  const originalEvents = originalFixture.events ?? [];
  const migratedEvents = migratedFixture.events ?? [];
  const divergences = [];

  for (let index = 0; index < Math.max(originalEvents.length, migratedEvents.length); index += 1) {
    const left = originalEvents[index];
    const right = migratedEvents[index];
    if (!left || !right) {
      divergences.push({ index, reason: "event-count-mismatch" });
      continue;
    }

    if (left.request.method !== right.request.method || left.request.path !== right.request.path) {
      divergences.push({ index, reason: "request-mismatch" });
      continue;
    }

    const sameStatus = left.response.status === right.response.status;
    let sameBody = false;
    if (mode === "strict") {
      sameBody = JSON.stringify(left.response.body) === JSON.stringify(right.response.body);
    } else if (mode === "schema-only") {
      sameBody = compareSchema(left.response.body, right.response.body);
    } else {
      sameBody = compareJson(left.response.body, right.response.body, plan);
    }

    if (!sameStatus || !sameBody) {
      divergences.push({
        index,
        reason: sameStatus ? "body-mismatch" : "status-mismatch",
      });
    }
  }

  return {
    divergenceCount: divergences.length,
    divergences,
    equivalent: divergences.length === 0,
    mode,
  };
}
