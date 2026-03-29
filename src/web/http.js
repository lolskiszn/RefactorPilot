import fs from "node:fs/promises";

export function jsonResponse(res, payload, statusCode = 200) {
  const body = JSON.stringify(payload, null, 2);
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(body);
}

export function notFoundResponse(res) {
  res.statusCode = 404;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ ok: false, error: "Not found" }, null, 2));
}

export async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return {};
  }

  return JSON.parse(text);
}

export async function sendFile(res, filePath, contentType) {
  const contents = await fs.readFile(filePath, "utf8");
  res.statusCode = 200;
  res.setHeader("content-type", contentType);
  res.end(contents);
}
