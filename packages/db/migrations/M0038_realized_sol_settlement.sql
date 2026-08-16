-- A successful token-X unwind realizes a token-Y/SOL receipt.  Keep it
-- distinct from LP withdrawal so lifecycle PnL counts the actual swap output,
-- never both the pre-swap token-X inventory and its realized SOL proceeds.
BEGIN;

ALTER TABLE execution.position_cashflows
  DROP CONSTRAINT IF EXISTS position_cashflows_flow_type_check;

ALTER TABLE execution.position_cashflows
  ADD CONSTRAINT position_cashflows_flow_type_check CHECK (flow_type IN (
    'OPEN_CONTRIBUTION',
    'ADD_CONTRIBUTION',
    'FEE_CLAIM',
    'REWARD_CLAIM',
    'REDUCE_WITHDRAWAL',
    'CLOSE_WITHDRAWAL',
    'SWAP_PROCEEDS',
    'SWAP_COST',
    'TX_COST',
    'RENT_LOCK',
    'RENT_RECOVERY'
  ));

COMMIT;
