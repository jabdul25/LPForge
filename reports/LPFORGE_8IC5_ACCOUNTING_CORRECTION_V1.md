# 8ic5 canonical accounting correction

The immutable v1 settlement for `8ic5T5WJvdEySFeDggBR4HLgXFKMRX5S4WYoYpmB4VbF` double-counted one confirmed close withdrawal (`29,866,726` lamports) and one confirmed fee claim (`1,033,408` lamports) through an account-close-only successor.

The approved PostgreSQL-only runner appends v2; it never updates or deletes v1, raw cashflows, plans, or chain evidence. Preconditions bind the exact v1 PnL (`32,235,901` lamports), capital (`30,000,000` lamports), and duplicate credit (`30,900,134` lamports). The v2 result is `1,335,767` lamports, or `4.45255667%`.

The runner refreshes the recomputable realized-economics and management-summary projections, creates a corrected learning successor, and supersedes the v1 learning outcome. It is dry-run by default, requires `--apply` plus an explicit acknowledgement to write, and returns `ALREADY_CORRECTED` rather than creating v3 on rerun. It contains no signer, RPC, data-API, transaction-building, or submission path.
