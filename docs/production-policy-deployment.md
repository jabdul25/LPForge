# Routine Production policy change

For the live execution policy:

1. Edit `release-policy-templates/live-execution-policy.json`.
2. Run `./scripts/deploy-production-policy.sh`.

Nothing else is required. The explicit command validates the policy, builds and
installs an immutable release, derives policy identity, restarts only affected
services, verifies P6/P7 health, and restores the last known-good runtime
policy and affected services if activation fails.

The same command handles the other versioned policy templates. For example, a
hard-stop or trailing-profit setting belongs to
`release-policy-templates/live-exit-governor-policy.json`; edit that one
canonical policy document and run the same command. The command derives the
affected policy domain and service set automatically.
