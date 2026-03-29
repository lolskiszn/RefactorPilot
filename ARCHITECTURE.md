# RefactorPilot Architecture

## Ambiguity Resolution

RefactorPilot treats duplicate matches as a first-class safety problem.

The resolution flow is:

1. Build the normal preview plan and detect ambiguous producer/consumer groups.
2. Rank each ambiguous group with `src/engine/ambiguity-ranker.js`.
3. Resolve in one of three modes:
   - `user`: explicit `--target-context`
   - `auto`: `--auto-resolve` and the top ranked option is both high-confidence and clearly ahead of the runner-up
   - `unresolved`: remain preview-only and block apply

### Ranking Signals

The ranker uses a lightweight property-graph style scoring model:

- `api_boundary_proximity` (0.35)
- `usage_frequency` (0.25)
- `type_consistency_across_languages` (0.20)
- `naming_convention_match` (0.15)
- `documentation_presence` (0.05)

These are intentionally conservative. RefactorPilot only auto-resolves when:

- the top choice scores at least `0.8`
- the top choice leads the runner-up by at least `0.12`

If those conditions are not met, the CLI stays in preview-first mode and asks for `--interactive` or `--target-context`.

## Phase 2: Dynamic Analysis

RefactorPilot now supports an optional `--dynamic-analysis` mode for higher impact recall on runtime-selected fields.

This is intentionally lightweight and conservative:

- `src/runtime/tracer.js`
  Builds a cross-language trace schema and emits runtime-style trace hints for Go JSON/reflect usage and Python dynamic access.
- `src/engine/symbolic-executor.js`
  Performs bounded path inspection for migration-critical files and records dynamic selectors plus sink categories.
- `src/engine/taint-tracker.js`
  Propagates the target contract key through JSON-style boundaries and upgrades dynamic consumers into impacted files.
- `src/engine/side-effects.js`
  Detects database, cache, external API, and logging implications.

### Safety Rules

- Dynamic analysis expands impact surface, but does not silently create new text edits.
- Unresolved dynamic access remains preview-first.
- Database side effects block apply unless `--allow-schema-change` is explicitly set.
- The system prefers over-reporting runtime impact to missing it.
