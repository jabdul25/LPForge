# LPForge Automated Post-Trade Reporting V1

## Scope and provenance

- Starting source SHA: `2c525e7644a81c1410ca82f29aa3c48e7a096515`
- Final source SHA: recorded by the immutable release manifest and deployment handoff.
- Scope: post-trade reporting and Telegram observability only.
- Database migrations: none.
- Economic policy changes: none.

## Architecture

The report is constructed only after `execution.lifecycle_sol_settlements` has
committed canonical settlement and the close fee attribution pass has finished.
It is then enqueued through the existing durable
`execution.phase7_telegram_alert_outbox`; Telegram delivery is never performed
inside the settlement transaction and cannot block settlement, P6, P7, or
trading.

The canonical report builder reads one requested settlement version and rejects
it when it is no longer the latest version for its lifecycle.  Running metrics
use `DISTINCT ON (lifecycle_id) ... ORDER BY settlement_version DESC`, exclude
open positions, and apply the versioned `postTradeReporting.runningStatsStartAt`
policy boundary.

The durable report identity is:

```text
POST_TRADE_REPORT:<lifecycle-id>:<settlement-version>
```

The normal event uses transition `SETTLED`; a superseding version uses
`CORRECTED_TO_V<n>`.  Existing outbox fingerprint uniqueness supplies replay
idempotency: one normal report per canonical settlement version and one
correction report for a newer canonical version.

## Canonical data sources

| Report item | Canonical source |
|---|---|
| Realized capital, SOL PnL, return, settlement version/time | `execution.lifecycle_sol_settlements` |
| Lifecycle identity/open time/terminal state | `execution.position_lifecycles` |
| LP fees, inventory/unwind PnL, transaction costs | `execution.position_realized_economics` |
| Trustworthy managed MFE | `execution.position_exit_state.peak_net_return_fraction` |
| TS-5 / OOR-P4 evidence and reason codes | durable exit-state payload and canonical governor/plan evidence |
| Decision/plan/submission/confirmation timings | management plans and P6 submission/confirmation records |
| Pool display metadata | durable pool/token metadata |

Managed MFE remains explicitly labelled as a historical managed mark.  Final
capital, PnL, return, and running results remain canonical settled accounting;
the reporter does not recompute accounting from wallet deltas.

## Report contract

Each report contains identity, canonical final economics, canonical lifecycle
duration, peak MFE/giveback, available fee/inventory/cost components,
TS-5/OOR-P4 protection status, close reason, available execution timings, and
running canonical results.  Unavailable optional enrichment renders as `n/a`,
never as an invented zero.

The formatter emits a concise Telegram message with:

- `✅` WIN, `❌` LOSS, or `⚪` BREAK-EVEN;
- a distinct `♻️` settlement-correction message with old/new result values;
- bounded reason text and Telegram-safe message size;
- raw structured report evidence retained in the durable outbox payload.

## Policy and safety

The versioned live execution policy adds only:

```json
"postTradeReporting": {
  "enabled": true,
  "policyVersion": "post-trade-reporting-v1",
  "runningStatsStartAt": "2026-09-01T00:00:00.000Z"
}
```

This is an observability cohort definition, not trading authority.  It does not
change TS-5, OOR-P4, the existing Meteora-compatible +8% protection, OOR
lifecycle, P6/P7 authority, entry/range/capital policy, or accounting.

## Validation

Focused tests cover WIN/LOSS/BREAK-EVEN rendering, optional `n/a` values,
TS-5/OOR-P4 state presentation, correction identities, no-loss profit factor,
BigInt-safe outbox serialization, policy validation, and settlement ordering.

Read-only production-data dry run rendered three winners, three losses,
historical 7fhXb and 5KbEx examples, and a corrected 8ic5 lifecycle without
sending Telegram.  It verified that the report query uses latest canonical
settlement versions and rendered the known `8ic5` v1 to v2 correction.  At the
validation instant, the Sep-1 cohort had 31 canonical settlements (21 wins,
10 losses), net `-0.001441339 SOL`, gross profits `+0.033210651 SOL`, and gross
losses `-0.034651990 SOL`; these figures are intentionally time-sensitive.

No production database rows, settlements, policy values, or runtime processes
were changed by the dry run.

## Deployment and activation

Activation requires a clean committed source tree, full CI, immutable release
integrity validation, and aligned restart of only the P6/P7/Telegram runtime
path required for reporting.  The next future canonical settlement will queue
its report through the durable outbox; historical dry-run reports were not sent
to Telegram.
