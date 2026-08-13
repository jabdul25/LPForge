# LPForge Phase 7 Operations-Ready Release Notes

This release extends the runtime-integrated Phase 7 control plane with VPS operational packaging only. It does not alter strategy thresholds, promotion criteria, signer isolation, transaction submission authority, or scaling policy.

## Added
- Dependency-free Telegram operational alerting using Node native fetch.
- Fail-open alert delivery: Telegram failure cannot grant authority, change decisions, or stop the safety loop.
- Severity threshold and fingerprint/cooldown deduplication.
- Alerts for daemon cycle exceptions, operator failure, CRITICAL/DEGRADED health, drift BLOCK/WARN, lease conflict, emergency-close plan, and production-evidence BLOCK.
- PM2 single-instance fork-mode ecosystem definition with autorestart and bounded restart behavior.
- PM2 start/restart/stop/status helper scripts.
- Complete `.env.production.example` with secret placeholders and safe OBSERVE_ONLY/live-execution-off defaults.

## PM2 invariant
Exactly one `lpforge-production` PM2 process is configured. Phase 7's database runtime lease remains the second line of duplicate-runtime protection.

## Security invariant
Telegram bot token, Telegram chat ID, database credentials, private RPC URLs, and wallet material are not rendered into alert text or structured alert logs. Completed `.env` files are git-ignored.
