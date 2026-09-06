# Centralized Production Runtime Configuration

Production runtime configuration belongs to the stable operational root, not
to an immutable release directory.

- Non-secret runtime settings: `/root/systems/LPForge/.env`
- Protected execution settings: `/root/systems/LPForge/.env.execution`
- Tracked release policy template: `policies/live-execution-policy.json`
- Sole canonical trading/execution runtime policy: `/root/systems/LPForge/policy/live-execution-policy.json`
- Immutable release artifacts: `/root/systems/LPForge/releases/<sha>/`

Release artifacts contain source, compiled output, manifests, and checksums.
They must not contain `.env`, `.env.execution`, or an authoritative runtime
policy. The release launcher exports `LPFORGE_HOME`, loads the centralized
environment files, and forces the canonical policy path before starting each
service. It is therefore safe to start a release from any working directory.

Use `pnpm runtime:config` from a release to display the loaded paths, the
effective non-secret execution flags, and the policy hash. It deliberately
does not print secret values.

Deployment validates the tracked template against `RELEASE_MANIFEST.json`,
then atomically promotes it to `/root/systems/LPForge/policy/` and verifies
the central runtime hash before activation. Ordinary service restarts only
load and verify that central file; they never overwrite it. Production rejects
relative and release-local policy paths and fails closed on a missing, invalid,
or hash-mismatched central policy. Preserve root ownership and mode `0600` for
`.env.execution`.
