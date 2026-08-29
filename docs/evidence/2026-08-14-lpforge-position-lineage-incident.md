# 2026-08-14 LPForge position lineage incident

## Classification

`LPFORGE_ORIGIN_CONFIRMED_BY_USER_BUT_LINEAGE_MISSING`

The user confirms that LPForge opened the following Meteora position and that
they subsequently closed it manually after LPForge failed to manage it:

- Position: `DuHztt67NUT819AAaqJftEGWGQCyxa3DmLsJS4cZaisj`
- Pool: `CCHw81WFvz8SE4g9YSxRPs7ndZKhAsMsi2np2M2F6trW`
- Open transaction observed on chain: 2026-08-14
- Position account is now closed on chain.

## Preserved discrepancy

The execution database contains no execution-plan, submission, confirmation,
or `execution.owned_positions` linkage for this position.  That absence must
not be backfilled as historical fact.  It is the incident evidence: a
confirmed LPForge-originated position could become invisible to LPForge's
position authority and therefore did not enter monitoring or management.

## Regression requirement

The `LPFORGE_POSITION_LOST_AFTER_OPEN` regression test reproduces the safe
recovery path: a wallet-wide scan finds the position, a durable LPForge journal
links it to exactly one OPEN plan, and the system creates one owned-position
record and reconciliation record.  Unknown wallet positions remain detected
but are never adopted automatically.
