# Release Checklist

Use this checklist before publishing a new npm release or announcing a GitHub launch.

## Preflight

- confirm the version bump in `package.json`
- update `README.md` if install, commands, or supported workflows changed
- review [LAUNCH_READINESS.md](./LAUNCH_READINESS.md)
- verify any launch claims still match the latest measured test output

## Required verification

Run:

```powershell
node .\tests\run-tests.js
node .\tests\transformers\launch-readiness-matrix.test.js
node .\tests\transformers\unsupported-patterns.test.js
node .\scripts\verify-standalone.js
npm.cmd pack --dry-run --cache .\.npm-cache
npm.cmd publish --dry-run --cache .\.npm-cache
```

Expected:

- full suite passes
- launch matrix passes
- unsupported-pattern safety checks pass
- standalone verification passes
- npm pack succeeds
- npm publish dry-run succeeds

## Publish

```powershell
npm.cmd publish --access public
```

## Post-publish

- verify the live version on npm
- verify the installed CLI works:

```powershell
npm.cmd install -g refactor-pilot
refactorpilot help
```

- review the npm package page for README rendering
- create release notes or a GitHub release summary

## Launch messaging guardrails

Safe claims:

- preview-first architectural refactoring
- strong contract rename support
- assisted REST to gRPC on the golden path
- verified transformation and safe fallback behavior

Avoid claiming:

- universal one-click migration
- guaranteed autonomous transformation for arbitrary production services
