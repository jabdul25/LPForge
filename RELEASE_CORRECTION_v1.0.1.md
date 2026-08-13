# LPForge Phase 1-5 Release Correction v1.0.1

This artifact supersedes `LPForge_Phase_5_Complete_Implementation_v1.0.zip` for deployment.

The prior ZIP passed outer ZIP integrity but contained a stale embedded `SHA256SUMS.txt`: 32 files had been modified after the checksum manifest was generated. No Phase 5 strategy/execution logic change was required for this correction.

v1.0.1 freezes the source first, records a verifiable Git source commit and bundle, generates all release metadata, and only then generates the embedded per-file SHA-256 manifest. `SHA256SUMS.txt` intentionally excludes itself.

Mandatory host baseline remains Node >=24.19 <25, pnpm 11.21.0, and PostgreSQL 17. Run `./scripts/vps-preflight.sh` before installation, migration, connected reads, signing, or execution validation.
