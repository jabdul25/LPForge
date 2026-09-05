# LPFORGE Lease-Bound Evidence Continuity Architecture Fix V1

## Status

- Status: COMPLETE
- Source before: `5ea5c0d5a1b529b593d93bbec90a9a583528d56e`
- Initial implementation: `0b3efe13aa45c140c41a23930458e41767adb5d6`
- Final transition repair: `d7bc68dbb91ec75bb00e5e15399cd401b9934d94`
- Migration: none
- Economic lease cap: 2 (unchanged)
- RPC read concurrency: 1 (unchanged)
- Replay horizon: 60 minutes (unchanged)
- Replay completeness requirement: 60% (unchanged)
- New-entry/plan dispatch: disabled throughout

## Implementation

`collector-completion-aware-scheduling-v1` remains unchanged. This change adds
`evidence-continuity-tracking-v1`:

1. An evidence-maturity `P3 NO_TRADE` releases its economic `ACTIVE_CANDIDATE`
   lease as before.
2. If its reason codes show replay/range-survival evidence maturity, the
   dynamically discovered pool enters bounded `TRACKING` for exactly the
   existing 60-minute replay horizon.
3. The collector services up to one continuity pool in addition to, and
   explicitly separate from, the two economic leases. It writes the existing
   pool snapshot, bin-frame, market-observation, fee, and event-path stores.
4. The continuity pool has no execution authority and is excluded for
   static-policy/non-auto-discovered pools. It is deterministically evicted on
   capacity, TTL, stale/ineligible state, or terminal exclusion.
5. The 15-minute economic cooldown remains an economic-admission cooldown;
   it no longer stops raw-frame continuity.

The first deployed revision revealed a narrow transition issue: a previously
tracked pool temporarily re-admitted economically could be demoted back to
`QUALIFIED` with state `CONSUMED_BY_ACTIVE_ECONOMIC_LEASE`. Revision `d7bc68db`
restores that unexpired tracker to `TRACKING`. It also repairs existing eligible
qualified rows on reconciliation. Audit provenance is preserved.

## Tests and release integrity

- Focused collector/lease tests: 41/41 pass after transition repair.
- Canonical CI: 950/950 pass.
- Initial artifact SHA-256: `85cfab405c47d6b314342de69615bfd8b56dafc2d28d58d360fb9d5b30d58512`.
- Final artifact SHA-256: `2b9bb1263db0afd36899bf84425010bed5b50762c12df080d1463b58b13a10c2`.
- Final immutable release identity: `d2fa16b7310dd38483ac04ba3333d77514c3dd274f880e296ea3f2cf6126d03a`.
- Release integrity: PASS; migration head remains `M0069_production_global_candidate_contract.sql`.

## Deployment and final 60-minute validation

- Discovery runtime: `d7bc68db` release, online with zero restarts.
- Production runtime: `0b3efe13` release, online with zero restarts.
- Execution runtime was not reloaded or changed.
- Final observation: `2026-09-02T11:49:51.188Z` through
  `2026-09-02T12:49:51.191Z` (UTC).
- Collector passes: 53.
- Passes with a continuity pool: 48.
- Maximum continuity pool count: 1.
- Mean economic active leases: 2.000.
- Projected economic revisit: 180 seconds; projected continuity revisit: 270
  seconds, below the unchanged 450-second maximum gap.
- Live proof: `EAf6…5zpZ` was restored to `TRACKING` and immediately received
  a successful continuity full-frame collection (`collectionSliceSize=3`: two
  economic reads plus one continuity read).
- Raw full-frame evidence continued to accumulate. Mature/current examples
  reached one-hour raw completeness between 82.9% and 99.5%, including
  `DchD…AThk` at 82.87%, `ErwEe…vfdw` at 99.39%, and `EAf6…5zpZ` at 94.86% at
  their latest assessments.

No execution plan or transaction was created by this change. Historical
transaction counts were not rewritten.

## Judgment

The fix reconciles detailed-frame production with the existing 60-minute / 60%
replay contract without weakening an economic or trading policy. The evidence
lane is explicit, bounded, deterministic, dynamic-only, and read-only for
execution. It preserves evidence across an economic cooldown while retaining
the two-slot economic lease limit.

