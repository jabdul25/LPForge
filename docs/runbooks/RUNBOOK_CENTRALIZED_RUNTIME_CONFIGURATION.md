# Centralized Production Runtime Configuration

Production runtime configuration belongs to the stable operational root, not
to an immutable release directory.

- Non-secret runtime settings: `/root/systems/LPForge/.env`
- Protected execution settings: `/root/systems/LPForge/.env.execution`
- Canonical trading/execution policy: `/root/systems/LPForge/policy/live-execution-policy.json`
- Immutable release artifacts: `/root/systems/LPForge-release-<sha>/`

Release artifacts contain source, compiled output, manifests, and checksums.
They must not contain `.env`, `.env.execution`, or an authoritative runtime
policy. The release launcher exports `LPFORGE_HOME`, loads the centralized
environment files, and forces the canonical policy path before starting each
service. It is therefore safe to start a release from any working directory.

Use `pnpm runtime:config` from a release to display the loaded paths, the
effective non-secret execution flags, and the policy hash. It deliberately
does not print secret values.

Before a release is activated, copy the validated policy set to
`/root/systems/LPForge/policy/` and verify its live execution policy hash
matches `RELEASE_MANIFEST.json`. Preserve root ownership and mode `0600` for
`.env.execution`. The release integrity verifier fails if a release-local
runtime environment file is present.
