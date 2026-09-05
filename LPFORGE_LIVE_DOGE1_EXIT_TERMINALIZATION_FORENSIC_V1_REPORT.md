# LPForge DOGE-1 exit / terminalization forensic

Forensic cutoff: 2026-09-04T11:04:16Z (UTC)

Position: `7z3YCFnYGN27nuQQXL58U5Li9qc3PmRSKZyvLNmbEtA4`
Entry plan: `plan-fa11a94c1955baf48a451b66b7c2c11a`
Close plan: `plan-b546cb4096003962b1c4c4e89308de4f`

## Authoritative sequence

The exit workflow removed liquidity, claimed fees, and completed the primary
DOGE-1-to-SOL unwind. Each of those three submitted chain transactions is
finalized with no chain error. The position observer then recorded zero
liquidity and zero unclaimed fees. The Meteora PositionV2 account remains on
chain, so the lifecycle is not yet SOL-settled and its one-position/capital
lock remains correctly held.

No close-position transaction was submitted. The first divergent operation was
an extra `CLOSE_RECOVERED_OPEN_RESIDUAL_UNWIND` Jupiter transaction. Its
preflight simulation failed, leaving no chain signature or effect, and the
workflow therefore never reached the subsequent account-close construction.

## Root cause and repair

A normal, fully reconciled funded OPEN was incorrectly persisted as
`OPEN_RECOVERED`. That state is exclusively meaningful for interrupted partial
opens. During CLOSE settlement it was treated as proof of a separate old token
residual, causing the unsupported extra unwind above.

`166d9f3dcfd3f90e9b3a67f55422f630647b3148` makes the distinction explicit:

- normal reconciled funded opens no longer create a partial-entry recovery row;
- a close only consumes `OPEN_RECOVERED` inventory when its durable payload
  proves `partialEntry: true`;
- the execution daemon keeps running after a transient recovery-RPC startup
  exception and retries fail-closed rather than terminating.

The actual partial-entry recovery path remains unchanged. No liquidity,
capital, position-count, signing, or entry policy was changed.

Focused close-settlement tests: 16/16 pass. Full canonical CI: 891/891 pass.
The immutable execution artifact was deployed at the same source revision.

## Current blocker at cutoff

The configured execution RPC is returning `429 Too Many Requests: max usage
reached`. The repaired daemon is online and retrying, but it cannot safely send
the genuine Meteora account-close transaction until that configured write RPC
serves requests again. No manual close, state deletion, active-position-lock
bypass, or settlement assertion was performed.

Once RPC availability returns, recovery resumes from the durable
`CLOSE_INVENTORY_UNWOUND` stage. It skips the false residual branch, attempts
only the next account-close transaction, then runs the normal reconciliation
and SOL-settlement path.
