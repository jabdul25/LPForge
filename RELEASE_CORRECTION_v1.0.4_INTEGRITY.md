# LPForge v1.0.4 Integrity Correction

This release supersedes v1.0.3 because v1.0.3 failed the mandatory source-integrity gate.

Corrected defects:

- `SOURCE_REVISION.txt` now declares a 40-character Git commit SHA.
- `RELEASE_MANIFEST.json` identifies the archive as v1.0.4 and declares the same source commit.
- `SOURCE_GIT.bundle` contains and resolves to that exact source commit.
- The source commit `2f9b6739d0a86d45a5d85e625ff1ff14d60539f0` is a real child of the prior valid bundle commit `2f2021aad35d3183de0a96205506941de25ce490`.
- Live-path and operations evidence files now reference the same source revision.
- Integrity/static verification requires no private RPC.
- The authorized read-only soak duration is 32 hours after full verification PASS.

No capital authority is granted by this correction. Signing, execution, and mainnet-canary defaults remain disabled and Phase 7 remains `OBSERVE_ONLY`.
