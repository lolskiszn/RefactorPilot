# Go + TypeScript Field Rename

This example demonstrates the new golden-path cross-language impact analysis:

- Go backend defines `user_id` on a JSON payload
- TypeScript frontend reads `user_id` from the response
- RefactorPilot preview shows both files as impacted

Try:

```bash
node ./src/cli/index.js preview ./examples/go-typescript-field-rename --field user_id --to account_id
```
