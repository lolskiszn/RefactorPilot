# RefactorPilot Toolchain

This directory now contains the upstream Go fork checkout and RefactorPilot-specific toolchain work.

Current contents:

- `upstream-go/`: upstream Go source used as the fork base
- `bin/`: locally built toolchain-side utilities
- `build-compiler-exporter.ps1`: builds the fork-local typed AST exporter
- `GO_BOOTSTRAP_BIN`: optional environment variable pointing at the bootstrap `go` executable used by the build script

Current fork-local utility:

- `src/cmd/compile/refactorpilotexport` inside `upstream-go`
  - parses package files with `cmd/compile/internal/syntax`
  - type-checks with `cmd/compile/internal/types2`
  - exports a JSON view of declarations, defs, uses, and selections

This is the first concrete typed-export surface from compiler internals. It is intentionally narrower than a full `cmd/compile` driver patch.

The main `go-core` engine will detect and use the built exporter binary when present, and will fall back to the `go list` + `go/types` path otherwise.
