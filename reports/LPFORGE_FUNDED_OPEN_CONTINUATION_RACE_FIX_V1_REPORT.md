# LPForge Funded-Open Continuation Race Fix V1

## Provenance

- Starting source SHA: `4be811e036104bae443b0327c80b7211a900dec0`
- Implementation SHA: `d8c6ce6ade31b18dcb3e2ca453aa54bf2af78fa3`
- Starting P6 release: `4be811e036104bae443b0327c80b7211a900dec0`
- Starting P7 release: `1cae7410980cf7d960a3ba08f2fe0facb80e128a`
- Starting policy hash: `9b0955dfd76ad876e48da85f9ea1d796f8bc2917d501f37e56d67d0b3269c135`
- Migration head: `M0079_shared_data_api_coordinator.sql`
- Migration: none. Existing journal state and payloads are sufficient.

## Root cause

The historical `plan-44866fbe9d3ce4048ac010af17bf2a44` sequence proved a P6/P7 classification race. Once funding was canonically confirmed, P7 correctly disabled *new* entries because the plan was funded but not yet open. P6 then incorrectly applied that global new-entry veto, including portfolio-cleanliness gates, to the same plan's LP-open child. The result was token inventory exposure followed by an unnecessary delayed unwind.

`ENTRY_FUNDED_NOT_OPEN` is not itself a recovery incident: 34 historical funding-to-open paths completed, with a p50 of 3.342 seconds, p75 4.394 seconds, p90 9.2422 seconds, p95 10.83175 seconds, p99 38.55998 seconds, and maximum 51.428 seconds. The implementation therefore uses a 60-second deadline measured from canonical funding confirmation: it covers the observed healthy maximum with a small margin while preventing multi-minute generic recovery exposure.

## State machine and authority

The payload-backed `FUNDED_OPEN_CONTINUATION` semantic state is identity-bound to the original plan, owner, pool, token mint, capital, funding signature, range, funded timestamp, expiry, and generated position when known.

```text
ENTRY_AUTHORIZED → FUNDING_CONFIRMED → FUNDED_OPEN_CONTINUATION
                                         ├─ exact fresh/simulated LP open → OPEN
                                         └─ deadline/unsafe condition → exact existing UNWIND_REQUIRED path
```

P7 now emits a narrow `fundedOpenContinuations` control fact. Global `newEconomicActionAllowed` remains false while the funded entry is unresolved, so every unrelated entry continues to fail closed. P6 may continue only the matching funded plan after exact identity validation, fresh control/risk/simulation checks, and before the deadline. It cannot repeat funding, change range, change pool, increase capital, or authorize another plan.

After the deadline, the recovery worker transitions straight to the existing exact unwind path. Before unwind it reconciles the exact generated position; an existing matching position is held for reconciliation rather than unwound. Unknown submissions still never receive a blind resend. Per-plan PostgreSQL advisory locking serializes continuation recovery so open and unwind cannot claim the same plan concurrently.

## P7/P6 and terminal changes

- P7 separates global new-entry permission from same-plan funded-open continuation permission.
- P6 classifies the post-funding LP-open child as a continuation, not a new entry. All normal fresh simulation, market/range, RPC, owner, and protocol checks remain in force.
- The continuation deadline is policy-backed as `fundedOpenContinuation.deadlineSeconds: 60`; missing or invalid policy fails closed.
- Recovery facts distinguish provisional confirmed funding from generic actionable recovery debt. A provisional continuation still blocks unrelated new entries, but does not self-veto its matching LP open.
- The shell terminal now derives RECOVERY from P7-equivalent actionable recovery semantics instead of raw historical journal rows. Historical/reconciled rows are neither changed nor deleted.

## Historical replay and economic safety

For `plan-448…2a44`, the new state machine removes the self-blocking veto: confirmed funding would retain global entry blocking while the exact LP-open child is permitted under continuation authority. The replay does not claim that a historical LP open would have succeeded with then-current market facts. Where a safe open cannot be proven, the new bounded path reaches the existing unwind lane from the funding-confirmation deadline rather than waiting in generic recovery.

The forensic cohort had seven true failed/unwound funding entries, funded with `0.089711870 SOL`, returning `0.067270928 SOL`, with `0.000401065 SOL` transaction fees and `0.022842007 SOL` total economic loss. The fix targets time at risk; it makes no unsupported claim of hypothetical SOL savings.

## Validation

- Typecheck: pass.
- Build: pass.
- Focused continuation/recovery/P6/P7 tests: 51 passed.
- Full CI: pass — 1,207 passed, 0 failed, 1 intentionally skipped (1,208 total).
- PostgreSQL concurrency proof: pass; exactly one of two independent clients acquired the same continuation advisory lock, then the released lock was acquirable.
- Immutable release build/integrity: pass — 1,113 checksummed files, build identity `1e2da7126faf2d2e81c23d1c3dd1f595e0bd796ae97cb8c2b8360d4b13b4e015`, policy hash `c3e3af0ac1bdc1370efedba87bfa3e5f8027933a2a16ad78b284e8f9bc37e95f`, migration head unchanged at `M0079_shared_data_api_coordinator.sql`.

The focused tests cover exact identity matching, global blocking of a different plan, continuation-before-deadline, expiry, unchanged generic entry guards, no funding resend route, recovery lock behavior, and the terminal's actionable recovery query. Existing partial-entry, P6 lifecycle, and P7 recovery tests remain green.

## Performance and non-regression

No schema migration, polling loop, market feed, browser process, or additional RPC loop was added. Continuation uses the existing P6/P7 cycles and bounded plan/position reads. The only new database coordination is a plan-specific advisory lock held by the recovery worker. Production source delta is approximately 243 insertions and 38 deletions; focused test/infrastructure delta is 80 lines.

No changes were made to entry strategy selection, P3/P4, max positions, same-pool singleton, P6 signing/submission semantics, P7 safety policy other than the exact continuation authority, TS-5, OOR-P4, settlement, accounting, Telegram, or Discovery. The terminal remains read-only.

## Deployment and first-live validation

The immutable release artifact passed all release gates and is ready for production installation. No synthetic economic entry is created; the first normal funded entry must end in either an exact LP open or a bounded attributable unwind, with no repeated funding. Final activation provenance is recorded after the release is installed.

## Follow-up absence-proof correction

The first post-release funded-open recovery exposed a narrow distinction in the
Meteora SDK: it throws when a generated PositionV2 account is absent, just as
it does for a transport/decode failure. Recovery must not classify a proven
absent account as an RPC outage, because that would keep already-funded token
inventory in a HOLD indefinitely.

Recovery now first performs a governed `getAccountInfo` read for the exact
generated position. `null` proves absence and permits the already-bound
deadline/unwind state machine to proceed. RPC-read failure, SDK-decode failure
for an existing account, and owner/pool mismatch continue to HOLD fail-closed.
The correction adds no funding path, no new strategy decision, and no
unbounded probing. Focused regression tests cover absent, unavailable,
mismatched, and matching position-account outcomes.
