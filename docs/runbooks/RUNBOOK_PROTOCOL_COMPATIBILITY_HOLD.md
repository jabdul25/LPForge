# Protocol Compatibility Hold

Trigger: SDK/IDL/program/account/event contract differs from the Phase 1 verified baseline.

1. Stop readiness for live-data workers that depend on the incompatible decoder.
2. Do not “fix” by accepting unknown fields silently.
3. Record current program ID, SDK version, failing pool/fixture and error.
4. Review current official Meteora changelog/IDL/SDK.
5. Implement compatibility change behind tests and ADR if material.
6. Re-run golden fixtures + read-only smoke.
7. Update compatibility record and evidence before clearing hold.
