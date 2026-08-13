# pnpm Lockfile Status

The dependency lockfile gap is closed in Phase 4 v1.0.2.

- `pnpm-lock.yaml` was generated on a connected Node 24 / pnpm 11.21.0 host from the exact pinned LPForge dependency manifest.
- The supplied offline pnpm content-addressed store was checksum-verified in the validation sandbox.
- LPForge then installed all 168 resolved packages offline under Node 24.19.0 and passed typecheck/build/tests.
- CI and deployment must use `pnpm install --frozen-lockfile`.
- Only `bigint-buffer`, `bufferutil`, and `utf-8-validate` are explicitly approved for dependency build scripts in `pnpm-workspace.yaml`; do not enable blanket build-script execution.
- The validation sandbox temporarily used `trustLockfile: true` because registry metadata was unavailable offline. That override is deliberately not committed in the release so connected deployment hosts retain normal pnpm supply-chain verification.
