> **Project:** LPForge  
> **Suite Version:** 1.0  
> **Design Baseline Date:** 12 August 2026  
> **Status:** Build-guiding baseline  
> **Scope:** Meteora DLMM liquidity intelligence, decisioning, simulation, execution and operations  
> **Principle:** Protocol truth is observed; trading intelligence is inferred; execution is deterministic.  


# LPForge Observability, Operations and Security

## 1. Operational Goal

An autonomous liquidity system must be more observable than a manual trading terminal.

## 2. Health Domains

### Protocol ingestion
- websocket connected;
- latest slot;
- slot lag;
- event gap;
- decoder errors.

### Meteora API
- latency;
- rate-limit usage;
- schema errors;
- freshness.

### Database
- connections;
- replication/backup;
- slow queries;
- partition growth;
- disk.

### Decision
- candidates/min;
- blockers;
- policy version;
- stale-data suppressions;
- engine latency.

### Execution
- simulations;
- sends;
- confirmations;
- failures;
- CU;
- priority fees;
- reconciliation mismatches.

### Portfolio
- deployed capital;
- token exposure;
- fees;
- inventory loss;
- drawdown;
- OOR positions;
- risk-budget consumption.

## 3. Structured Logs

Every log line carries:
- trace ID;
- decision/plan/position ID when relevant;
- pool;
- policy version;
- component;
- severity;
- reason code.

Never log secrets.

## 4. Decision Trace

Operator UI/API should render:

```text
Pool facts
→ derived features
→ pool assessment
→ regime assessment
→ opportunity economics
→ range alternatives
→ risk decision
→ execution
→ reconciliation
```

A developer should not need to read raw logs to understand why the system traded.

## 5. Alerts

High priority:
- signer activity while kill switch active;
- reconciliation mismatch;
- protocol compatibility mismatch;
- open position with stale on-chain data;
- token/liquidity emergency;
- daily loss breaker;
- repeated transaction failure.

Medium:
- API degradation;
- event lag;
- feature drift;
- high OOR count;
- low disk.

## 6. Backups

PostgreSQL:
- regular logical/physical backup;
- point-in-time recovery where available;
- restore test.

Policies/docs:
- Git version control.

Large replay data:
- content-addressed archive with hashes.

## 7. Secret Management

- secrets outside repository;
- least-privilege environment;
- signer secret readable only by signer process;
- API tokens separately scoped;
- rotation procedure;
- no secrets in crash dumps/support bundles.

## 8. Network

- operator API private/VPN or authenticated reverse proxy;
- database not public;
- signer not internet-addressable;
- outbound destinations controlled where practical.

## 9. Operator Controls

Required:
- pause entries;
- pause all writes;
- per-pool/token block;
- force policy rollback;
- acknowledge reconciliation;
- manually request a close through the same Risk/Execution workflow.

Manual actions must be audited; they do not bypass accounting.

## 10. Runbooks

Create:
- RPC outage;
- Meteora API outage;
- protocol upgrade;
- failed open;
- failed rebalance;
- stuck position;
- reconciliation mismatch;
- suspected compromised wallet;
- liquidity rug;
- database restore;
- policy rollback.

## 11. Dashboard Metrics That Matter

Do not lead with win rate.

Lead with:
- net SOL-equivalent;
- HODL-relative;
- fee/inventory-loss ratio;
- range survival;
- calibration;
- drawdown;
- execution drift;
- data health.

## 12. Security Acceptance

Before live signing:
- dependency audit;
- secret scan;
- no arbitrary transaction endpoint;
- signer intent allowlist;
- wallet cap;
- kill switch test;
- restore/reconciliation drill.
