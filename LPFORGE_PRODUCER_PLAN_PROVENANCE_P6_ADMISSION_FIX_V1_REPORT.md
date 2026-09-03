# LPFORGE Producer Plan Provenance / P6 Admission Fix V1

- Implementation: `producer-plan-provenance-scoped-auth-v1`
- Incident plan: `plan-d52c298c48dfc8a4f1ac1b731583bd76`
- Root cause: the P7 producer loaded only the canonical runtime environment, while the required plan-provenance HMAC secret is protected in the centralized execution environment. It therefore persisted an unsigned OPEN plan; P6 correctly rejected it.
- Repair: P7 reads only the provenance capability from the protected canonical file for its operator child. It explicitly strips signing and write-RPC credentials. The operator now fails before persisting an OPEN plan if no HMAC secret is available.
- Scope: planner chunking, Jupiter/Meteora multi-transaction execution, signing, recovery, risk policy, capital limits, continuity, and RPC concurrency were unchanged.
- Validation: focused regression covers the four-step Jupiter/Meteora shape with authenticated Tier-A global-winner and P7 bindings; P6 claim passes. Full canonical CI passed.
- Deployment source: `d8462fef1b6d71a1af71b81092dc0c7c5ec0aed6`.
- Secrets: no secret material is included in this report.
