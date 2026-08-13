# Live execution policy

`live-execution-policy.json` is the non-secret, versioned source of truth for live pool limits. It is `DISABLED` by default. No pool can receive an OPEN authorization until its status is changed to `ENABLED` and the normal runtime gates and operator approval are also satisfied.

Use lamports for all SOL amounts: `1 SOL = 1000000000` lamports.

```json
{
  "schemaVersion": 1,
  "policyId": "lpforge-live-execution-v1",
  "status": "ENABLED",
  "approvalTtlMs": 15000,
  "minDevnetConfirmedRuns": 3,
  "maxActionsPerDay": 20,
  "maxOpenPositions": 10,
  "pools": [
    {
      "address": "POOL_PUBLIC_KEY",
      "maxCapitalLamports": "5000000000",
      "maxOpenPositions": 4
    }
  ]
}
```

`maxOpenPositions` is the global concurrent-position limit. Each pool additionally has its own `maxOpenPositions` and `maxCapitalLamports`. There are no source-code ceilings for either setting. The policy parser rejects duplicate pool addresses, non-positive capital, invalid position counts, and an enabled policy with no pools.

The only related environment entry is `LPFORGE_EXECUTION_POLICY_PATH`, which selects this policy file; it does not carry pool limits, capital limits, or allowlists.
