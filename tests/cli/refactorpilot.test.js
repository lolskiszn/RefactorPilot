import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { main as runCli } from '../../src/cli/index.js';
import { formatPreviewReport, previewFieldRename } from '../../src/orchestration/index.js';

function makeTempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'refactorpilot-'));
  fs.mkdirSync(path.join(root, 'service'), { recursive: true });
  fs.mkdirSync(path.join(root, 'client'), { recursive: true });

  fs.writeFileSync(path.join(root, 'service', 'user.go'), `package service

import (
  "encoding/json"
  "net/http"
)

type User struct {
  OldField string \`json:"oldField"\`
}

func Handle(w http.ResponseWriter, r *http.Request) {
  _ = json.NewEncoder(w).Encode(User{})
}
`);

  fs.writeFileSync(path.join(root, 'client', 'user.py'), `import json
import requests

class User:
    def __init__(self):
        self.old_field = "value"

payload = {"oldField": "value"}
`);

  return root;
}

export async function run() {
  const workspace = makeTempWorkspace();
  const report = await previewFieldRename(workspace, 'oldField', 'newField');

  assert.equal(report.fromField, 'oldField');
  assert.equal(report.toField, 'newField');
  assert.ok(report.summary.scannedFiles >= 2);
  assert.equal(report.plan.impactedFiles.length, 2);
  assert.ok(report.plan.impactedFiles.some((entry) => entry.path.replace(/\\/g, '/').includes('service/user.go')));
  assert.ok(report.plan.impactedFiles.some((entry) => entry.path.replace(/\\/g, '/').includes('client/user.py')));
  assert.ok(report.plan.replacements.length > 0);

  const formatted = formatPreviewReport(report);
  assert.ok(formatted.includes('API Contract Migration'));
  assert.ok(formatted.includes('Impact Surface'));
  assert.ok(formatted.includes('Risk Assessment'));
  assert.ok(formatted.includes('Why It Matters'));
  assert.ok(formatted.includes('service'));
  assert.ok(formatted.includes('client'));

  const planOnly = await previewFieldRename(workspace, 'oldField', 'newField');
  assert.equal(planOnly.plan.summary.impactedFileCount, 2);

  const cliOutput = await captureStdout(() => runCli([
    'migrate',
    'api-contract',
    workspace,
    '--from',
    'oldField',
    '--to',
    'newField',
  ]));

  assert.ok(cliOutput.includes('API Contract Migration'));
  assert.ok(cliOutput.includes('Impact Surface'));
  assert.ok(cliOutput.includes('Risk Assessment'));
  assert.ok(cliOutput.includes('Why It Matters'));
  assert.ok(cliOutput.includes('Mode: preview'));

  const aliasOutput = await captureStdout(() => runCli([
    'plan-rename',
    workspace,
    '--field',
    'oldField',
    '--to',
    'newField',
  ]));

  assert.ok(aliasOutput.includes('API Contract Migration'));
  assert.ok(aliasOutput.includes('Impact Surface'));
  assert.ok(aliasOutput.includes('Risk Assessment'));

  const writeWorkspace = makeTempWorkspace();
  const writeOutput = await captureStdout(() => runCli([
    'migrate',
    'api-contract',
    writeWorkspace,
    '--from',
    'oldField',
    '--to',
    'newField',
    '--mode',
    'write',
  ]));

  assert.ok(writeOutput.includes('Apply status: applied'));
  assert.match(fs.readFileSync(path.join(writeWorkspace, 'service', 'user.go'), 'utf8'), /newField|new_field/);
}

async function captureStdout(run) {
  const lines = [];
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args) => {
    lines.push(args.join(' '));
  };
  console.error = (...args) => {
    lines.push(args.join(' '));
  };

  try {
    await run();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  return lines.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().then(() => {
    console.log('refactorpilot CLI tests passed');
  }).catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
