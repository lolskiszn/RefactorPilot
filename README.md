# RefactorPilot

[![npm version](https://img.shields.io/npm/v/refactor-pilot)](https://www.npmjs.com/package/refactor-pilot)
![node](https://img.shields.io/badge/node-%3E%3D20-339933)
[![license](https://img.shields.io/npm/l/refactor-pilot)](./LICENSE)
[![launch readiness](https://img.shields.io/badge/status-alpha-0ea5e9)](./docs/LAUNCH_READINESS.md)

Preview-first architectural refactoring for Go, Python, and TypeScript.

RefactorPilot helps teams analyze boundary changes, preview impact across mixed-language codebases, and apply guarded migrations with verification loops instead of blind search-and-replace.

## What It Does

RefactorPilot is strongest when the change crosses service or contract boundaries:

- API contract rename across languages
- preview-first migration planning
- assisted `REST -> gRPC` migration on the supported path
- ambiguity handling with explicit user-visible risk
- verified transformation gates before write mode

## Current Positioning

This repository should be treated as an **alpha / research-heavy developer tool**, not a universal one-click migration engine.

Best current use cases:

- safe preview and planning for contract-aware renames
- mixed-language impact analysis for Go, Python, and TypeScript workspaces
- assisted migration flows with verification and rollback-minded guardrails

What it is **not** claiming yet:

- universal automatic migration for arbitrary production systems
- full mathematical guarantees for all code
- finished production-grade support for every framework pattern

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

## Quick Start

### Scan a workspace

```bash
refactorpilot scan .
```

### Preview an API contract rename

```bash
refactorpilot preview . --field user_id --to account_id
refactorpilot preview . --field user_id --to account_id --auto-resolve
refactorpilot preview . --field user_id --to account_id --dynamic-analysis
```

### Run the migration-first surface

```bash
refactorpilot migrate api-contract . --from user_id --to account_id
```

### Apply with a guardrail-first flow

```bash
refactorpilot apply . --field user_id --to account_id --mode dry-run
refactorpilot apply . --field user_id --to account_id --mode write
```

### Explore protocol migration

```bash
refactorpilot migrate protocol . --from rest --to grpc --json
```

## CLI Surface

Primary commands:

- `scan <workspace>`
- `migrate api-contract <workspace> --from <old> --to <new>`
- `migrate protocol <workspace> --from rest --to grpc`
- `plan-rename <workspace> --field <old> --to <new>`
- `preview <workspace> --field <old> --to <new>`
- `apply <workspace> --field <old> --to <new>`
- `patterns`
- `doctor`
- `verify <workspace>`
- `serve <workspace>`

See [docs/cli.md](./docs/cli.md) for the fuller command guide.

## Verification and Safety

RefactorPilot is designed around a preview-and-verify workflow:

- inspect impact before write mode
- surface ambiguity instead of guessing silently
- use differential and verification checks on supported flows
- keep deployment-aware apply paths behind explicit confirmation flags

That means the tool is intentionally conservative. It prefers an explicit stop over an unsafe rewrite.

## Repository Scope

This public repository contains:

- runtime source
- CLI surfaces
- verification and testing code
- examples and docs needed to understand the current product envelope

It intentionally leaves out private research notes, local caches, and optional internal toolchain workspace artifacts that are not required for the normal app path.

## Limitations

- framework support is selective and still evolving
- some flows remain heuristic or preview-oriented
- large production codebases may need human review around ambiguous cases
- protocol migration support is stronger on supported patterns than on arbitrary service shapes

## Development

Run the full verification suite:

```bash
node ./tests/run-tests.js
```

Useful scripts:

```bash
npm test
npm run bench
npm run verify:standalone
```

## Docs

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [docs/cli.md](./docs/cli.md)
- [docs/LAUNCH_READINESS.md](./docs/LAUNCH_READINESS.md)
- [docs/RELEASE_CHECKLIST.md](./docs/RELEASE_CHECKLIST.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)

## License

[MIT](./LICENSE)
