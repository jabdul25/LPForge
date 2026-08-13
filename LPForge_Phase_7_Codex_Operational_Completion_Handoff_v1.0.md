# LPForge P1–P7 Codex Operational Completion Handoff v1.0

## Purpose

Take the supplied frozen LPForge P1–P7 release and complete **VPS operational integration and evidence collection**. Do not redesign the architecture and do not weaken gates to make the system advance.

## Source of truth

- Use the exact source revision in `SOURCE_REVISION.txt` from the release.
- Preserve migrations M0001–M0027 and the existing PostgreSQL data.
- Preserve all P1–P7 boundary scanners and the full regression suite.
- Phase-7 modules must not gain a direct signer or direct transaction-send path.

## Current implementation state

Local implementation evidence is PASS:
- 307/307 tests;
- P1–P7 boundary scanners PASS;
- M0001–M0027 static verification PASS;
- fresh PostgreSQL 17.10 migration runtime PASS;
- real local Meteora OPEN → PositionV2 → SWAP → fee → CLOSE PASS;
- no mainnet transaction sent during local verification.

Operational production promotion is intentionally HOLD.

## Remaining operational work, in order

1. Deploy the frozen P1–P7 release to the VPS as a fresh extraction.
2. Verify the outer archive checksum and embedded release integrity.
3. Run the full 307-test suite and P1–P7 boundaries on the VPS.
4. Apply M0019–M0027 to the existing LPForge PostgreSQL database; do not wipe P1–P6 history.
5. Run mainnet read-only operational cycles with signing/execution/canary flags disabled and verify:
   - real Swap2Evt evidence remains non-zero when pool activity exists;
   - regime history persists across cycles;
   - valuation remains capital-normalized;
   - NO_TRADE remains a real competitor;
   - no lookahead violation;
   - P7 health/drift status can be derived from live evidence.
6. Integrate the P7 control-plane outputs into the long-running operator/daemon process using the existing execution workflow only. P7 may request an existing workflow; it must not implement a second signer/sender.
7. Run the controlled Phase-6 mainnet canary only when the frozen intelligence/risk gates produce a legitimate eligible setup and explicit operator approval exists.
8. Reconcile OPEN exactly to PositionV2 and wallet truth; if state is UNKNOWN, reconcile first and never blind-resubmit.
9. Monitor the canary under HOLD/CLOSE_REVIEW/EMERGENCY_CLOSE only. No autonomous reshape/rebalance/scale.
10. Close and reconcile the canary. Zero unresolved reconciliation debt is mandatory.
11. Repeat the canary programme until the frozen Phase-6 promotion policy is satisfied; do not alter thresholds merely to obtain PASS.
12. Enter Phase-7 limited live only after the P7 promotion evaluator reports eligibility and an explicit expiring operator approval is supplied.
13. Exercise P7 operator pause/resume, incident, rollback, scaling-step, restart/recovery and duplicate-action controls on the VPS.
14. Produce real backup/restore evidence, including measured RPO/RTO, encrypted/offsite backup proof and secret-safe support bundle scan.
15. Collect limited-live evidence until the frozen production-promotion policy is satisfied.
16. Build the final P7 evidence pack and report `PASS`, `HOLD`, or `BLOCK` exactly as the evaluators determine.

## Non-negotiable safety constraints

- Never echo or persist wallet secret material or private RPC credentials in source, logs, evidence packs or support bundles.
- Never set production authority merely because a promotion evaluator reports `ELIGIBLE`.
- Never enable automatic policy promotion.
- Never enable unbounded/autonomous scaling.
- Never bypass reconciliation debt, stale-data, health, drift, drawdown, pool/token or portfolio exposure gates.
- Never change strategy/risk thresholds as a correctness fix. Strategy changes create a new candidate policy and new evidence cohort.
- Never patch inside a verified release extraction. Make a new source commit and release if a correctness change is necessary.

## Failure handling

At the first failing gate:
1. stop progression;
2. preserve evidence;
3. identify root cause;
4. patch only the root cause;
5. add a regression reproducing it;
6. rerun the full suite and all boundaries;
7. continue only after the failed gate passes.

## Definition of done

Operational completion is done only when:
- P7 evidence pack is complete;
- real canary and required limited-live evidence are present;
- zero reconciliation debt;
- disaster recovery PASS;
- promotion evaluator reports production eligible;
- explicit operator promotion approval exists;
- no automatic authority issuance or scaling occurred.
