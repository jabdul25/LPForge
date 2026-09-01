# LPFORGE Remove Static Policy New-Entry Universe Privilege V1

## Result

The prior production universe added every `live-execution-policy.json` pool to every global selection cycle, then appended dynamic candidates and owned pools. This gave static membership a new-entry evaluation privilege.

`dynamic-new-entry-universe-v1` removes that privilege. The canonical global new-entry set is now only Tier-A discovery candidates that already satisfy one of the existing dynamic eligibility states:

- `ACTIVE_CANDIDATE`, including an existing pending Phase-3-ready lease; or
- `QUALIFIED` with the existing unexpired post-evidence evaluation handoff.

The existing `LPFORGE_PRODUCTION_OPERATOR_MAX_POOLS` bound and existing fair active rotation are retained. A disabled discovery operator produces an empty new-entry universe and therefore `GLOBAL_NO_TRADE`; it never falls back to policy pools.

## Authority separation

| Purpose | Authority after this release |
|---|---|
| New-entry global evaluation | `getProductionNewEntryEligiblePools()` dynamic discovery/evidence admission only |
| Global execution plan | Durable global winner pool and candidate identity only |
| Owned/open position management and recovery | Owned lifecycle state, independent of discovery eligibility |
| Static-policy health/canary diagnostics | Explicit policy healthcheck scope only |

`productionManagementPoolAddresses()` retains policy healthcheck identities and owned pools for management/drift observation. It is not passed to `runProductionGlobalSelectionCycle()`.

The operator's former static `PRODUCTION_POLICY_MONITORING` path now requires `LPFORGE_POLICY_HEALTHCHECK_POOL=true`. A policy-listed pool in an ordinary global evaluation follows the normal dynamic evidence path.

The Phase-6 claim guard also no longer treats ordinary static membership as new-entry admission. A normal risk-increasing plan for a static pool must have the same fresh `ACTIVE_CANDIDATE`, Tier-A, WSOL-Y production admission as a non-policy pool. The existing explicitly authenticated controlled-canary envelope remains the narrow exception.

## Plan provenance

An OPEN plan prepared from a global winner now persists and HMAC-authenticates:

- `globalCycleId`
- `selectedCandidateId`

The operator rejects a plan whose selected candidate does not match this provenance. No winner-to-static-pool fallback exists.

## Tests and CI

- Focused universe, P7, management/recovery, execution-provenance, and claim-guard tests: **52/52 PASS**.
- Canonical CI: **940/940 PASS**, including all Phase 1–7, discovery, migration, and boundary checks.
- Migration: **NONE**; schema head remains `M0069_production_global_candidate_contract.sql`.

## Immutable release

- Source commit: `8f0ea62ac2ede2316dab5c34c1af056002fc855a`
- Artifact SHA-256: `7afe17cd6438ad48fd96f15ef18069bdb3f7ef2ad43ca93415c601060e32f3db`
- Build identity: `db5b39a394aa79ff91fbd698370c84e7243c5b3aff5f6bdd839e15c18e0d9194`
- Runtime release: `8f0ea62ac2ede2316dab5c34c1af056002fc855a`
- Release integrity: **PASS**

Only `lpforge-production` and `lpforge-execution` were reloaded. Discovery and its scheduler/capacity configuration were not changed. `LPFORGE_GLOBAL_POOL_SELECTION_ENTRY_DISABLED=true` remained set throughout.

## Post-deploy validation

Validation window began at the first new-release completed cycle, `2026-09-01T19:40:57.854Z`.

The first 10 fresh cycles, and subsequently 12 fresh cycles by the final check, had:

- static policy pools included solely because of membership: **0**;
- non-policy dynamically eligible pools observed: **3** (`piAs…xJk`, `FxPP…T5X`, `3S86…vvd`);
- transactions/plans created after deployment: **0**;
- active positions: **0**;
- pending plans: **0**;
- unknown submissions: **0**;
- active reconciliation debt: **0**;
- terminalization debt: **0**.

The cycles remained fail-closed `GLOBAL_NO_TRADE` because no valid candidate economics formed; this release does not alter Candidate-Primary, economics, P3/P4, evidence TTL, collector capacity, scheduler, or entry thresholds.

## Historical safety

No historical records were changed. Drb, Bhh, HVE, and BcH therefore retain their historical `STATIC_POLICY` / deterministic-P7-probe provenance. The change applies solely to future new-entry eligibility.

## No-change statement

No shadow or research lane was created. Candidate-Primary, global-selector economics, discovery filters, collector cap, RPC concurrency, pool-reentry context, P3/P4, P7 economic policy, OOR, accounting, terminalization recovery, capital, and range policy were not changed. New-entry authority remains disabled.
