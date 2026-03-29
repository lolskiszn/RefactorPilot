# RefactorPilot CLI

RefactorPilot starts with a preview-oriented CLI that scans a workspace, invokes language frontends, builds a lightweight dependency graph, and reports the blast radius for an API contract migration.

## Usage

```bash
node src/cli/index.js migrate api-contract . --from oldField --to newField
```

Optional flags:

- `--json` emits the preview report as machine-readable JSON.
- `--help` prints the command reference.

## What The Preview Does

The orchestration layer performs four steps:

1. Scan the workspace for supported source files.
2. Invoke the active frontends for each file.
3. Build a file-to-symbol dependency graph from fields, references, and imports.
4. Produce a preview report that highlights files likely to change.

The CLI exposes a migration-first surface:

- `scan <workspace>` prints a structural summary and graph counts.
- `migrate api-contract <workspace> --from <old> --to <new>` is the primary UX for contract migrations.
- `plan-rename <workspace> --field <old> --to <new>` emits a JSON rename plan as a legacy alias.
- `preview <workspace> --field <old> --to <new>` prints the human-readable report.
- `apply <workspace> --field <old> --to <new> --mode dry-run|write>` performs guarded apply when you are ready.

This first scaffold is intentionally conservative. It is designed to be useful for contract-aware work across Go and Python while leaving room for richer semantic frontends later.

`migrate api-contract` is the preferred user-facing workflow. `plan-rename` remains available for lower-level direct rename planning.

The migration report now highlights:

- impact surface
- risk assessment
- why it matters

## Limitations

- The frontends are heuristic-based and do not parse full language syntax.
- The graph is file-centric, not a full code property graph yet.
- The CLI only previews the change; it does not rewrite files.
