-- Sprint 4 (#200 / CT-HS-004) — backfill stock_movements receipt deltas.
--
-- Until this migration the receipt path wrote `delta_hundredths = 0` to
-- `stock_movements` while the lot's `received_quantity_hundredths`
-- carried the actual amount. Balance derivation summed them so the
-- on-hand was correct, but the movement ledger displayed every receipt
-- as "0 gal received" — wrong-looking under inspector audit + a VDACS-
-- export hazard once #161's PDF flow lands.
--
-- After this migration:
--   1. Every existing receipt row gets its delta_hundredths populated
--      from the linked stock_lot's received_quantity_hundredths.
--   2. The Sprint 4 code change in `lib/db/stock.ts` switches
--      `lotBalanceHundredths()` to `sum(movements.delta_hundredths)` —
--      `received_quantity_hundredths` is now a denormalized cache, no
--      longer summed at read time. The two changes together preserve
--      the on-hand balance while fixing the ledger display.
--
-- Idempotent: only rewrites rows where delta_hundredths is exactly 0
-- AND reason='receipt', so re-running the migration on a freshly-
-- correct DB is a no-op.

UPDATE `stock_movements`
SET `delta_hundredths` = (
  SELECT `received_quantity_hundredths`
  FROM `stock_lots`
  WHERE `stock_lots`.`id` = `stock_movements`.`stock_lot_id`
)
WHERE `stock_movements`.`reason` = 'receipt'
  AND `stock_movements`.`delta_hundredths` = 0
  AND `stock_movements`.`stock_lot_id` IS NOT NULL;
