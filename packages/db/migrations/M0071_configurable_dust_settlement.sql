BEGIN;

-- A dust disposition retains the exact attributed token balance rather than
-- pretending it was swapped.  Inventory events remain append-only; the
-- correction event is used only when an older aggregate REMOVE+CLAIM lot
-- overstated the REMOVE component by a receipt-proven claim amount.
ALTER TABLE execution.position_inventory_lots
  DROP CONSTRAINT IF EXISTS position_inventory_lots_status_check;
ALTER TABLE execution.position_inventory_lots
  ADD CONSTRAINT position_inventory_lots_status_check
  CHECK(status IN ('OPEN','PARTIALLY_SETTLED','SETTLED','TRANSFERRED','DUST_RETAINED'));

ALTER TABLE execution.position_inventory_lot_events
  DROP CONSTRAINT IF EXISTS position_inventory_lot_events_event_type_check;
ALTER TABLE execution.position_inventory_lot_events
  ADD CONSTRAINT position_inventory_lot_events_event_type_check
  CHECK(event_type IN ('CREATED','SETTLED','TRANSFERRED','DUST_RETAINED','ATTRIBUTION_CORRECTED'));

COMMIT;
