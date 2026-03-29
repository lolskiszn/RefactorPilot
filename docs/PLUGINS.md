# Plugins

RefactorPilot supports a plugin-first extension model for community contributions and internal specialization.

The goal is to keep the core engine stable while letting the ecosystem grow around it.

## What plugins are for

- language frontends
- migration patterns
- deployment strategies
- optional hooks for automation and webhooks

## Design rules

- Core commands keep working with no plugins installed.
- Plugins load lazily and should never slow down normal analysis paths.
- Trusted built-in plugins can run natively.
- Untrusted third-party plugins should be sandboxed by the host application.
- The plugin API is intended to stay semver-stable at `1.0.0`.

## SDK

Use [@refactorpilot/language-sdk](../packages/language-sdk/README.md) as the starting point for plugin authors.

It provides:

- `BaseParser`
- `createPlugin`
- `createPatternPlugin`
- `createLanguageFrontendPlugin`
- `createDeploymentPlugin`

## Hello World pattern

1. Create a package with a `package.json` and an ESM entrypoint.
2. Export a plugin object built with `createPatternPlugin`.
3. Add a `README.md` that explains what the plugin does.
4. Keep the preview path deterministic and side-effect free.

Example:

```js
import { createPatternPlugin } from "@refactorpilot/language-sdk";

export default createPatternPlugin({
  id: "pattern:hello-world",
  language: "python",
  name: "Hello World Pattern",
  version: "1.0.0",
  description: "A starter pattern plugin.",
});
```

## Local example plugin

This repository includes a publish-ready local example package at `examples/plugins-example/django-to-fastapi`.

It is intentionally documented as an example only. It is not claimed to be published to npm from this repo.

## Safety notes

- Treat external plugins as untrusted input.
- Load them in a sandbox or equivalent isolation boundary.
- Never give a plugin direct access to the core analysis filesystem unless the host explicitly allows it.
- Keep plugin hooks async so the core can continue to load quickly.
