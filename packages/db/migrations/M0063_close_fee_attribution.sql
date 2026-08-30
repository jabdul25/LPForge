BEGIN;
CREATE TABLE IF NOT EXISTS execution.close_fee_attributions(
  close_plan_id text PRIMARY KEY REFERENCES execution.transaction_plans(plan_id),
  position_address text NOT NULL,
  pool_address text NOT NULL,
  owner_address text NOT NULL,
  observed_slot bigint,
  observed_at timestamptz NOT NULL,
  observed_block_time timestamptz,
  rpc_commitment text NOT NULL,
  token_x_mint text NOT NULL,
  token_y_mint text NOT NULL,
  token_x_decimals integer,
  token_y_decimals integer,
  pre_close_fee_x_raw numeric NOT NULL,
  pre_close_fee_y_raw numeric NOT NULL,
  pre_close_reward_one_raw numeric NOT NULL DEFAULT 0,
  pre_close_reward_two_raw numeric NOT NULL DEFAULT 0,
  claimed_fee_x_raw numeric NOT NULL DEFAULT 0,
  claimed_fee_y_raw numeric NOT NULL DEFAULT 0,
  embedded_remove_fee_x_raw numeric NOT NULL DEFAULT 0,
  embedded_remove_fee_y_raw numeric NOT NULL DEFAULT 0,
  total_realized_fee_x_raw numeric NOT NULL DEFAULT 0,
  total_realized_fee_y_raw numeric NOT NULL DEFAULT 0,
  realized_lp_fee_value_lamports bigint,
  realized_rewards_value_lamports bigint,
  principal_returned_value_lamports bigint,
  inventory_unwind_result_lamports bigint,
  transaction_cost_lamports bigint,
  rent_recovered_lamports bigint,
  accounting_reconciliation_difference_lamports bigint,
  attribution_method text NOT NULL,
  attribution_status text NOT NULL CHECK(attribution_status IN ('PENDING','COMPLETE','PARTIAL','UNAVAILABLE')),
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  remove_signature text,
  claim_signature text,
  terminal_settlement_id text REFERENCES execution.lifecycle_sol_settlements(settlement_id),
  valuation_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  CHECK(pre_close_fee_x_raw>=0 AND pre_close_fee_y_raw>=0),
  CHECK(total_realized_fee_x_raw>=0 AND total_realized_fee_y_raw>=0)
);
CREATE INDEX IF NOT EXISTS close_fee_attributions_position_idx ON execution.close_fee_attributions(position_address,created_at DESC);
CREATE INDEX IF NOT EXISTS close_fee_attributions_terminal_idx ON execution.close_fee_attributions(terminal_settlement_id) WHERE terminal_settlement_id IS NOT NULL;
CREATE OR REPLACE FUNCTION execution.guard_close_fee_attributions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'close fee attribution deletion is prohibited'; END IF;
  IF OLD.close_plan_id IS DISTINCT FROM NEW.close_plan_id OR OLD.position_address IS DISTINCT FROM NEW.position_address OR OLD.pool_address IS DISTINCT FROM NEW.pool_address OR OLD.owner_address IS DISTINCT FROM NEW.owner_address OR OLD.observed_slot IS DISTINCT FROM NEW.observed_slot OR OLD.observed_at IS DISTINCT FROM NEW.observed_at OR OLD.observed_block_time IS DISTINCT FROM NEW.observed_block_time OR OLD.rpc_commitment IS DISTINCT FROM NEW.rpc_commitment OR OLD.token_x_mint IS DISTINCT FROM NEW.token_x_mint OR OLD.token_y_mint IS DISTINCT FROM NEW.token_y_mint OR OLD.token_x_decimals IS DISTINCT FROM NEW.token_x_decimals OR OLD.token_y_decimals IS DISTINCT FROM NEW.token_y_decimals OR OLD.pre_close_fee_x_raw IS DISTINCT FROM NEW.pre_close_fee_x_raw OR OLD.pre_close_fee_y_raw IS DISTINCT FROM NEW.pre_close_fee_y_raw OR OLD.pre_close_reward_one_raw IS DISTINCT FROM NEW.pre_close_reward_one_raw OR OLD.pre_close_reward_two_raw IS DISTINCT FROM NEW.pre_close_reward_two_raw OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN RAISE EXCEPTION 'close fee snapshot is immutable'; END IF;
  IF OLD.finalized_at IS NULL AND NEW.finalized_at IS NOT NULL THEN RETURN NEW; END IF;
  IF OLD.finalized_at IS NOT NULL AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'close fee attribution lifecycle mutation rejected';
END; $$;
CREATE TRIGGER trg_close_fee_attributions_guard BEFORE UPDATE OR DELETE ON execution.close_fee_attributions FOR EACH ROW EXECUTE FUNCTION execution.guard_close_fee_attributions();
REVOKE DELETE ON execution.close_fee_attributions FROM PUBLIC;
COMMIT;
