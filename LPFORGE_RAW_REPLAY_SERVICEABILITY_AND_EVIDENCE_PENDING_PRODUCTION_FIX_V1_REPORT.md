# LPForge raw replay serviceability and evidence-pending production fix V1

## Deployment

- Source before: `2645f1973a14ef7e0da35e389a77a5c2c79d563d`
- Source after: `b9791f9b85693ffb5277b3100e617a066b134dbd`
- Implementation: `raw-replay-serviceability-and-evidence-pending-v1`
- Discovery release: `/root/systems/LPForge/releases/b9791f9b85693ffb5277b3100e617a066b134dbd`

## Root cause and repair

Raw replay frames were collected only through the ordinary fair-slice path.  That
path produced 15--54 minute gaps; since each observation contributes at most 450
seconds, the resulting occupancy could not meet the unchanged 0.60 policy.

The repair introduces durable `WAITING_REPLAY_SERVICE` and `REPLAY_TRACKING`
states, a capacity-one raw replay lane, durable anchor/last-observation/deadline
fields, and priority ahead of ordinary economic collection.  The lane has a
300-second internal service target, a 450-second logical deadline, and 150
seconds of headroom.  Its one-slot cap is conservative with RPC concurrency one
and leaves the two protected live-continuity slots ahead of it.

Replay preparation now bounds the returned candidate window to the latest usable
60-minute horizon plus at most one 450-second terminal observation allowance;
it no longer accepts arbitrarily long 60--217 minute windows.

An authoritative latest-P3 reconciliation seeds the pre-deployment backlog into
the durable queue where its latest P3 result contains
`FEE_CALIBRATION_RAW_REPLAY_NOT_ACTIONABLE`.  This is generic repair logic, not
a pool-specific mutation.

Raw-replay insufficiency is persisted as `RAW_REPLAY_EVIDENCE_PENDING` and is
not terminalized/released merely because the system has not supplied service.
Unit-scale, replay-continuity, and event-path checks remain unchanged.

## Verification

- Focused typecheck: pass.
- Full canonical `pnpm test:ci`: pass (typecheck, build, full test suite,
  Phase 1--7/discovery/forward/post-entry/market/inventory boundaries, and
  migration static checks).
- Immutable artifact integrity verification: pass.
- Discovery and discovery-learning restarted only, both from the new immutable
  release. Production, execution, P7, and policies were not restarted or changed.

## Live-validation status

At handoff, both discovery processes were online from the deployed release. The
first post-restart collector pass was still in progress; no manual candidate
insertion, forced collection, trade, or policy change was performed. Therefore
natural >=60-minute / occupancy>=0.60 proof remains pending and this report is
intentionally not a claim of completed live maturity.
