# LPForge 5-hour post-maturity P3/P4 readiness recheck V1

## Scope

Read-only recheck from 2026-09-01T23:19:04.782Z through
2026-09-02T05:28:50Z (6.16 hours).  Discovery collector runtime is
`5ea5c0d5a1b529b593d93bbec90a9a583528d56e`; production/execution remain in
observe-only operation with new-entry authority disabled.

## Cohort and funnel

| Stage | Count |
| --- | ---: |
| Global selection cycles | 738 |
| Distinct dynamically evaluated pools | 19 |
| LIVE_CONFIRMATION_CONFIRMED pools | 14 |
| P3 ENTRY_READY decisions | 1 |
| Distinct P3 ENTRY_READY pools | 1 |
| P4 AUTHORIZED | 0 |
| P4 WAIT | 1 |

The collector recorded 351 passes and 653 successful active-pool reads.  Its
current registry contains two ACTIVE candidates and seven QUALIFIED pools.

## First actionable dynamic result

`EAf6shtt8QGJ7UiSRrDc6pzwXKEmb5s7tCCpSDe5zpzZ` (BUTTHOLE) reached:

- P3 `ENTRY_READY` at 2026-09-02T03:06:15.978Z;
- sole-candidate `GLOBAL_WINNER` at 03:06:22.158Z;
- P4 `WAIT`, not authorization.

P4's canonical reason is `OPERATIONAL_CAPITAL_ALLOCATION_ZERO` plus
`OPERATIONAL_ENTRY_NOT_READY`.  This is the expected observe-only consequence
of disabled entry authority; it is not a P4 economic/risk rejection and did
not create a plan or transaction.

The selected local candidate was
`narrow-41-20-20-curve-skewed_y-1000`, capital 0.03 SOL, with:

- candidate net value: `+0.00009830382417759191 SOL`;
- risk-adjusted ranking utility: `+0.00008066419118324289 SOL`;
- uncertainty: `0.8121033785661481` (soft context);
- OOR risk: zero for the selected candidate;
- survival probability: one; and
- fee calibration status: calibrated via normalization-scale credibility.

Its separate aggregate opportunity model remained negative
(`-0.00004924864676547342 SOL`) and uncertain, but Candidate-Primary's
existing local candidate authority correctly selected the positive actionable
range.  No policy was changed to obtain this result.

## Replay/range-survival conclusion

The earlier common blocker has demonstrably matured for BUTTHOLE: actionable
candidate replay, range-survival support, and fee calibration now exist.  The
prior five-hour maturity-delay conclusion was therefore correct; a production
evidence-pipeline defect is **not** proven.

Fourteen dynamic pools obtained a confirmation during the recheck.  The
current remaining NO_TRADE population still contains non-actionable replay or
range-survival candidates, but that is no longer universal.  It is a
pool/range-specific state, not evidence that the producer is stuck.

## OTC

`Ekm4LYkihEdQgZx2UReDMJ3eCDDjExPQLG94WfWmfyWr` (OTC) has not become
ENTRY_READY.  Its latest evaluation at 05:18:47Z is P3/P4 NO_TRADE while its
then-current live-confirmation state is WARMING.  The blockers remain
`FEE_CALIBRATION_RAW_REPLAY_NOT_ACTIONABLE` and
`NO_TRADE_EVIDENCE_NON_ACTIONABLE`; the previous positive aggregate net EV
does not prove a concrete candidate range is actionable.

## Global-selection impact

Of 738 cycles, 737 were zero-candidate and one was a single-candidate global
winner (BUTTHOLE).  There was no new genuine multi-candidate competition.
The cumulative genuine multi-candidate competition count remains three.

## Judgment

- Replay evidence should be able to mature in this time range: **YES**, as
  demonstrated by BUTTHOLE.
- Replay progress: **HEALTHY**, though pool-specific and not universal.
- Data producer health: **HEALTHY**; candidate-covered frames and live data
  are being generated.
- Common remaining blocker: candidate-specific replay/range-survival evidence
  for pools/ranges without enough covered continuity.
- Post-maturity production gap: **NO**.
- Entry-authority readiness: **NOT_READY**; only one sole-candidate result,
  no P4 authorization under validation mode, and no new multi-pool
  competition.

No source, DB, deployment, policy, threshold, selector, collector, or entry
authority change occurred during this recheck.
