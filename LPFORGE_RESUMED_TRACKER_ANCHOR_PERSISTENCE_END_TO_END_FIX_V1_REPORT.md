# LPFORGE_RESUMED_TRACKER_ANCHOR_PERSISTENCE_END_TO_END_FIX_V1_REPORT

**Status:** FULLY_RESOLVED

## Root cause and correction

A `QUALIFIED` candidate resumed through the `EVIDENCE_CONTINUITY` collector path. That path called `recordEvidenceContinuityCollectionOutcome`, which updated the latest successful observation and deadlines but did not establish `evidenceContinuityEpisodeAnchorAt`. The active-candidate path did establish an anchor. Consequently, a resumed qualified record could be `TRACKING` with no durable protected-episode anchor.

Commit `e1cdff732d450ef2bb0eeee4fd17fe9d57aa4874` makes the resumed continuity update atomic: it initializes `evidenceContinuityEpisodeAnchorAt` and `evidenceContinuityTrackingStartedAt` from the first protected successful observation only when absent, and preserves them with `COALESCE` on later reads. Existing anchor-bound maturity filtering remains in force: only observations at or after that immutable anchor count.

Implementation ID: `durable-protected-episode-anchor-v1`

## Validation

- Focused anchor/continuity/collector test suite: **45/45 passed**.
- Canonical CI: **989/989 passed**.
- Boundary and migration/schema checks: **passed**.
- PostgreSQL parser check of the resumed-anchor update: **passed**.
- Discovery and discovery-learning deployed from immutable release `/root/systems/LPForge/releases/e1cdff732d450ef2bb0eeee4fd17fe9d57aa4874`.

## Live evidence after deployment

No active `TRACKING` record was anchorless. No waiting record had active anchor, deadline, retained-observation, or internal-service-deadline metadata. No post-fix `ACTIVE_CANDIDATE` SQL syntax error was recorded.

Two post-repair protected episodes completed naturally:

| Pool | Anchor | Confirmation | Post-anchor observations | Max gap | Release |
|---|---|---|---:|---:|---|
| `3C6qVymTAwWNKCSspmd1qbUH9avaqhsjgW2yntvEYBXt` | 2026-09-04 23:56:14.988 UTC | 2026-09-05 00:06:25.314 UTC | 10 | 93.494s | 2026-09-05 00:07:36.381 UTC |
| `5A15QUc6kMxw9dsVpVUv6ZdTTBeyWBN2scyy1MEQJFQs` | 2026-09-04 23:58:31.425 UTC | 2026-09-05 00:08:50.884 UTC | 10 | 92.143s | 2026-09-05 00:09:36.391 UTC |

All 18 completed retained intervals landed before the +300s internal deadline; none landed in the +300s to +450s band and none exceeded 450s. The release of the first completed tracker admitted `EZyszDEx1LZDt7TsSFV8xdPi49sDKC3mdfv2MVMEQLtU` with a new anchor at 2026-09-05 00:08:57.536 UTC. Its subsequent retained observations preserved that anchor and had a maximum observed interval of 87.150s.

`ARqHS4dXM989rYBjDKzx249yqBXQtdrUioemyoGEnAnk` is no longer active protected tracking (`QUALIFIED / NOT_REQUIRED`); therefore it is not an anchorless protected episode. The repaired contract prevents it from resuming `TRACKING` without a fresh persisted anchor.

## Downstream

The first confirmed pool's production selector cycle was semantically a no-trade outcome (zero globally eligible pools). Independently, the normal post-confirmation path was live-observed for `7t477j7S8SDcdg1pzCSvjRjYK3nPc14FmrbzPYTjfHYs`:

`LIVE_CONFIRMATION_CONFIRMED -> P3 ENTRY_READY -> P4 ENTRY_READY -> PLAN_PREPARED`.

Plan `plan-2c6533f17132b98438d33ea9bc32b81d` was prepared build-only; no forced trade or signing/broadcast occurred.

## Safety state

P7 latest cycle reported `HEALTHY`, `PRODUCTION`, and `newEconomicActionAllowed=true`; recovery queue, unknown submissions, and unresolved reconciliation debt were zero. Position lifecycle records show 9 `SOL_SETTLED` and zero non-terminal positions. Production remained enabled and unchanged except for the authorized immutable discovery release.
