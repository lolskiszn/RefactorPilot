# @refactorpilot/language-sdk

This package defines the minimal plugin SDK for RefactorPilot.

It is intentionally small:

- `BaseParser` for language frontend authors
- plugin factory helpers for patterns, frontends, and deployment strategies
- no runtime dependencies
- ESM-first and Node 20+

## Install

```bash
npm install @refactorpilot/language-sdk
```

## Quick start

```js
import { BaseParser, createPatternPlugin } from "@refactorpilot/language-sdk";

class MyParser extends BaseParser {
  parse(source, filePath) {
    return {
      filePath,
      language: this.language,
      sourceLength: source.length,
    };
  }
}

export default createPatternPlugin({
  id: "pattern:hello-world",
  language: "python",
  name: "Hello World Pattern",
  version: "1.0.0",
});
```

## Template README shape

Use this structure for community plugins:

```md
# Plugin Name

Short summary of what the plugin does and what RefactorPilot surface it extends.

## What it supports

- languages
- patterns
- deployment strategies

## Install

## Usage

## Manifest

## Safety notes

## Contributing
```

## API surface

- `BaseParser`
- `createPlugin(manifest, implementation)`
- `createPatternPlugin(manifest, implementation)`
- `createLanguageFrontendPlugin(manifest, ParserClass, implementation)`
- `createDeploymentPlugin(manifest, implementation)`

## Compatibility promise

The plugin API is versioned as `1.0.0`. The goal is to keep this surface stable for the first year of public extension development.
