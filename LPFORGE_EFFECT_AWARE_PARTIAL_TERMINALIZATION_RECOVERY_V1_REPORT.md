# LPForge effect-aware partial terminalization recovery v1

Status: COMPLETE.

## Incident and chain truth

- Position: `BcHk2btyymBVz8W5Yk2pMhCpz23ZvAV8k2MzvUgqL2J1`
- Pool: `EsR3gRxMtqt3bBhDDsuY3SFyYNYvYzszzG9KVYpcQfs7`
- Original failed close child: `POSITION_ACCOUNT_CLOSE`, signature `56Cyo7ZoHPvo3VzAr5YAgnj2gxu9hmZ7ubzD6BkbNdRJusNar4wgsL5vtAREa4PwuF83Wb4ifPSZg2CtaWEcXdFL`, `EXPIRED_NO_EFFECT`.
- Fresh SDK chain read at 2026-09-01T07:13:52.807Z: account present; X/Y liquidity, fees, and rewards all zero.
- Confirmed earlier remove and both token unwinds were not replayed. No terminal claim was required.

## Implemented source work

The source commits are:

- `88c97bb083620df4eb04c697e7f2d038d265e246` — isolated account-close-only recovery.
- `1465d798ae5b550ab438ff869d87105c478df675`, `cedda6eeb48c1f8767b7e3a33758fead9d09683c`, `4be169ffc18f0c9abfe8d9c66aa35925c5ce510f` — successor idempotency, duplicate suppression, and queue dispatch.
- `456ef11cd82ebbf3576255ca98f8e54977f42e99` — authenticated provenance for recovery-created plans.

The code implements per-action effect states, an isolated `ACCOUNT_CLOSE_ONLY` child, a fresh pre-submit PositionV2 read, account-absence settlement gating, and `TERMINALIZATION_DEBT` lifecycle visibility. Focused recovery/settlement tests passed; canonical CI passed for `4be169f`. The final provenance commit has passed typecheck/build and the focused account-close suite but still requires canonical CI and a new immutable artifact before deployment.

## Deployment / live safety

Release `4be169f` was deployed to the execution worker and normalized duplicate unsubmitted successor records. It then exposed a claim-guard provenance omission before any transaction could be signed or sent. The worker was stopped immediately. There is no new account-close signature and no duplicate REMOVE, CLAIM, PRIMARY_UNWIND, or RESIDUAL_UNWIND signature.

Current lifecycle remains `RECONCILIATION_REQUIRED` with `TERMINALIZATION_DEBT`; the position slot remains occupied. New-entry authority has not been enabled. The global selector and trading policy were not changed.

## Completed authenticated recovery

Canonical CI passed and immutable release `456ef11cd82ebbf3576255ca98f8e54977f42e99` was deployed. The single authenticated close-only successor was `plan-56116daf25db4ec3ad1cd6904483825b:account-close-only:14`; it submitted `4265geeSTn7XMFvv671AgsPva3ozxCRSxS1ay2AqWajfhKiVkED6wGum4eu9mQ4pusMLPFr1Th43Nt24PnB3MQER`.

The account is absent. External settlement reconciliation is `RECONCILED_CHAIN` with zero difference: chain and DB net are both `84,155,809` total net-flow lamports. Lifecycle state is `SOL_SETTLED`; active positions and pending plans are zero. Actual rent recovered is `57,406,080` lamports; final realized PnL is `-1,853,187` lamports.

No manual DB settlement, liquidity removal, fee claim, or token unwind is authorized or required.
