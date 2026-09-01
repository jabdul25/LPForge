# LPForge approved historical settlement append-only repair v1

UTC execution: 2026-08-31.  Source utility commit: `42a0e08b726acbd0ff3a1c2fced0e84a16337b75`.  Runtime services remained on `9863742e7c39ab78c6466729b425236c14d1cc0c`; no service restart, migration, policy, execution, or live-position action occurred.

## Scope and preflight

The repair tool has a fixed three-position allowlist and requires both `--execute` and `LPFORGE_APPROVED_HISTORICAL_REPAIR_EXECUTE=YES`. It has no dynamic `SOL_SETTLED` selector. The release artifact passed integrity verification and canonical CI passed 915 tests. At preflight and post-repair there were zero active positions and zero reconciliation-debt positions.

The following preconditions were re-read immediately before each independent serializable transaction: lifecycle was `SOL_SETTLED`, only immutable v1 existed, v1 net exactly matched approval, no equivalent signature/effect cashflow existed, PositionV2 was absent on finalized chain state, and all receipt effects exactly matched the approved lamport values.

## Repairs

| Position | v1 net | Append-only effects | v2 net | Chain reconciliation |
|---|---:|---|---:|---|
| BhhRQ4mwtvPcXzzGEskSqwY6D9NPhjNgpsganNsigpEx | +144,797 | `FEE_CLAIM` +175,671; `5jtTtZP9HzBSsd3La29ZirqbcKmjwCztgmPADJb7ktTH7WKsfb54ifbYnd9N7dKXN1reLCfG24HfQif3pyhQpnZg` | +320,468 | `RECONCILED_CHAIN` |
| DrbJXWwg45Gjqqy9LGDN2KTZ338PGQyRLGVusvwSMK7w | -446,018 | `FEE_CLAIM` +39,798; `3brMxdZ2zksduEBJmHkW7k4fiK8VrzBUcLxKc9Zgx6hToboLitASXwqYu4HJ8dGckbUZbfFK6VH` | -406,220 | `RECONCILED_CHAIN` |
| F3V7UHyrQUSWzukbjNSvs41VEGZPvhxBjCPwMgz9ue1k | -84,687,407 | `FEE_CLAIM` +28,153; `FEE_CLAIM` +175; `CLOSE_WITHDRAWAL` +27,137,177; `RENT_RECOVERY` +57,406,080 | -115,822 | `RECONCILED_CHAIN` |

F3 receipt signatures, respectively: `5fyP6AhhgjE9Do7PJwxsaDgzi7jpwKbeZYkZbFHyprTQUKyA4MAa7T3Hkc4zPDny428SzPcT6iAbws34xytSwP7w`, `tJqfnkAw1jGozrnHqKzZWMikXs1hTbeLaKhtR8bQhVB6gafbUfNhV9FrKU3yqxYRjC4MJY1REaZPtYvDWME5giF`, `4UwroFFUK6XsxRyd9CC9e5BiD2RHr8Adf4HZvQ2BzD6rjBqnaXgC829u4qhrfCABVofeVJyQy4ayer1jEu2RLHvo`, and `TcGiETe6uTDfqzc39K6PcipoXLd5Yx5ziYtLDFhH5p5iLbxTZ3qGSvENaUSxj2SoSTgZ5RjzZFdWGzit76fbuJG`.

Each appended cashflow carries signature/effect/lifecycle idempotency identity, source `HISTORICAL_CHAIN_RECONCILIATION_CORRECTION`, chain slot/timestamp, and implementation provenance. Original v1 records were not updated or deleted.

## Non-target proof

No mutation occurred for HVEbGMQx9xW1yDmo9zgpzNyFQXt6W4YqR3uPTxbNNZtp (v2, -1,925,242), 8HU47vhj6ciFv7nhHsby4iQD68s8NpBKSNZbb9C81Pzw (v2, +1,387,553), GRyrKY587t96v6C3Non7i4SfVKwAFh9ToyoBybeJhqC2 (v3, -313,759), or 8G992HY1y4YBGxcHkL9DNXVKLAp7xk1AnD5ae9DwbjsQ (v2, -29,712,167). 8G992 remains `REQUIRES_SEPARATE_ACCOUNTING_DECISION`; it received no cashflow, settlement, or accounting change.

## Updated authoritative scorecard

Latest immutable settlement net lamports: 8G992 -29,712,167; 8HU +1,387,553; Bhh +320,468; Drb -406,220; F3 -115,822; GRyr -313,759; HVE -1,925,242.

Latest persisted total: -30,765,189 lamports. Winners: 2; losers: 5; win rate: 28.57%; mean: -4,395,027; median: -313,759; largest win: +1,387,553; largest loss: -29,712,167; profit factor: approximately 0.0526.

The fully chain-reconstructed historical aggregate remains -1,085,547 lamports. The -29,679,642-lamport difference from latest persisted authority is solely the deliberately unresolved 8G992 representation (including its separate five-lamport entry-basis policy question), not a reason to alter it in this repair.

## Controls and limitations

Forward `terminal-fee-claim-accounting-v1`, `external-settlement-reconciliation-v1`, M0067, and the settled-history recovery guard remain unchanged. The repair utility is explicit operator-only tooling; it cannot run automatically and does not modify trading policy, Candidate-Primary, P3/P4/P7, OOR lifecycle, capital, or live execution state.
