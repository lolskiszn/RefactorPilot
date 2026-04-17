# Go Toolchain Fork Policy

RefactorPilot will track a pinned upstream Go release for compiler-fork work.

Current policy:

- standard library and toolchain APIs are used first for typed scan and preview work
- `cmd/compile` is not vendored in this wave
- future fork imports must record:
  - upstream Go version
  - fork import date
  - patch series order
  - compatibility notes for rebases

Patch convention:

- one patch directory per upstream version under `toolchain/patches/<go-version>/`
- numbered patches in application order
- each patch must describe:
  - touched upstream area
  - exported capability added
  - expected rebase risk
