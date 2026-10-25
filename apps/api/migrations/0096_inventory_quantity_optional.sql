-- 0096_inventory_quantity_optional.sql — [P43-4] Quantity is optional: a plan, a role or a proposal has no stock
-- count. NULL = not counted (never decremented, never auto-disabled). The existing CHECK (quantity >= 0) already
-- passes NULL and stays. Existing items keep their numbers: an item saved with the old default of 1 cannot be told
-- from a real 1, so nothing is backfilled (no guess).
ALTER TABLE inventory_items
  ALTER COLUMN quantity DROP NOT NULL,
  ALTER COLUMN quantity DROP DEFAULT;
