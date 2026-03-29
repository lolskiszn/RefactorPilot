# RefactorPilot GitHub App Setup

This is the production-beta setup guide for the GitHub App scaffold in `apps/github-bot`.

## What it does

The app is read-only by default:

- it comments on pull requests
- it creates check runs
- it never pushes code
- it never applies migrations directly

## Permissions

Recommended GitHub App permissions:

- `Checks`: read and write
- `Pull requests`: read and write
- `Contents`: read only
- `Metadata`: read only

## Runtime model

The scaffold exports Probot-style registration functions from `apps/github-bot/src/app.js`.

It is designed so a self-hosted runtime can:

1. load `.refactorpilot.yml`
2. analyze the PR files
3. create a review comment
4. create a `refactorpilot/impact-analysis` check run

## Safety model

- no direct pushes to `main`
- no automatic apply
- no code leaves the user's infrastructure
- no telemetry beyond local metrics, if enabled later

## Local verification

Run the offline smoke test from the app directory:

```bash
node ./test/smoke.test.js
```

## Later integration

When you want a real GitHub App runtime, wire the exported registration function into a Probot host and mount the handlers there.
