# RefactorPilot GitHub Bot

This is a read-only-by-default GitHub App scaffold for RefactorPilot.

It is intentionally small and self-hostable:

- it analyzes pull requests
- it opens review comments and check-run guidance
- it never pushes branches or edits code
- it can be wired into Probot later, but does not require network installs to inspect or smoke-test the scaffold

## Structure

- `src/app.js`: Probot-style registration and action wiring
- `src/analysis.js`: pull-request heuristics and review-plan generation
- `src/messages.js`: PR comment and check-run payload builders
- `src/config.js`: minimal `.refactorpilot.yml` loader
- `test/smoke.test.js`: offline smoke test for the scaffold

## Local smoke test

```bash
node ./test/smoke.test.js
```

## Intended production shape

When hosted inside a real GitHub App runtime, the bot should:

- comment on migration opportunities
- create a `refactorpilot/impact-analysis` check run
- link users to the CLI preview flow
- stay read-only unless a future workflow explicitly chooses to create a PR

## Safety model

- no branch pushes
- no code edits
- no automatic apply path
- review-only defaults for new repositories
