# LPFORGE Non-Expiring Unattended Production and GitHub Main Alignment V1

Action cutoff: 2026-09-03T06:00:00Z

## Result

- P7 now represents bounded unattended Production explicitly as
  `BOUNDED_UNATTENDED_PRODUCTION`.
- That authority has `expiresAt: null`, no temporary approval identifier, and
  only permits Production mode with production authority and disabled scaling.
- Temporary authority behavior remains unchanged: it requires an expiry and
  still fails closed with `LPFORGE_P7_AUTHORITY_EXPIRED` when expired.
- Existing portfolio, freshness, simulation, reconciliation, terminalization,
  signer, RPC, and release-identity gates remain in force.

## Validated source and artifact

- Source before: `d92edff1c38f1927daeea0feeb5a7fbc213a18d3`
- Source after / deployed canonical source: `d7e558780901a8ca5117dd472f08061aa697b27a`
- Commit: `feat: add non-expiring bounded unattended P7 authority`
- Migration: none (head remains `M0069_production_global_candidate_contract.sql`)
- Artifact build identity: `a08f663797d4edfab57d89b4c0c1478170d6ad9fc24bcefbb9edb721b8a54e8d`
- Artifact SHA-256: `f6964412d9e3125b9b18e8896820e28b8dd55af92b7df2ee54595cc8e7b970e0`
- Focused P7 tests: 17/17 passed.
- Canonical CI: 952/952 passed, with all boundary and migration checks passed.

## Production verification

The Production service is online from the immutable `d7e558780901` release.
It resolves the active authority as:

```text
authorityKind: BOUNDED_UNATTENDED_PRODUCTION
expiresAt: null
approvalId: null
productionAuthorityIssued: true
scalingMode: DISABLED
```

Latest live P7 control was `PRODUCTION / HEALTHY / WATCH / NORMAL`, allowed
new economic action, and carried `P7_BOUNDED_UNATTENDED_PRODUCTION`.  It had
no active incidents, zero open positions, zero operational pending execution,
zero UNKNOWN submissions, and zero unresolved reconciliation debt.

The Production global selector was `GLOBAL_NO_TRADE`; no trade was forced and
no transaction was submitted during this work.  The execution runner, live
execution, live signing, mainnet gate, bounded unattended mode, and entry-plan
dispatch remain enabled.  Hard limits remain one active position and 0.03 SOL
per active position.

Discovery intentionally remains on `d92edff1c38f1927daeea0feeb5a7fbc213a18d3`
and execution on `8f0ea62ac2ede2316dab5c34c1af056002fc855a`; the validated
component set is compatible.  The P7 Production source is the new `d7e55878`
immutable release.

## GitHub alignment

`origin/main` was fast-forwarded from
`5ea5c0d5a1b529b593d93bbec90a9a583528d56e` to
`d7e558780901a8ca5117dd472f08061aa697b27a`.

At cutoff, the authoritative VPS canonical branch,
the VPS local `main`, and `origin/main` all resolved to the same SHA:
`d7e558780901a8ca5117dd472f08061aa697b27a`.

No secrets, runtime environment files, RPC credentials, or signer material
were committed.
