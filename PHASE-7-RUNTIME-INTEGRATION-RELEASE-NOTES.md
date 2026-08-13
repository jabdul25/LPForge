# LPForge Phase 7 Runtime Integration Release Notes

This release closes the production-runtime integration gap discovered during the first VPS review of the frozen P1–P7 v1.0 artifact.

## Added

- executable `apps/production` control-plane service;
- `production:once`, `production:start`, `production:status`, `production:evidence` and `production:register-release-evidence` commands;
- production composition across lease/recovery, read-only operator, health, drift, incidents/control and evidence;
- M0028 Phase-7 runtime integration persistence;
- persisted health assessments, incident states, control decisions and evidence snapshots;
- live RPC/Data API/PostgreSQL/decision/execution/portfolio/reconciliation SLO probes;
- live drift inputs from persisted operational evidence and decoder telemetry;
- atomic PostgreSQL runtime lease ownership;
- recovery-first restart behavior and duplicate cycle suppression;
- fail-closed operator-failure persistence;
- hash/source-bound runtime-release evidence registration.

## Safety invariants

The production control plane has no direct signer or transaction-send path. Its child operator is forced to recommendation-only/read-only settings and has public execution addresses removed from its environment. Runtime integration does not alter pool/regime/range/economic/risk/capital policy and does not turn NO_TRADE into a trade.

Operational production promotion remains HOLD until real mainnet canary, limited-live and disaster-recovery evidence satisfy the existing P6/P7 promotion gates and an explicit operator authority envelope is supplied.
