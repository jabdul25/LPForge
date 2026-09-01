# LPForge Global Selector Live Validation Observation V1

## Scope

Read-only observation of production selector release
`b7b8903daea7d85eaf3048d84a17b5d297dc7884`, through 2026-08-31 23:41:37
UTC. M0069 is applied. Entry dispatch remained disabled throughout; no source,
policy, migration, service, plan, transaction, accounting record, or lifecycle
was changed.

The open position `BcHk2…L2J1` in EsR3 remained `OPEN` and was not altered.

## Observation window and cycle statistics

Only 20 completed cycles exist for the deployed evidence-contract release, so
the requested 100-cycle window is not yet available.

| Metric | Result |
|---|---:|
| Completed cycles | 20 |
| Global winners | 11 |
| GLOBAL_NO_TRADE | 9 |
| Coverage incomplete | 1 (5.0%) |
| Complete coverage | 19 (95.0%) |
| Mean duration | 63.013 s |
| Median duration | 55.567 s |
| p95 duration | 88.034 s |
| Maximum duration | 120.068 s |
| Concurrency | 2 |

The sole incomplete cycle reached the 120-second deadline and also recorded a
quarantined Meteora transaction fetch. It failed closed; it did not select a
pool.

## Candidate availability

| Candidate-pool count | Cycles |
|---|---:|
| Zero | 9 |
| One | 10 |
| Two or more | 1 |

Canonical non-candidate states were persisted, rather than represented as
missing rows: the completed cycles contain mixtures of `WARMING` and
`NO_TRADE`. The nine no-trade decisions were all `GLOBAL_NO_VALID_POOL_CANDIDATE`;
one also had `GLOBAL_COVERAGE_INCOMPLETE`.

## Multi-candidate competition

Exactly one cycle supplied genuine competition:

- Cycle: `production-global:…:1788218573758`
- Completed: 2026-08-31 23:24:10 UTC
- Coverage: complete; 7 pools evaluated; 2 valid pool candidates.

| Rank | Pool | Strategy / orientation | Range | Risk-adjusted expected net EV | Predicted fees | Predicted inventory PnL |
|---:|---|---|---|---:|---:|---:|
| 1 | ErwEeF…vfdw | CURVE / SKEWED_Y | -1686..-1610 | +0.0003637009 SOL | +0.0004071449 SOL | -0.0000378769 SOL |
| 2 | EsR3gR…Qfs7 | CURVE / ONE_SIDED_Y | -656..-594 | +0.0000114181 SOL | +0.0000285769 SOL | -0.0000023045 SOL |

ErwEe won because its canonical comparable risk-adjusted expected net EV was
approximately 31.9 times EsR3's. Both used the same 0.03-SOL / 60-minute basis.
This is direct evidence that the global selector can choose a non-EsR3 pool
when two valid candidates coexist.

## Same-pool recurrence

EsR3 was the sole valid candidate in ten winner cycles, not a proven global
winner in those cycles. Each recorded bounded live pool context before
selection: five same-day settled lifecycles, four losses, cumulative realized
net of -2,159,341 lamports, one below-range close, one token-risk close, and
the latest authoritative 8G992 settlement. The historical HVE lifecycle is in
the same persisted source-lifecycle list.

Thus pool history is visible and provenance-rich, but this sample does **not**
yet prove that repeated EsR3 candidates are regularly tested against another
valid candidate. There was no actual re-entry because dispatch is disabled.

## Capacity and safety

Concurrency two completed all eligible pools in 19 of 20 cycles. The p95 is
below the 120-second deadline. Capacity is not the main limitation in this
sample; candidate maturity and local no-trade outcomes are. The one deadline
miss is observable and safely produced no trade.

No transaction was submitted and no capital was allocated. The runtime selector
uses global-pool-selection-v1 and the entry gate remains disabled.

## Finding and recommendation

The selector behaves as designed for the observed multi-candidate cycle, and
canonical state preservation works. It is too early to certify repeated-pool
selection quality: only one multi-candidate cycle exists. Keep entry authority
disabled and collect a larger read-only cohort with repeated multi-candidate
cycles before considering any promotion. No implementation change is recommended
from this observation alone.
