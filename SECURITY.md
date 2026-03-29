# Security Policy

## Supported scope

The RefactorPilot open source core is maintained with a safety-first posture:

- local-first analysis
- no required network access for core CLI usage
- preview before apply
- rollback on failed writes
- no persistent storage of analyzed customer source code in the local CLI

Platform modules under `apps/` and `platform/` are still production-beta and should be evaluated carefully before internet-facing deployment.

## Reporting a vulnerability

Please do not open public issues for suspected security vulnerabilities.

Instead:

1. Email the maintainers at `security@refactorpilot.dev`
2. Include reproduction steps, affected files or commands, and impact
3. If possible, include a minimal fixture or redacted stack trace

We will acknowledge receipt within 3 business days and aim to provide an initial remediation plan within 7 business days.

## Disclosure process

- We investigate privately first.
- We prefer coordinated disclosure once a fix or mitigation exists.
- If the issue affects published releases, we will document affected versions and upgrade guidance.

## Operational security notes

- The CLI should be runnable offline.
- The standalone verification script blocks outbound network APIs as a regression check.
- Marketplace sandboxing, GitHub App tenancy, and enterprise policy features are present as beta scaffolds and are not yet hardened for broad hosted SaaS usage.
