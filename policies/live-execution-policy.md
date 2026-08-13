# Live execution policy

`live-execution-policy.json` is the non-secret, versioned source of truth for live pool limits. It is `DISABLED` by default. No pool can receive an OPEN authorization until its status is changed to `ENABLED` and the normal runtime gates and operator approval are also satisfied.

Use regular SOL amounts for all pool capital settings. Prefer quoted decimals (for example, `"0.1"` or `"0.2"`) so the configured amount remains exact. Numeric JSON values such as `0.1` are also accepted for convenience.

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
      "maxCapitalSol": "0.2",
      "maxOpenPositions": 4
    }
  ]
}
```

`maxOpenPositions` is the global concurrent-position limit. Each pool additionally has its own `maxOpenPositions` and `maxCapitalSol`. There are no source-code ceilings for either setting. LPForge converts SOL decimals to exact native units internally; values with more than nine decimal places are rejected. The policy parser rejects duplicate pool addresses, non-positive capital, invalid position counts, and an enabled policy with no pools.

The only related environment entry is `LPFORGE_EXECUTION_POLICY_PATH`, which selects this policy file; it does not carry pool limits, capital limits, or allowlists.

## Discovery-fed pools

An optional `discoveryFeed` adds fresh candidates from the PostgreSQL D1/D2
registry to this same execution policy. The feature is configured here, not in
an environment file. It is enforced by both production when it creates
autonomous decisions and execution when it claims a plan.

```json
{
  "discoveryFeed": {
    "enabled": true,
    "eligibleTiers": ["A"],
    "maxCandidates": 10,
    "maxCandidateAgeMs": 300000,
    "maxCapitalSol": "0.02",
    "maxOpenPositions": 1
  }
}
```

Only fresh `PREFILTERED` candidates in the selected tiers are included.
Static `pools` remain valid and take precedence if an address appears in both
sources. The global `maxOpenPositions` still applies across both universes.
