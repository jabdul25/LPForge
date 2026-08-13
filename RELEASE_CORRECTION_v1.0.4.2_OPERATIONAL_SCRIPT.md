# LPForge v1.0.4.2 Operational-Script Correction

This derivative preserves v1.0.4.1 application behavior and read-only defaults. It adds one package-script alias:

`canary:capabilities` runs the existing canary CLI with its already-supported `capabilities` command.

The final soak handoff requires this exact command before PM2 start. No collector, trading, execution, signer, transaction-submission, canary-authority, database-migration, or configuration behavior changed.
