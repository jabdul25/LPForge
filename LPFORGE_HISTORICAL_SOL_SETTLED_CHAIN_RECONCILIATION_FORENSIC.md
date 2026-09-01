# LPForge historical SOL_SETTLED chain-reconciliation forensic

## Executive conclusion

This is a read-only audit at **2026-08-31 19:43 UTC**.  The cohort contains
seven settled lifecycles, all now reconstructable under LPForge's existing
`gross-sol-instruction-flows-v1` scope.  Three have a latest immutable
settlement version that matches chain evidence; three have an exact,
append-only repair path; and one has an exact five-lamport entry-basis
rounding difference requiring a separate accounting decision. No repair was
executed.

The historical issue is broader than one terminal-fee bug:

- `BhhRQ...gpEx` and `DrbJX...MK7w` each omit an exact confirmed native
  terminal fee claim.
- `F3V7UH...ue1k` omits two fee receipts, the native removal receipt, and
  PositionV2 rent recovery.
- `8G992...bjsQ` omits the native component of its confirmed remove receipt.
- `HVEbGM...NZtp`, `8HU47...1Pzw`, and `GRyrKY...hqC2` have correct latest
  immutable settlement versions.  Their earlier versions remain preserved.

The direct wallet chain deltas include one-off associated-token-account rent in
some older opens.  LPForge's established settlement scope excludes that
wallet-infrastructure rent unless it is lifecycle-attributable and recovered;
the reconstructed values below preserve that scope rather than changing it.

## Method and scope

For every lifecycle the audit read:

1. immutable lifecycle, plan, step, submission, confirmation, and cashflow
   records;
2. `getTransaction` metadata for each confirmed entry, management, remove,
   claim, unwind, retry, and account-close signature;
3. owner SOL/WSOL/token deltas, transaction fees, position-account rent
   balance transitions, and token-balance transitions; and
4. each immutable settlement version.

For native receipts, gross economic receipt is owner native balance delta plus
the transaction fee.  For transaction cost it is the actual meta fee.  A
receipt with no landed effect is excluded.  Rent is included only when the
same lifecycle has both the attributable PositionV2 rent lock and a confirmed
position-account close recovery.  This is independent of the old internal
cashflow-only settlement assessment.

## Cohort and lifecycle results

| Position | Pool / strategy | Entry / terminal UTC | Immutable versions (lamports) | Chain-reconstructed net | Difference from latest | Classification | Repair eligibility |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| `8HU47...1Pzw` | `8Csg...cFDp`, BID_ASK / BALANCED | 2026-08-29 00:10 / 06:00 | v1 `18,854,060`; v2 `1,387,553` | `1,387,553` | `0` | ALREADY_CORRECT | none |
| `F3V7UH...ue1k` | `EsR3...Qfs7`, SPOT / ONE_SIDED_Y | 2026-08-29 13:36 / 13:43 | v1 `-84,687,407` | `-115,822` | `+84,571,585` | PROVEN_OTHER_CASHFLOW_OMISSION | SAFE_APPEND_ONLY_REPAIR |
| `8G992...bjsQ` | `EsR3...Qfs7`, CURVE / ONE_SIDED_Y | 2026-08-29 12:28 / 12:32 | v1 `-87,118,247`; v2 `-29,712,167` | `-32,525` | `+29,679,642` | CHAIN_RECONSTRUCTION_COMPLETE_BUT_DB_INCORRECT | REQUIRES_SEPARATE_ACCOUNTING_DECISION |
| `GRyrKY...hqC2` | `2VHM...Krd9`, BID_ASK / SKEWED_Y | 2026-08-29 16:37 / 18:39 | v1 `-77,079,731`; v2 `-19,673,651`; v3 `-313,759` | `-313,759` | `0` | ALREADY_CORRECT | none |
| `DrbJX...MK7w` | `EsR3...Qfs7`, BID_ASK / SKEWED_Y | 2026-08-31 06:22 / 07:18 | v1 `-446,018` | `-406,220` | `+39,798` | PROVEN_MISSING_TERMINAL_CLAIM | SAFE_APPEND_ONLY_REPAIR |
| `BhhRQ...gpEx` | `EsR3...Qfs7`, CURVE / ONE_SIDED_Y | 2026-08-31 08:18 / 12:31 | v1 `144,797` | `320,468` | `+175,671` | PROVEN_MISSING_TERMINAL_CLAIM | SAFE_APPEND_ONLY_REPAIR |
| `HVEbGM...NZtp` | `EsR3...Qfs7`, BID_ASK / SKEWED_Y | 2026-08-31 13:04 / 18:07 | v1 `-2,726,908`; v2 `-1,925,242` | `-1,925,242` | `0` | ALREADY_CORRECT | none |

All finalizations before M0067 lack a stored
`lifecycle_settlement_chain_reconciliations` row.  HVE v2 is the only
historical settlement carrying M0067's `RECONCILED_CHAIN` evidence.  The
read-only receipt reconstruction above supplies equivalent forensic evidence
for the earlier records; it does not backfill the database.

## Terminal transaction evidence

### 8HU47...1Pzw — current v2 is exact

- Entry cashflow basis: `33,918,444` contribution, `80,012,160` PositionV2
  rent lock, `20,276` entry transaction cost.
- Confirmed remove: `4ppW...snhQ`, native `16,335,457`, token
  `938,659,268` raw.
- Confirmed terminal claim: `2tn7...C3wL`, native fee `145,064` and token
  `5,429,670` raw; its DB `FEE_CLAIM` matches exactly.
- Confirmed primary/residual unwinds: `65ys...wjnm` = `4,556,273`; 
  `47uc...BZmTQ` = `14,322,787` lamports.
- Confirmed close/rent recovery: `3A8c...xc7m` = `80,012,160`.
- Confirmed lifecycle costs total `53,584` lamports.  Result: `1,387,553`.

The prior v1 was superseded before this audit.  v2 is
`CHAIN_RECONCILED_EXACT` within the accounting scope.

### F3V7UH...ue1k — four exact omissions

- Confirmed management claim `5fyP...SwP7w`: `28,153` lamports; DB has only
  its `5,000` cost, not its `FEE_CLAIM`.
- Confirmed remove `4Uwro...LHvo`: native `27,137,177` and token
  `1,016,118,528` raw; DB records only the token withdrawal.
- Confirmed terminal claim `tJqfn...5giF`: native `175` lamports; absent from
  DB cashflows.
- Confirmed primary unwind `eQi7...Bu8Y`: `2,753,673` lamports; present.
- Confirmed account close `TcGi...buJG`: rent recovery `57,406,080`; absent.
- Transaction costs total `35,000` and are present.

`-84,687,407 + 28,153 + 27,137,177 + 175 + 57,406,080 = -115,822`.
The terminal claim is real but tiny; calling this solely a terminal-claim bug
would conceal the more material remove and rent omissions.

### 8G992...bjsQ — native remove omitted; prior unknown resolved

- Confirmed open `4ynF...wX8x` funded `30,000,000` lifecycle capital and
  `57,406,080` PositionV2 rent. It also created a persistent associated token
  account funded with `2,074,080`; this is wallet infrastructure and remains
  excluded by the existing LPForge scope.
- Confirmed remove `3UWx...QvXM`: native `29,679,637` and token
  `109,076,403` raw. DB holds the token withdrawal but omits the native
  `CLOSE_WITHDRAWAL`.
- Confirmed unwind `JDt6...hnAD`: `313,287`; confirmed close
  `32bZ...YpsD`: `57,406,080` rent recovery. Both are represented.
- Confirmed costs total `25,454` in the settlement basis.

The confirmed missing native withdrawal would turn latest v2 from
`-29,712,167` to `-32,530`. Chain truth is a further five lamports better:
the opening transaction transferred `29,999,995` rather than the configured
`30,000,000` capital amount. The missing withdrawal is exact, but representing
the additional five-lamport entry-basis correction would require an accounting
decision rather than a fabricated receipt cashflow. The earlier
unknown/incomplete label was caused by pre-M0063 evidence not distinguishing
the native and token components of the remove receipt. It is now
`CHAIN_RECONSTRUCTED_WITH_SCOPE_LIMITATION`, not safe for an automated repair.

### GRyrKY...hqC2 — terminal claim candidate, but latest v3 is correct

- Confirmed remove `2JUH...iHpf`: native `19,359,892`, token `72,883,220`
  raw.
- Confirmed terminal claim `TPFJ...Qyt3`: **zero native SOL** and
  `421,882` raw paired token. It is not a missing native fee cashflow.
- Confirmed primary/unwind retry `5k5D...S7ME` = `10,080,526` and
  `482e...JJxU` = `280,823` lamports.
- Confirmed close `5b9F...qb5N` recovered `57,406,080` rent.
- The earlier residual attempt `5djT...Zvbs` is `UNKNOWN`/no accepted effect;
  its confirmed retry is the only counted residual unwind.
- Exact latest result is `-313,759`, settlement v3.

Direct chain wallet arithmetic is lower by the one-off `2,074,074`
associated-token-account rent created at entry. That account is not
lifecycle-attributable under the established scope; v3 is therefore correct
for LPForge's intended SOL_SETTLED definition.

### DrbJX...MK7w — missing native terminal fee

- Confirmed remove `4RTo...2ymo`: `18,454,709` native plus
  `3,419,436,200` raw token.
- Confirmed terminal claim `3brM...K6VH`: `39,798` native SOL. The DB
  contains its `5,000` cost and token withdrawal but no `FEE_CLAIM`.
- Confirmed primary/residual unwinds: `52ZN...VTQB` = `10,647,844`; 
  `2FDp...drFN` = `486,429` lamports.
- Confirmed close `3PpJ...Bdr9` recovered `57,406,080` rent.
- Total settlement-basis transaction cost: `35,000`.

The complete waterfall is `-406,220`; v1 is exactly short by `39,798`.

### BhhRQ...gpEx — interim claim matches; terminal claim is missing

- Confirmed interim claim `tgh6...KML` = `174,982`, exactly matching the
  existing DB `FEE_CLAIM`.
- Confirmed remove `4XVJ...V2NF` = `29,999,815` native.
- Confirmed terminal claim `5jtT...pnZg` = `175,671` native. DB contains its
  `5,000` cost but no fee cashflow.
- Confirmed close `2Qxa...AtSr` recovered `57,406,080` rent.
- Settlement-basis costs total `30,000`.

The result is `320,468`; v1 omits exactly the `175,671` terminal claim.

### HVEbGM...NZtp — control case

- Original v1: `-2,726,908`.
- Confirmed terminal claim `5gGi...VU6k`: `801,666` native SOL.
- v2: `-1,925,242` with M0067 `RECONCILED_CHAIN` status.

The method reproduces `-2,726,908 + 801,666 = -1,925,242` exactly. This is
the known terminal-claim regression control.

## Five prior terminal-claim candidates

| Candidate | Terminal claim on chain | Wallet effect | DB cashflow status at original settlement | Does latest settlement omit it? | Finding |
| --- | --- | ---: | --- | --- | --- |
| HVEbGM...NZtp | yes | `801,666` SOL | v1 missing; v2 append-only receipt exists | no, v2 correct | control / repaired previously |
| BhhRQ...gpEx | yes | `175,671` SOL | missing | yes | safe fee-only repair |
| DrbJX...MK7w | yes | `39,798` SOL | missing | yes | safe fee-only repair |
| F3V7UH...ue1k | yes | `175` SOL | missing | yes | repair also needs three other exact flows |
| GRyrKY...hqC2 | yes | `421,882` raw token; `0` native SOL | no native fee cashflow required | no, v3 correct | not an HVE-style omission |

## Aggregate scorecard — exactly reconciliable cohort

All seven have complete receipt evidence. Six can be represented exactly by
the existing cashflow taxonomy; 8G has the five-lamport entry-basis issue
described above.
Returns use actual `OPEN_CONTRIBUTION` where available (`33,918,444` for
8HU; `30,000,000` for the other six), not UI valuation.

| Metric | Original v1 scorecard | Chain-reconstructed/latest scorecard |
| --- | ---: | ---: |
| Total net PnL | `-233,059,454` | `-1,085,547` |
| Aggregate correction |  | `+231,973,907` |
| Winners / losers | `2 / 5` | `2 / 5` |
| Mean net PnL | `-33,294,208` | `-155,078` |
| Median net PnL | `-2,726,908` | `-115,822` |
| Largest win | `18,854,060` | `1,387,553` |
| Largest loss | `-87,118,247` | `-1,925,242` |
| Profit factor | `0.0754` | `0.6114` |
| Mean return | not comparable: v1 omissions dominate | `-0.5933%` |
| Aggregate return | not meaningful | `-0.5075%` |

This is an accounting-restatement diagnostic over seven positions, not an
alpha or strategy-performance result.

## Proposed append-only repairs — not executed

All future repair tooling must take an explicit approved lifecycle ID and
precomputed expected result; it must never bulk-select `SOL_SETTLED` rows.
Immediately before appending, it must re-fetch each signature, compare its
receipt-derived amount to the approved amount, use the stable
`planId + effect + transactionId` idempotency key, refuse if the DB evidence
hash changed, create a new immutable settlement version, and store the chain
reconciliation evidence/hash and audit reason.

### BhhRQ...gpEx

- Proposed v2 cashflow: `FEE_CLAIM +175,671` lamports.
- Signature / transaction: `5jtT...pnZg` /
  `tx-3-8c3bdb893b77481057c48b459485c337-271860abf6f54a54b3b15d7ed4b5bb02:claim`.
- Idempotency key: `plan-271860abf6f54a54b3b15d7ed4b5bb02:claim-native-sol:<transaction-id>`.
- Expected settlement v2: `320,468` lamports, `+1.0682267%` of 0.03 SOL.
- Audit reason: `HISTORICAL_CONFIRMED_TERMINAL_NATIVE_FEE_CLAIM_MISSING`.

### DrbJX...MK7w

- Proposed v2 cashflow: `FEE_CLAIM +39,798` lamports.
- Signature / transaction: `3brM...K6VH` /
  `tx-3-37be24a265562a990f9948f86f0045dd-b3530c9edd6aba242824e25a3e0b0c6a:claim`.
- Idempotency key: `plan-b3530c9edd6aba242824e25a3e0b0c6a:claim-native-sol:<transaction-id>`.
- Expected settlement v2: `-406,220` lamports, `-1.3540667%`.
- Audit reason: `HISTORICAL_CONFIRMED_TERMINAL_NATIVE_FEE_CLAIM_MISSING`.

### F3V7UH...ue1k

- Proposed v2 cashflows:
  - `FEE_CLAIM +28,153`, management signature `5fyP...SwP7w`;
  - `CLOSE_WITHDRAWAL +27,137,177`, remove `4Uwro...LHvo`;
  - `FEE_CLAIM +175`, terminal claim `tJqfn...5giF`;
  - `RENT_RECOVERY +57,406,080`, position close `TcGi...buJG`.
- Idempotency keys use the current canonical helpers:
  `claim-native-sol`, `close-native-withdrawal`, and
  `position-rent-recovery`, each bound to plan and transaction ID.
- Expected settlement v2: `-115,822` lamports, `-0.3860733%`.
- Audit reason: `HISTORICAL_CONFIRMED_TERMINAL_CASHFLOW_SET_INCOMPLETE`.

### 8G992...bjsQ — no automated repair proposed

The remove receipt proves a missing `CLOSE_WITHDRAWAL +29,679,637` lamports,
but the same exact reconstruction proves a five-lamport configured-capital
rounding mismatch at entry. A receipt-bound append-only native withdrawal
alone would produce `-32,530`, not the chain-exact `-32,525`. This lifecycle
requires a separate decision on whether and how the accounting taxonomy may
represent the five-lamport entry-basis adjustment. No automatic or approved
repair is proposed.

## No-change statement and current runtime

This forensic did not invoke any recovery or repair path. It did not append a
cashflow, create a settlement version, mutate a DB row, change code, deploy,
restart a service, or change trading policy.

At the cutoff, the existing production control was
`PRODUCTION / HEALTHY / NORMAL / newEconomicActionAllowed=true`; both
`lpforge-production` and `lpforge-execution` were online from release
`9863742e7c39ab78c6466729b425236c14d1cc0c`, with zero active LP positions.
Historical reconciliation rows were read only; historical repairs remain
explicitly unexecuted.
