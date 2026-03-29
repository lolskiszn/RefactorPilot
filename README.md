# RefactorPilot

[![npm version](https://img.shields.io/npm/v/refactor-pilot)](https://www.npmjs.com/package/refactor-pilot)
![node](https://img.shields.io/badge/node-%3E%3D20-339933)
[![license](https://img.shields.io/npm/l/refactor-pilot)](./LICENSE)
[![launch readiness](https://img.shields.io/badge/launch-preview--first-0ea5e9)](./docs/LAUNCH_READINESS.md)

Preview-first architectural refactoring for Go, Python, and TypeScript.

RefactorPilot helps you analyze cross-language changes, preview migration impact, generate assisted transformation artifacts, and apply safe edits with rollback-minded guardrails.

## Why

Most refactoring tools stop at single-file rename or blind text replacement. RefactorPilot is built for boundary changes:

- API contract rename across languages
- preview-first migration planning
- assisted REST to gRPC migration on the supported golden path
- ambiguity handling, dynamic analysis, and verified transformation loops

## Status

RefactorPilot is ready for a preview-first open source launch.

Current measured confidence is tracked in [docs/LAUNCH_READINESS.md](./docs/LAUNCH_READINESS.md).

- Safe behavior on complex codebases: `93%`
- Useful preview and impact analysis on complex codebases: `86%`
- Fully automatic complex `REST -> gRPC` success without manual intervention: `70%`

Best current positioning:

- excellent at safe API contract rename across supported languages
- strong at preview-first migration analysis with explicit safety rails
- promising at assisted `REST -> gRPC` migration for the supported golden path
- not yet a universal one-click transformer for arbitrary production services

## Installation

### npm

```bash
npm install -g refactor-pilot
refactorpilot --help
```

### From source

```bash
git clone <your-repo-url>
cd RefactorPilot
npm install
node ./src/cli/index.js --help
```

Requirements:

- Node.js `20+`

## Quick start

### Verify the install

```bash
refactorpilot doctor
refactorpilot scan .
```

### Preview a cross-language rename

```bash
refactorpilot preview . --field user_id --to account_id
refactorpilot preview . --field user_id --to account_id --auto-resolve
refactorpilot preview . --field user_id --to account_id --dynamic-analysis
```

### Apply safely

```bash
refactorpilot apply . --field user_id --to account_id --mode dry-run
refactorpilot apply . --field user_id --to account_id --mode write
```

### Try the golden path REST to gRPC flow

```bash
refactorpilot preview ./examples/rest-to-grpc-full --pattern rest-to-grpc-full
refactorpilot apply ./examples/rest-to-grpc-full --pattern rest-to-grpc-full --strategy bluegreen --confirm-production
```

## Common workflows

### 1. Scan a repo

```bash
refactorpilot scan ./my-service
```

### 2. Plan a contract rename

```bash
refactorpilot migrate api-contract ./my-service --from user_id --to account_id
```

### 3. Export a reviewable HTML report

```bash
refactorpilot preview ./my-service --field user_id --to account_id --format html --output report.html
```

### 4. Preview a pattern-driven migration

```bash
refactorpilot preview ./examples/rest-to-grpc-full --pattern rest-to-grpc-full
```

### 5. Start the local review app

```bash
refactorpilot serve .
```

## CLI overview

### `scan <workspace>`

Scan the workspace and build the shared graph model.

### `plan-rename <workspace> --field <old> --to <new>`

Legacy alias for contract migration planning.

### `migrate api-contract <workspace> --from <old> --to <new>`

Build a preview-first API contract migration plan with:

- impacted files
- symbol and field matches
- proposed text replacements
- explanation paths
- confidence and validation results

### `preview <workspace> --field <old> --to <new>`

Preview a rename without writing changes.

Helpful flags:

- `--auto-resolve`
- `--dynamic-analysis`
- `--interactive`
- `--format html`

### `apply <workspace> --field <old> --to <new>`

Run the guarded apply path.

Modes:

- `--mode dry-run`
- `--mode write`
- `--mode sandbox`

### `preview <workspace> --pattern <pattern-id>`

Preview a plugin-backed migration pattern.

Important built-ins:

- `api-contract-rename`
- `rest-to-grpc`
- `rest-to-grpc-full`

### `apply <workspace> --pattern <pattern-id>`

Apply a pattern-backed migration when supported.

Helpful flags:

- `--strategy bluegreen`
- `--confirm-production`
- `--require-verified`

### `patterns`

List available migration patterns.

### `doctor`

Print a quick system and trust report.

### `verify <workspace>`

Inspect build, test, and verification hooks in a workspace.

### `serve <workspace>`

Start the local web review app.

## What it does well today

- Go structs, JSON tags, handlers, and field access
- Python functions, classes, route handlers, JSON/key access, and HTTP usage
- TypeScript interface/property impact analysis
- cross-language payload-field rename
- guarded apply with validation, backups, and rollback
- ambiguity resolution
- dynamic-impact expansion
- verified transformation with bounded auto-repair
- plugin extension points for patterns, language frontends, and deployment strategies

## Safety model

RefactorPilot is intentionally preview-first.

- low-confidence plans are blocked
- ambiguous cases are resolved interactively or downgraded
- risky dynamic or unsupported cases degrade to warning/block behavior
- apply paths keep backups and rollback support
- verified transformation is required for the strongest automation path

## Validation

The repo includes:

- core engine and web checks
- 252 rename scenarios
- 216 ambiguity auto-resolve scenarios
- 90 dynamic-analysis scenarios
- 288 verification scenarios
- framework-shaped launch matrices
- unsupported/degraded safety checks

Launch-specific verification:

```bash
npm test
node ./tests/transformers/launch-readiness-matrix.test.js
node ./tests/transformers/unsupported-patterns.test.js
node ./benchmarks/run.js --json --auto-resolve --dynamic-analysis
```

Release process and preflight checks live in [docs/RELEASE_CHECKLIST.md](./docs/RELEASE_CHECKLIST.md).

## Examples

- `examples/go-typescript-field-rename`
- `examples/rest-to-grpc-full`
- `examples/complex-service`
- `examples/verified-migration`

## Project layout

- `src/core` - IR model and graph building
- `src/engine` - planning, confidence, validation, apply, and verification
- `src/frontends` - language analysis
- `src/orchestration` - workspace scan and migration planning
- `src/plugins` - plugin registry and loading
- `src/cli` - CLI entrypoint
- `src/web` - local review app
- `patterns` - built-in richer pattern plugins
- `packages/language-sdk` - helper SDK for community extensions
- `benchmarks` - benchmark harness and fixture suites
- `tests` - test coverage and scenario matrices

## Contributing

Project health and contributor docs:

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [SECURITY.md](./SECURITY.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [docs/PLUGINS.md](./docs/PLUGINS.md)

## Honest boundaries

RefactorPilot is not yet:

- a compiler-grade universal transformer
- a formal behavioral proof system
- a guaranteed one-click migration tool for every production service

It is a strong preview-first assistant that analyzes, explains, generates, verifies, repairs simple mechanical issues, and blocks or downgrades risky cases instead of guessing.
