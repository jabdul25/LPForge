# Phase 1 Security Boundary

- No seed phrases/private keys in repository, config or tests.
- No state-changing Solana/Meteora runtime call.
- Public RPC/API credentials belong only in environment/secrets manager.
- Logs redact tokens/credentials and never dump complete environment objects.
- Phase 1 is observation-only.
