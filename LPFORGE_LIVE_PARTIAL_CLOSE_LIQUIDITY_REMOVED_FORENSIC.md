# LPFORGE live partial-close / liquidity-removed forensic

**Scope:** read-only incident forensic.  No database rows were changed, no
transaction was submitted, and no service was restarted.

**Evidence cutoff:** 2026-09-01 06:29:53 UTC.  Direct Meteora SDK read was at
2026-09-01 06:27:34 UTC (slot 443355316); direct RPC signature/account reads
were at 06:29:41 UTC.

## Executive finding

The protective close removed all DLMM liquidity and both lifecycle-attributable
NEEGY amounts were successfully converted to SOL.  No terminal fee was
claimable at the close snapshot, so no terminal claim transaction was required.
The final `METEORA_CLOSE` child was submitted but never appeared in Solana RPC
history and was deterministically recovered as `EXPIRED_NO_CHAIN_EFFECT`.

The Meteora PositionV2 account therefore still exists, holding its 57,406,080
lamport rent, but its direct chain state is empty: liquidity, token X, token Y,
fees, and rewards are all zero.  LPForge correctly cannot reach `SOL_SETTLED`,
because the settlement boundary explicitly requires the position account to be
absent.  The database lifecycle remains incorrectly `OPEN` rather than an
explicit empty-account-close-recovery state.

## Identity and authority

| Fact | Value |
|---|---|
| Position | `BcHk2btyymBVz8W5Yk2pMhCpz23ZvAV8k2MzvUgqL2J1` |
| Lifecycle | `lifecycle:BcHk2btyymBVz8W5Yk2pMhCpz23ZvAV8k2MzvUgqL2J1` |
| Pool | `EsR3gRxMtqt3bBhDDsuY3SFyYNYvYzszzG9KVYpcQfs7` |
| Pair | NEEGY / WSOL |
| Strategy | `BID_ASK / BALANCED` |
| Range | -597 .. -583 (entry bin -589) |
| Entry | 2026-08-31 20:22:26.718 UTC |
| Configured capital | 30,000,000 lamports |
| Close plan | `plan-56116daf25db4ec3ad1cd6904483825b` |

The close was autonomous, authorized by the existing independent OOR lifecycle
reason codes `POSITION_OOR_ACTION_REQUIRED` and `POSITION_OOR_TOKEN_RISK`.
P7 was `PRODUCTION / HEALTHY / NORMAL` at the decision.  It had
`new_economic_action_allowed=false` for new entry, but protective position
management remained authorized.  The global selector and global candidate
contract had no causal role: they govern new-entry selection only.

## Chain truth

The direct Meteora SDK PositionV2 read proves the account exists with owner
`BfLVvHc2hsEPSRcC3MXQ2H3ixwyruRxCdp9zZSUoSfSd`, range -597 .. -583, and:

| Chain field | Value |
|---|---:|
| `totalXAmount` | 0 |
| `totalYAmount` | 0 |
| `feeX`, `feeY` | 0, 0 |
| rewards | 0, 0 |
| position-account lamports | 57,406,080 |

This is `LIQUIDITY_REMOVED_ACCOUNT_OPEN` / `NO_PRINCIPAL_REMAINING`, not an
active LP position.  The owner’s NEEGY token account was directly read at zero;
there was no WSOL token account.  The chain data supports no outstanding
lifecycle-attributable token principal.

## Close plan and child transactions

| Order | Operation | Chain result | Signature | Effect |
|---:|---|---|---|---|
| 1 | `METEORA_REMOVE` | `CONFIRMED_MATCH`, finalized slot 443285461 | `5dyg3yuwfFErYLnZpiQ9TKyjPxubpw6DgpgnRdpSjhNo6eq43QPZyqrLfdFr8JmGJuurruQQQ44A8oqKfMi447z1` | all liquidity removed; 10,685,101,569 raw NEEGY attributed; 5,000-lamport tx cost |
| 2 | terminal Meteora claim | `NOT_REQUIRED` | — | pre-close snapshot feeX=0, feeY=0; claim builder returned nothing-to-claim |
| 3 | primary Jupiter unwind | `CONFIRMED_MATCH`, finalized slot 443285480 | `4cNwSUkfPg4roYFJwrfZcJFFM1MPKWGLmoRCA7Ny7hNfvANGjA7mx4chyiw6EzFdX8bJRHG72DquyUpHGxgvSYuB` | 10,685,101,569 raw NEEGY -> 26,506,794 lamports SOL; 5,000-lamport tx cost |
| 4 | recovered entry-residual Jupiter unwind | `CONFIRMED_MATCH`, finalized slot 443285494 | `5qWWr8NCzwSB5U9y6ZNJYbhE2BWeUdDfHCoCwSbNuhzL9uSYyW6YPiTKXjgfshkobvJWomNDxqaGEERqh4nzqf4F` | 107,544,779 raw NEEGY -> 266,769 lamports SOL; 8,834-lamport tx cost |
| 5 | `METEORA_CLOSE` account close | `EXPIRED_NO_EFFECT` | `56Cyo7ZoHPvo3VzAr5YAgnj2gxu9hmZ7ubzD6BkbNdRJusNar4wgsL5vtAREa4PwuF83Wb4ifPSZg2CtaWEcXdFL` | no RPC status and no transaction; account/rent remain |
| 6 | chain settlement reconciliation | `BLOCKED` | — | `SETTLEMENT_POSITION_STILL_EXISTS` |

The close payload was last recovered at 06:29:53 UTC as
`CLOSE_PENDING_STAGE_EXPIRED_NO_CHAIN_EFFECT`; its journal is `FAILED` with
`confirmationStatus=EXPIRED`.  The RPC re-check independently returned null
for both status and transaction, while the account remained present.  This
proves no account-close economic effect occurred.

## Exact stop point and lifecycle mismatch

**Last successful step:** recovered entry-residual token unwind.

**First incomplete step:** `METEORA_CLOSE` / position-account close.  It was
durably marked submitted at 00:17:59 UTC but was never accepted into chain
history.  Liquidity removal did not fail, terminal fee claim did not fail, and
neither unwind failed.

The DB records `owned_positions.lifecycle_state=OPEN` and
`position_lifecycles.status=OPEN`; there is no SOL settlement.  This is stale
relative to the chain’s empty-account state.  The plan is `FAILED`, not active,
after safe expiry recovery.  Consequently there are no pending plans or
unknown submissions, but there is one incident-specific terminalization debt:
the empty position account must be closed and its rent reconciled before a
trusted settlement can exist.

## Fees, wallet effects, and unsettled economics

Previously confirmed position-attributable interim claims total 1,462,084
lamports across eleven `FEE_CLAIM` cashflows.  The terminal fee snapshot was
zero, so there is no omitted terminal claim in this incident.

The completed close sequence has already persisted 26,773,563 lamports of
unwind proceeds (26,506,794 + 266,769) and 18,834 lamports of close-related
transaction costs (5,000 + 5,000 + 8,834).  Both token inventory lots have
`remaining_raw_amount=0` and `status=SETTLED`.  The only remaining
lifecycle-attributable chain effect is account-close rent recovery of
57,406,080 lamports, which must not be credited until a new account-close
transaction is confirmed.

The lifecycle cannot yet have final realized PnL declared, because the account
close/rent effect and external settlement reconciliation are incomplete.

## Source/runtime path

The existing close state machine is in
`packages/phase6-live-worker/src/index.ts`:

```
CLOSE_INVENTORY_SNAPSHOTTED
  -> METEORA_REMOVE
  -> CLOSE_LIQUIDITY_REMOVED
  -> optional terminal claim
  -> CLOSE_CLAIMS_SETTLED
  -> primary/residual token unwind
  -> buildClosePositionTransaction / METEORA_CLOSE
  -> finalizeClosedPositionSettlement
       requires position account absent
  -> SOL_SETTLED
```

The close child is submitted through `executeMeteoraMutation` around the
`buildClosePositionTransaction` call.  `finalizeClosedPositionSettlement`
returns `SETTLEMENT_POSITION_STILL_EXISTS` while the account exists.  The
recovery handler later recognizes an expired close child with a still-present
PositionV2 and records `P6_CLOSE_PENDING_STAGE_EXPIRED_NO_CHAIN_EFFECT`, but
retires the plan without constructing an account-close-only successor.  That
is the operational gap which left the DB lifecycle `OPEN`.

## Classification and safe recovery plan

**Classification:** `MIXED` — `REMOVE_SUCCEEDED_ACCOUNT_CLOSE_FAILED` +
`EXPIRED_OR_UNKNOWN_CHILD` + a terminalization-recovery gap.

**Smallest safe recovery, not executed:**

1. Perform a fresh read-only PositionV2/account/signature reconciliation.
2. If and only if the account still exists and remains empty with no fees,
   create a *new account-close-only* recovery child with a new idempotency key.
   Do not include remove, claim, or either unwind.
3. Submit that one close child only under the existing protective-close
   authority; confirm account absence and the exact rent receipt.
4. Ingest rent recovery once, run M0067 external chain reconciliation across
   the already-confirmed children, then append the normal `SOL_SETTLED`
   settlement.
5. If the account is absent on the next read, submit no chain transaction;
   reconcile the rent/account-close effect and finalize only after proof.

Until that effect-aware recovery is complete, the slot is **OCCUPIED**.  New
entry authority remains disabled.

## No-change confirmation

This forensic did not alter the current position, submit/retry a transaction,
write the database, change code, restart a service, alter P7/OOR/global
selection, or enable entries.
