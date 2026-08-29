> **Project:** LPForge  
> **Suite Version:** 1.0  
> **Design Baseline Date:** 12 August 2026  
> **Status:** Build-guiding baseline  
> **Scope:** Meteora DLMM liquidity intelligence, decisioning, simulation, execution and operations  
> **Principle:** Protocol truth is observed; trading intelligence is inferred; execution is deterministic.  


# LPForge Master Index and Design Governance

## 1. Purpose

LPForge is a clean-sheet, bin-native intelligence and execution system for Meteora DLMM liquidity provision. The system is not designed as a conventional “signal bot” that finds a token, chooses a range and opens a position. It is designed as a controlled decision system that continuously answers five questions:

1. **Should capital be deployed into this pool at all?**
2. **Why is now an acceptable time to deploy it?**
3. **What DLMM structure and bin distribution best expresses the thesis?**
4. **Does the thesis remain valid after entry?**
5. **Did the position create value after fees, inventory conversion, execution cost and risk?**

The suite is the authoritative design basis for implementation. If code and these documents disagree, either the code is wrong or the relevant document must be deliberately versioned and amended.

## 2. Document Suite

| # | Document | Primary Question |
|---|---|---|
| 00 | Master Index and Governance | What is authoritative and how does the suite change? |
| 01 | Product Vision and Trading Thesis | What economic problem is LPForge solving? |
| 02 | Meteora DLMM Protocol Domain Model | What does Meteora actually do on-chain? |
| 03 | Technical Architecture and System Design | What services, boundaries and data flows do we build? |
| 04 | Data Model and ERD | What canonical records and relationships exist? |
| 05 | Market Data, Indexing and Feature Spine | What facts are collected and how are they normalized? |
| 06 | Pool and Token Intelligence | Is the pool structurally suitable for LP capital? |
| 07 | Regime and Structure Intelligence | What market state are we operating in? |
| 08 | Opportunity, Entry and Thesis Engine | Is there a positive-EV deployable opportunity now? |
| 09 | RangeForge Range and Capital Engine | Which bins, shape, side and capital distribution should be used? |
| 10 | Position Management and Exit Intelligence | What should happen after entry? |
| 11 | Risk Governor and Capital Protection | What can never be overridden by strategy? |
| 12 | Execution, Wallet and Reconciliation | How are approved actions safely translated on-chain? |
| 13 | Forensics, Replay, Simulation and Learning | How is evidence converted into better policies without overfitting? |
| 14 | Observability, Operations and Security | How is the system operated and audited? |
| 15 | Test, Validation and Promotion Standard | What evidence is required before live capital? |
| 16 | Detailed Development Handoff | In what order should Codex/developers build it? |
| 17 | Official Meteora Source Register | Which current Meteora sources underpin protocol assumptions? |

## 3. Authority Order

When sources conflict, use the following precedence:

1. Current Meteora on-chain program state and IDL.
2. Current official Meteora developer documentation and changelog.
3. Current official Meteora SDK behavior.
4. Meteora Data API.
5. External market/risk providers.
6. LPForge derived features.
7. LPForge model inference.
8. Human assumptions.

A model output must never silently override protocol truth.

## 4. Non-Negotiable Architecture Rules

### 4.1 Clean domain
LPForge must not depend on any pre-existing trading-bot repository to function. Historical systems may provide research data through explicit import adapters, but no legacy runtime is a production dependency.

### 4.2 Evidence before action
Every `ENTER`, `REBALANCE`, `RESHAPE`, `REDUCE`, or `CLOSE` decision must preserve:
- exact input snapshot references;
- policy version;
- feature version;
- reason codes;
- confidence/uncertainty;
- expected economics;
- risk decision;
- range plan;
- execution plan.

### 4.3 No hidden mutable strategy constants
All thresholds, coefficients, allowed strategy families, horizons and risk limits live in versioned policy documents/configuration.

### 4.4 `NO_TRADE` is a successful output
The system is not required to remain invested. Capital preservation is a valid strategy state.

### 4.5 On-chain reconciliation wins
If database state disagrees with confirmed on-chain state, the position is placed into `RECONCILIATION_REQUIRED` and new discretionary actions stop until reconciled.

### 4.6 Research cannot mutate production
Research processes may propose policy versions. They may not publish a new production policy without the promotion workflow in Document 15.

## 5. Canonical Terminology

**Protocol fact** — directly observed from Solana/Meteora state or an official indexed endpoint.

**Derived feature** — deterministic calculation from protocol/external facts.

**Assessment** — intelligence-engine interpretation of features.

**Thesis** — machine-readable explanation of why capital should be deployed and what would invalidate that decision.

**Plan** — desired position state before execution.

**Policy** — versioned set of decision rules, model versions and constraints.

**Episode** — complete lifecycle of one considered opportunity or position.

**Numeraire** — asset in which strategy value is primarily evaluated. LPForge v1 must support `SOL`, `USD`, and token units; deployment policy chooses the primary numeraire.

## 6. Change Control

Every material change requires:
- document version;
- policy/config version if applicable;
- migration note;
- test delta;
- replay/backtest delta;
- shadow/paper delta when trading behavior changes;
- explicit promotion decision.

No strategy-changing patch should be described only as “tuning.”

## 7. Required Repository Mapping

Each implemented module must contain a comment or README pointer to the governing document section. The root repository must expose `docs/traceability.yaml` mapping:

```yaml
requirements:
  LPF-RISK-001:
    document: 11_LPForge_Risk_Governor_and_Capital_Protection_v1.0.md
    tests:
      - tests/risk/test_hard_blocks.*
    implementation:
      - packages/risk/src/governor.*
```

This turns the suite into an executable engineering contract rather than static prose.
