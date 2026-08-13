# Phase 6 remote signer service contract

`lpforge-execution` never holds an owner private key. It sends a ticket-bound Ed25519 message to an operator-managed HTTPS signer service only after the Phase 6 gate has authorized an action.

Configure these secret/runtime settings only in the ignored VPS `.env` file:

```dotenv
LPFORGE_P6_SIGNER_BACKEND_ID=your-signer-id
LPFORGE_P6_SIGNER_PUBLIC_KEY=your-owner-public-key
LPFORGE_P6_REMOTE_SIGNER_URL=https://your-signer.example/v1/sign
LPFORGE_P6_REMOTE_SIGNER_AUTH_TOKEN=secret-managed-token
LPFORGE_P6_REMOTE_SIGNER_TIMEOUT_MS=5000
LPFORGE_P6_EXECUTION_RUNNER_ENABLED=false
```

The remote service must accept an authenticated HTTPS `POST` with this JSON request:

```json
{
  "version": 1,
  "algorithm": "ed25519",
  "cluster": "mainnet-beta",
  "publicKeyAddress": "OWNER_PUBLIC_KEY",
  "messageBase64": "BASE64_SERIALIZED_SOLANA_MESSAGE",
  "ticketId": "PHASE6_TICKET_ID",
  "transactionId": "LPFORGE_TRANSACTION_ID"
}
```

It must return exactly one 64-byte Ed25519 signature:

```json
{"signatureBase64":"BASE64_64_BYTE_SIGNATURE"}
```

The signer service must independently verify its configured owner public key, `mainnet-beta`, ticket expiry, and the allowed caller identity. It must retain its private key internally and must never return it through this API.

`pnpm pm2:start-execution` first runs the Phase 6 launch assertion and only then starts the `lpforge-execution` PM2 service. The normal `pnpm pm2:start` starts only the read-only `lpforge-production` monitor. The runner is intentionally no-plan-source until a separately reviewed plan-dispatch workflow is implemented; it cannot create an autonomous trade by itself.
