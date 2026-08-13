# LPForge Phase 2 Open Decision Register

These are deliberately not hidden constants in live trading logic. Phase 2 supports research while leaving deployment policy open.

| ID | Decision | Needed by | Current Phase 2 handling |
|---|---|---|---|
| P2-OD-01 | Primary production numeraire: SOL, USD, or dual mandate | Before opportunity engine | Accounting supports SOL/USD; no production default |
| P2-OD-02 | Authoritative external reference-price provider(s) | Before divergence hard gate in live decisions | Adapter boundary only; fixture/manual values allowed |
| P2-OD-03 | Initial live pool universe: SOL pairs only vs broader | Before Phase 3 universe scanner | Phase 2 lab is pair-agnostic |
| P2-OD-04 | Token-risk provider and concentration source | Before live pool eligibility | Meteora Data API fields supported; external risk remains adapter-bound |
| P2-OD-05 | Research-policy thresholds accepted/replaced | Before shadow opportunity decisions | `research-pool-policy-v1` explicitly RESEARCH_ONLY |
| P2-OD-06 | Counterfactual capital size and market-impact assumption | Before comparative range studies | Synthetic replay assumes small LP that does not change observed price path |
| P2-OD-07 | Exact hypothetical deposit construction method | Before RangeForge validation | Phase 2 accepts explicit synthetic shares; Phase 3 should use SDK quote/simulation to generate exact candidate inputs |
| P2-OD-08 | Fee attribution promotion standard | Before claiming high-fidelity hypothetical fee PnL | `EVENT_PATH_ESTIMATE` cannot be promoted as exact |
| P2-OD-09 | Minimum historical coverage per pool | Before pool-ranking research | No live-trading gate yet |
| P2-OD-10 | Reward valuation policy | Before reward-sensitive strategy | Rewards excluded from baseline unless explicitly observed/valued |
