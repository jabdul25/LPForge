BEGIN;
ALTER TABLE execution.intents ALTER COLUMN pool_address DROP NOT NULL;
ALTER TABLE execution.intents DROP CONSTRAINT IF EXISTS execution_intents_validation_pool_chk;
ALTER TABLE execution.intents ADD CONSTRAINT execution_intents_validation_pool_chk CHECK (
  (action='VALIDATION_TRANSFER' AND pool_address IS NULL)
  OR
  (action<>'VALIDATION_TRANSFER' AND pool_address IS NOT NULL)
);
COMMIT;
