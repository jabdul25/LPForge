# LPForge TS-5 Model-C + OOR-P4 production implementation

## Provenance and scope

- Starting source revision: `ef5fa5da85673b30c0c3d88cc4ae69755bdc7ff8`.
- Final source revision: the immutable release manifest produced from the commit containing this report.
- Scope: canonical live-position management only. No entry, range, capital,
  accounting, settlement, existing OOR-lifecycle, or existing Meteora-compatible
  `+8%` profit-protection semantics were changed.
- Schema migration: none.

## Policy contract

The centrally mounted, validated `live-exit-governor-policy.json` now carries
`profitRetention` version `profit-retention-ts5-oor-p4-v1`:

- TS-5: managed MFE `>= 4%`, observed giveback `>= 2pp`, fixed 300-second
  `EXPIRE_REARM` watch, lower-third (`<= 1/3`) in-range confirmation, and a
  subsequent lower managed mark.
- The window is fixed, permits confirmation exactly at expiry, does not roll,
  and is only re-armed by a following qualifying observation after expiry.
- OOR-P4: managed MFE `>= 2%` plus `BELOW_MIN` plus exact
  `OOR_TOKEN_EXPOSURE`. `SAFE_OOR_SOL`, `MIXED_INVENTORY`,
  `INVENTORY_UNAVAILABLE`, `ABOVE_MAX`, and `IN_RANGE` are excluded.

## Canonical architecture and safety

The pure evaluator is `assessProfitRetentionProtection` in
`packages/live-exit-governor`. It is invoked by the existing owned-position
management cycle, generates the existing `CLOSE` action with either
`PROFIT_RETENTION_TS5_CONFIRMED` or
`PROFIT_RETENTION_OOR_P4_CONFIRMED`, and then follows the existing
management-plan, P7, P6, submission, reconciliation, and settlement path.
There is no second management engine or execution route.

Managed economics is accepted only for these two narrowly scoped protections
when it is `AVAILABLE`, finite, fresh, reconciled, exact-position/pool scoped,
and free of an active management plan. Existing receipt-backed valuation and
attributable-inventory safeguards remain the source of that mark.

MFE remains per-position and monotonic in `execution.position_exit_state`.
The bounded TS-5 watch is stored in that row's merged payload with policy
version/hash and ordered observation provenance. A predecessor usable mark is
queried deterministically from the same position/pool and must pass the
configured maximum-age gate. Out-of-order, unavailable, stale, terminal, or
reconciliation-unsafe facts cannot arm or confirm either protection.

Protective close persistence uses a per-position PostgreSQL transaction:
advisory lock, exit-state row lock, active-plan recheck, confirmed-watch
transition, intent, plan, and steps. This serializes TS-5, OOR-P4, and
hard-stop close creation without blocking a different position.

## Release integrity and runtime policy

The immutable release manifest now hashes the live exit-governor policy as
well as the execution policy. Installation validates and atomically promotes
the release-bound exit policy to the existing central policy mount before
runtime identity enforcement. The release itself contains no secret or runtime
configuration file.

## Historical implementation regression

The read-only replay imports the actual compiled pure evaluator and preserves
the selected 32-position research cohort. It asserts:

- TS-5 layer-1 triggers: `7fhXb...` and `5KbEx...` only;
- `7fhXb...`: fixed watches at `12:08:51`, `12:14:26`, and `12:19:53`; the
  third expires `12:24:53` and confirms at `12:24:24` at approximately
  `-0.94221495%`;
- `5KbEx...`: confirms at `23:14:30` at approximately `+0.41029327%`;
- no historical terminal winner becomes a TS-5 layer-1 trigger;
- Model-C plus OOR-P4 hybrid mean: `+1.2558387653%` observed marked return.

These are historical marked-economics regressions, not claims of executable
historical liquidation proceeds.

## Validation

- Focused governor/management tests: 58 passing, plus 1 real PostgreSQL
  concurrent close-intent test.
- Full CI: 1,146 passing, 0 failing, 1 intentionally skipped because CI has
  no PostgreSQL integration URL.
- Typecheck, build, P5/P6/P7 boundary checks, migration static validation,
  and release-identity tests: pass.

No Production database mutation or historical-accounting correction is part of
this implementation. Activation is permitted only after an immutable release,
post-install replay, release-integrity verification, and aligned P7/P6 runtime
provenance all pass.
