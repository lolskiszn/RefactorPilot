# RefactorPilot MVP Architecture

## Scope

This MVP turns the PRD into a working boundary-aware analysis tool for Go and Python. It does not attempt compiler-grade semantic equivalence yet. Instead, it proves the core product shape:

1. Frontends extract code and boundary facts.
2. A shared IR graph normalizes those facts.
3. Orchestration layers can plan a cross-language transformation.

## Implemented layers

### Layer 1: Language frontends

- Go analyzer for structs, JSON tags, handlers, and field access
- Python analyzer for functions, classes, route decorators, JSON key access, and HTTP calls

### Layer 2: Shared IR

- file, symbol, field, endpoint, and data-flow nodes
- defines, references, exposes, flows-to, and cross-boundary co-location edges

### Layer 3: Transformation planning

- field rename preview
- impacted-file report
- candidate text replacements

### Layer 4: Orchestration

- workspace scanning
- graph assembly
- future hook points for transactional apply, rollback, and verification

## Why this is the right first slice

The PRD calls out a concrete milestone: if a field changes in Go, which Python files need to change too? This MVP answers that question with a shared graph and an actionable rename plan.
