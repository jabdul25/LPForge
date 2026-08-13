# Phase 6 owner signer mode

The production execution worker accepts exactly one capital-owner signer mode:

```text
LPFORGE_P6_SIGNER_MODE=LOCAL_PRIVATE_KEY
```

The base58 private key is stored only in the ignored, owner-readable
`.env.execution` file. The production decision daemon never loads that file.

`LOCAL_KEYPAIR_FILE`, `REMOTE_KMS`, `HARDWARE`, and any other owner signer
mode are rejected at execution-worker startup. A fresh in-memory signer is
still created for each Meteora PositionV2 account; it is not the capital owner
and is never persisted or exported.
