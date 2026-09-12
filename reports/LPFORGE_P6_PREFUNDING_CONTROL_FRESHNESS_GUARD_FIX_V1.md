# P6 Pre-Funding Control Freshness Guard Fix V1

## Scope

- Starting source SHA: `651a5a19140d3866018323339253e75b378bd69d`
- Scope: P6 OPEN admission and execution safety only.
- No policy threshold, P7 authority rule, signer, transaction format, recovery rule, or accounting formula changed.

## Incident causal chain

Plan `plan-7c4691a1ff423eeab7f7bf2ee8790b0e` began with a valid but
near-expiry P7 control. Its funding swap confirmed while the control was still
inside P6's fixed 60-second authority window. The subsequent position-open
boundary crossed that same fixed window, correctly failed closed, and created
a real partial-entry recovery. The recovery later completed as
`ABORTED_SOL_SETTLED`; no LP position was opened by that plan.

The failure was therefore a preventable multi-leg time-of-check/time-of-use
race, not a relaxation opportunity: P6 must continue to reject stale P7
authority at every signing boundary.

## Change

P6 now reserves a 30-second remaining-freshness budget immediately before an
OPEN's Jupiter funding leg. A control that cannot remain within the existing
60-second P6 hard limit through that bounded hand-off is re-read once using
the existing fresh-control reload mechanism. If it is still too near expiry,
the unsigned plan returns to `PLANNED` with
`P6_CLAIM_P7_CONTROL_FRESHNESS_BUDGET_REQUEUED`; no transaction is signed or
submitted.

This is only applied to the pre-funding Jupiter path, where a later fail-close
could otherwise strand paired-token inventory. The ordinary P6 60-second
freshness limit and final pre-submission validation remain unchanged.

`P6_CURRENT_CONTROL_MAX_AGE_MS` is now exported by the claim guard and reused
by the worker, preventing drift between the canonical authority limit and the
new pre-funding calculation.

## Safety properties

- A budget miss cannot authorize a stale control.
- One bounded re-read may observe a newly committed P7 record, but it does not
  extend its TTL.
- Only a freshness-only block is eligible for the unsigned requeue.
- Health, safety, drift, portfolio, protocol, RPC, and market vetoes continue
  to fail closed rather than retrying as freshness misses.
- No additional RPC calls, database schema changes, or background process were
  introduced.

## Validation

- Focused execution-safety suite: 9/9 passed.
- Typecheck: passed.
- Build: passed.
- Full CI: passed before release packaging.

## Deployment expectation

After deployment, a plan approaching the P6 P7-control freshness boundary
before funding is safely requeued. It can be claimed again only after a fresh
P7 control passes the existing full claim and execution safety checks.
