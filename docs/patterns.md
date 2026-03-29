# RefactorPilot Patterns

RefactorPilot now exposes a small pattern registry that sits on top of the current engine.

## Available Patterns

- `api-contract-rename` previews a contract field rename across Go and Python, using the existing rename engine.
- `rest-to-grpc` previews a demo/spec migration path with placeholder `.proto`, stub, and spec artifacts.

## What The Preview Returns

Each pattern preview includes:

- impacted files
- confidence and warnings
- generated artifact placeholders
- notes that explain what is and is not automated

## Example

```js
import { previewPatternMigration } from "../src/patterns/index.js";

const preview = await previewPatternMigration("rest-to-grpc", "./workspace");
console.log(preview.generatedArtifacts);
```

## Safety

The `rest-to-grpc` path is intentionally preview-only. It does not claim full semantic conversion or write generated files.

## Verification

Run the pattern suite directly:

```powershell
node .\tests\patterns\run-patterns.js
```

The suite covers the registry, preview metadata, a safe apply smoke test, and 200+ generated scenarios across the new pattern paths.
