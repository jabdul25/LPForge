# LPForge v1.0.4.1 Integrity-Verifier Correction

This derivative preserves the v1.0.4 application source and operational defaults. It changes only the source-provenance parser in `scripts/verify-release-integrity.sh`.

## Defect and correction

The v1.0.4 verifier removed whitespace from the complete multi-line `SOURCE_REVISION.txt` before validating the source commit. As a result, valid metadata was concatenated with `release_parent_commit` and the mandatory integrity gate always failed.

The verifier now reads exactly one `source_git_commit` field, removes only a possible carriage return, and requires a 40-character lowercase Git SHA. The embedded source bundle and manifest are updated to the same repair commit.

No trading, collector, execution, signer, transaction-submission, canary, database-migration, or authority behavior changed. All live and canary defaults remain disabled.
