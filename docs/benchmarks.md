# Benchmarks

Run the rename-planning benchmark harness with:

```bash
node benchmarks/run.js
```

Optional flags:

- `--json` prints the full report as JSON.
- `--out <file>` writes the JSON report to disk.
- `--fixture <name>` runs a single fixture directory.

Fixture layout:

- `tests/fixtures/benchmarks/<scenario>/benchmark.json`
- `tests/fixtures/benchmarks/<scenario>/workspace/*`

Each `benchmark.json` file defines:

- the rename target
- expected impacted files
- expected edit tuples
- whether apply should be allowed
- an optional rollback probe index for simulated transaction checks

The harness reports:

- edit precision
- edit recall
- diff noise
- impact precision
- impact recall
- preview latency
- apply success
- rollback success
