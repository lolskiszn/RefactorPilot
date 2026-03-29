import fs from "node:fs/promises";
import path from "node:path";

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const ISO_TIMESTAMP_RE = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

function scrubString(value) {
  return String(value)
    .replace(UUID_RE, "<uuid>")
    .replace(ISO_TIMESTAMP_RE, "<timestamp>")
    .replace(EMAIL_RE, "<email>");
}

function normalizeHeaders(headers = {}) {
  const entries = Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), scrubString(value)]);
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

function normalizeBody(body) {
  if (body === null || body === undefined) {
    return null;
  }
  if (typeof body === "string") {
    const scrubbed = scrubString(body);
    try {
      return normalizeJson(JSON.parse(scrubbed));
    } catch {
      return scrubbed;
    }
  }
  return normalizeJson(body);
}

function normalizeJson(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeJson(item)]),
    );
  }
  if (typeof value === "string") {
    return scrubString(value);
  }
  return value;
}

export function createReplayEvent(event) {
  return {
    id: event.id ?? `event-${Date.now()}`,
    request: {
      body: normalizeBody(event.request?.body),
      headers: normalizeHeaders(event.request?.headers),
      method: event.request?.method ?? "GET",
      path: event.request?.path ?? "/",
    },
    response: {
      body: normalizeBody(event.response?.body),
      headers: normalizeHeaders(event.response?.headers),
      status: event.response?.status ?? 200,
    },
    traceId: event.traceId ?? "trace-local",
  };
}

export async function writeReplayFixture(outputPath, events, metadata = {}) {
  const fixture = {
    metadata,
    events: events.map(createReplayEvent),
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(fixture, null, 2), "utf8");
  return fixture;
}
