# @refactorpilot/pattern-django-to-fastapi

This is a publish-ready local example package for the RefactorPilot plugin model.

It is not claimed to be published to npm from this repository. It exists to show the expected package shape, manifest, and preview entrypoint for a community plugin.

## What it does

- detects Django-style signals in Python projects
- emits a preview-only migration summary toward FastAPI
- stays side-effect free and deterministic

## Local usage

```js
import plugin from "./src/index.js";

const result = await plugin.preview({
  files: [
    {
      path: "app/views.py",
      source: "from django.urls import path\n",
    },
  ],
});

console.log(result.summary);
```

## Package notes

- package name: `@refactorpilot/pattern-django-to-fastapi`
- version: `1.0.0`
- module type: `module`
- publish config: public

## Safety notes

- preview-only by default
- no filesystem writes
- no network access
- designed to be wrapped by a host sandbox for untrusted installs
