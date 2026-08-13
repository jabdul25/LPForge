# Pool Discovery D1/D2 Import Verification

Imported from `LPForge_Discovery_D1_D2_v0.1_source.zip`, whose source snapshot
is based on LPForge commit `43ff109b3a8de13e0e920031f9b1028d737f1d66`.

The import adds the discovery-only package and daemon, M0030 persistence,
policy, tests, Meteora Data API pagination/filter support, and the static
discovery authority boundary.

The daemon was aligned with LPForge's existing `DATABASE_URL` configuration
name; the source delivery referred to `LPFORGE_DATABASE_URL`, which is not an
existing LPForge runtime setting.

Validation after import:

- `pnpm test:ci`: PASS, 387 tests.
- `pnpm verify:discovery`: PASS.
- `pnpm verify:migrations`: PASS through M0030.
- M0030 applied to PostgreSQL.
- One `discovery:once` cycle completed at 2026-08-13T13:48:46.690Z.

That first cycle persisted 107 registry entries, 107 observations, and 64
rankings (10 tier A, 30 tier B, 24 tier C). D1/D2 itself remains an
observation service: it has no signer, transaction planner, or submission
path.

## Live-universe bridge

The versioned live-execution policy can explicitly enable a discovery feed.
When enabled, production evaluates only fresh PREFILTERED discovery records in
the configured tiers, and execution resolves that same universe again at
claim time before it signs. Pool capital and position limits come solely from
the live-execution policy; discovery records cannot set them.

The current policy enables up to ten fresh tier-A records, each with 0.02 SOL
and one position, subject to the policy's global two-position limit.
