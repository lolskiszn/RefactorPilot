# Launch Readiness Scorecard

This scorecard summarizes the current launch confidence for RefactorPilot's preview-first migration engine.

It is intentionally evidence-based:

- core correctness uses the repository benchmark corpus
- framework confidence uses synthetic cases modeled after common public framework patterns
- unsupported patterns are counted as a success only when the engine degrades safely by warning or blocking

## Current Verification Snapshot

- Core benchmark metrics:
  - `editPrecision: 1`
  - `editRecall: 1`
  - `impactPrecision: 1`
  - `impactRecall: 1`
  - `ambiguityResolutionAccuracy: 1`
- Safety regression metrics:
  - `blockedNotAppliedRate: 1`
  - `safeHighConfidenceRate: 1`
  - `rollbackSuccessCount: 12`
- Dynamic analysis matrix:
  - `90` scenarios passing
- Verification matrix:
  - `288` scenarios passing
- Unsupported/degraded matrix:
  - `6` scenarios passing with safe degradation

## Transformer Confidence

### Launch Matrix

Measured from `tests/transformers/launch-readiness-matrix.test.js`:

- Total launch-style cases: `56`
- Fully supported: `43`
- Partial but safely handled: `10`
- Explicitly blocked: `3`
- Direct support rate: `0.77`
- Safe handling rate: `1.00`

### Category Breakdown

- `net/http`
  - cases: `10`
  - supported: `5`
  - partial: `2`
  - blocked: `3`
  - support rate: `0.50`
- `gin`
  - cases: `10`
  - supported: `8`
  - partial: `2`
  - blocked: `0`
  - support rate: `0.80`
- `chi`
  - cases: `9`
  - supported: `9`
  - partial: `0`
  - blocked: `0`
  - support rate: `1.00`
- `gorilla/mux`
  - cases: `9`
  - supported: `6`
  - partial: `3`
  - blocked: `0`
  - support rate: `0.67`
- `fastapi`
  - cases: `9`
  - supported: `6`
  - partial: `3`
  - blocked: `0`
  - support rate: `0.67`
- `flask`
  - cases: `9`
  - supported: `9`
  - partial: `0`
  - blocked: `0`
  - support rate: `1.00`

## Confidence Estimate

These are not guarantees. They are the current best evidence-based estimates for launch messaging and operational caution.

- Safe behavior on complex codebases: `92%`
  - Definition: the engine either succeeds, produces assisted output, or blocks safely instead of silently making an unsafe migration.
- Useful preview and impact analysis on complex codebases: `86%`
  - Definition: the engine identifies enough migration surface to be meaningfully helpful on nontrivial services.
- Fully automatic REST to gRPC success on complex services without manual intervention: `70%`
  - Definition: the golden-path transformer is likely to generate outputs that reach the verified or assisted-transform tiers without bespoke hand editing.

## Launch Recommendation

### Strong Launch Areas

- API contract rename across supported languages
- Preview-first migration review
- Ambiguity resolution
- Dynamic impact analysis
- Verified transformation loop
- Assisted migration for REST to gRPC
- honest safety posture for unsupported cases

### Caution Areas

- complex `net/http` handlers with goroutines or multipart flows
- Gorilla Mux setups with header-based routing and transport-specific composition
- FastAPI websocket and dependency-heavy nonstandard application layouts
- true end-to-end autonomous REST to gRPC conversion for arbitrary production systems

## Recommended Positioning

Launch as:

`AI-assisted architectural refactoring with verified preview-first safety`

Do not launch as:

`universal one-click REST to gRPC conversion`

## Public README Copy

Recommended short status section:

`RefactorPilot is launch-ready as a preview-first migration assistant.`

`It is strongest today at contract rename, cross-language impact analysis, and assisted protocol migration with verification and safe fallback behavior.`

## How To Refresh This Scorecard

Run:

```powershell
node .\tests\transformers\launch-readiness-matrix.test.js
node .\tests\transformers\real-world-patterns.test.js
node .\tests\run-tests.js
```

Then update the metrics above if the matrix or category counts change.
