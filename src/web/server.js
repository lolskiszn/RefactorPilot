#!/usr/bin/env node
import http from "node:http";
import path from "node:path";

import { createRequestHandler } from "./app.js";

function parseArgs(argv) {
  const args = {
    workspace: process.cwd(),
    port: 3333,
    host: "127.0.0.1",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--workspace" || token === "-w") {
      args.workspace = argv[index + 1] ? path.resolve(argv[index + 1]) : args.workspace;
      index += 1;
      continue;
    }
    if (token === "--port" || token === "-p") {
      const parsed = Number(argv[index + 1]);
      args.port = Number.isFinite(parsed) ? parsed : args.port;
      index += 1;
      continue;
    }
    if (token === "--host") {
      args.host = argv[index + 1] || args.host;
      index += 1;
    }
  }

  return args;
}

async function main(argv) {
  const options = parseArgs(argv);
  const { port } = await startServer(options);
  console.log(`RefactorPilot web app running at http://${options.host}:${port}`);
  console.log(`Workspace: ${options.workspace}`);
}

export async function startServer(options = {}) {
  const handler = createRequestHandler({
    workspace: options.workspace ?? process.cwd(),
  });
  const server = http.createServer(handler);
  await new Promise((resolve) => {
    server.listen(options.port ?? 3333, options.host ?? "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    host: options.host ?? "127.0.0.1",
    port: typeof address === "object" && address ? address.port : options.port ?? 3333,
    server,
    close() {
      return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
