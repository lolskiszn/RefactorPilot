# RefactorPilot CLI

RefactorPilot exposes a preview-first CLI for structural scanning, contract-aware rename planning, and assisted migration workflows.

## Help

```bash
refactorpilot --help
```

Current top-level surface:

- `scan <workspace>`
- `migrate api-contract <workspace> --from <old> --to <new>`
- `migrate protocol <workspace> --from rest --to grpc`
- `plan-rename <workspace> --field <old> --to <new>`
- `preview <workspace> --field <old> --to <new>`
- `preview <workspace> --pattern <pattern-id>`
- `apply <workspace> --field <old> --to <new>`
- `apply <workspace> --pattern <pattern-id>`
- `patterns`
- `doctor`
- `verify <workspace>`
- `serve <workspace>`

## Common Flows

### Scan a workspace

```bash
refactorpilot scan .
```

Use this to get a structural summary and basic graph information before planning a change.

### Preview a contract rename

```bash
refactorpilot preview . --field user_id --to account_id
```

Helpful flags:

- `--json`
- `--format html`
- `--output PATH`
- `--interactive`
- `--auto-resolve`
- `--dynamic-analysis`

### Migration-first rename UX

```bash
refactorpilot migrate api-contract . --from user_id --to account_id
```

This is the preferred user-facing entry point for contract rename workflows.

### Apply with guardrails

```bash
refactorpilot apply . --field user_id --to account_id --mode dry-run
refactorpilot apply . --field user_id --to account_id --mode write
```

For plugin-backed pattern apply:

```bash
refactorpilot apply . --pattern rest-to-grpc --strategy bluegreen --confirm-production
```

### Protocol migration

```bash
refactorpilot migrate protocol . --from rest --to grpc --json
```

## Important Flags

- `--json` emits machine-readable output
- `--format html` writes an HTML preview
- `--interactive` prompts through ambiguity
- `--auto-resolve` attempts safe non-interactive ambiguity resolution
- `--dynamic-analysis` expands impact detection with runtime-style heuristics
- `--allow-schema-change` permits apply when database-side effects are detected
- `--require-verified` blocks pattern apply unless verification passes
- `--replay-fixture PATH` uses replay data for differential testing
- `--equivalence strict|semantic|schema-only` tunes comparison strictness

## Notes

- `plan-rename` remains available as a lower-level alias for direct rename planning.
- The CLI is intentionally conservative and preview-oriented.
- For large or ambiguous workspaces, prefer preview and verification before write mode.
