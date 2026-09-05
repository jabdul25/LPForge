# LPForge 54sby Unknown Submission Reconciliation and P7 Hold Visibility V1

Status: FULLY_RESOLVED

Plan: `plan-ef19412a3d9620ad105dfc6b600163fd`  
Pool: `54sbyULrreD9HBoV5wRWedeCBEw6gQ7VkdHW18rLX78e`

## Chain truth

The only submitted child was step 1, the serial Jupiter funding transaction
`tx-1-2d1e5c5c370f5abe74beeca5ccd3db2d-ef19412a3d9620ad105dfc6b600163fd`,
with signature `2i3tc6qudjahBM7waKEor9WBYkdsFNu4RkCMjPg37EWYSXoStXE5ciabZix4AcsarNzK9Q6MxEtKLe9syGfoUy7s`
and last-valid block height `422303115`. Both approved RPC reads returned no
signature status and no finalized transaction after expiry. Steps 2--4
(position extension and two open-liquidity chunks) remained planned and were
never submitted. No position address was created, no plan cashflow or
partial-entry recovery exists, and the capital reservation was already
released.

Final effect classification: **NO_CHAIN_EFFECT**. The canonical result is now
persisted as reconciliation `plan-ef19412a3d9620ad105dfc6b600163fd:open-no-effect`,
status `MATCH`, chain effect `NONE`; the plan is `EXPIRED`.

## Root causes and repair

The execution journal was marked `FAILED` without the submitted signature,
although the durable submission-attempt ledger retained it. Recovery only read
the journal/pending-close signature and therefore could not query the known
transaction. It also treated every OPEN with a funding child as ineligible for
no-effect terminalization, even where the sole first serial funding child was
proven absent and all later liquidity steps were still planned.

Recovery now falls back to the exact durable attempt by transaction ID, uses
the resulting signature and block-height lifetime for chain status, permits
only this narrowly proven first-child-no-effect case, records a MATCH
reconciliation, and then terminalizes/releases the stale plan. It never
resubmits a transaction.

P7 recovery facts now include `RECONCILIATION_REQUIRED` parent plans even when
their journal is terminalized. During the unresolved incident the new producer
emitted `P7_DAEMON_RECOVERY_QUEUE_PENDING` with daemon health healthy but
`newEconomicActionAllowed=false`. After recovery queue count reached zero, P7
naturally returned to `HEALTHY / PRODUCTION` with authority enabled.

An adjacent deployment defect was also repaired: PM2 `restart` retained the
old immutable release cwd. The release helper now replaces the named process
registrations before starting them, so the installed immutable release is the
actual runtime.

## Validation

- Source after: `2645f1973a14ef7e0da35e389a77a5c2c79d563d`
- Focused tests: 45/45 pass.
- Full CI: 991/991 pass.
- Boundary and migration checks: pass.
- Production and execution runtime cwd: release `2645f1973a14ef7e0da35e389a77a5c2c79d563d`.
- Post-recovery queue: 0; unknown submission attempts: 0.
- Execution runner: `AWAITING_AUTONOMOUS_DECISION`, meaning recovery has
  cleared and it is eligible to claim the next fresh canonical plan.
- Four consecutive post-recovery P7 decisions remained `HEALTHY / PRODUCTION`
  with `newEconomicActionAllowed=true`.

No fresh P4 winner occurred during this recovery validation interval, so no
new plan or position was forced or fabricated.
