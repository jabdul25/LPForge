# Phase 6 remote signer service contract

`lpforge-execution` supports a local Base58 private key in the ignored `.env.execution` file—matching LPERS and Meribot—a local owner-only JSON keypair file, or an operator-managed HTTPS signer service. In every mode, Phase 6 gates must authorize an action before the signer can be used.

## Local Base58 private-key mode

This is the direct `.env` model used by LPERS and Meribot. Enter the private key only on the VPS in the ignored `.env.execution` file:

```dotenv
LPFORGE_P6_SIGNER_MODE=LOCAL_PRIVATE_KEY
LPFORGE_P6_SIGNER_BACKEND_ID=lpforge-local-mainnet-owner
LPFORGE_P6_SIGNER_PUBLIC_KEY=OWNER_PUBLIC_KEY
LPFORGE_P6_PRIVATE_KEY=BASE58_64_BYTE_SOLANA_PRIVATE_KEY
```

LPForge derives the public address from the supplied key and refuses to sign if it differs from `LPFORGE_P6_SIGNER_PUBLIC_KEY`. It never writes or logs the key. The key necessarily exists in the execution process memory during signing, so keep `.env.execution` mode `0600`, do not reuse this wallet elsewhere, and do not paste its value into chat.

## Local keypair-file mode

This is the compatible local-repository setup. Store the wallet’s 64-byte Solana keypair JSON outside Git, with permissions `0600`; configure its path in the ignored `.env.execution` file:

```dotenv
LPFORGE_P6_SIGNER_MODE=LOCAL_KEYPAIR_FILE
LPFORGE_P6_SIGNER_BACKEND_ID=lpforge-local-mainnet-owner
LPFORGE_P6_SIGNER_PUBLIC_KEY=OWNER_PUBLIC_KEY
LPFORGE_P6_KEYPAIR_PATH=/secure/path/lpforge-owner.json
```

LPForge rejects symbolic links, non-regular files, group/world-readable files, malformed keys, and keys whose public address does not match `LPFORGE_P6_SIGNER_PUBLIC_KEY`. Never place the key file in this repository or paste its contents into chat.

## Remote signer mode

Configure these secret/runtime settings only in the ignored VPS `.env` file:

```dotenv
LPFORGE_P6_SIGNER_MODE=REMOTE_KMS
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

`pnpm pm2:start-execution` first runs the Phase 6 launch assertion and only then starts the `lpforge-execution` PM2 service. The normal `pnpm pm2:start` starts only the read-only `lpforge-production` monitor.

## Manual plan inbox

The execution worker reads the ignored file selected by `LPFORGE_P6_PLAN_INBOX_PATH` (default: `runtime/execution-plan.json`). Copy `runtime/execution-plan.example.json` to that ignored path and give it a unique plan ID. The source only validates and surfaces an operator-created request; it does not build, sign, or submit a transaction. A queued plan remains subject to build, simulation, fresh approval, and every Phase 6 control before any future execution implementation may act on it.
