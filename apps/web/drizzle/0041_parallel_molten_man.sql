-- UC-16 harvest-moisture persistence (#339).
--
-- `harvest_events` gains a nullable `moisture_pct` real column so the
-- stored moisture the operator enters at harvest is persisted alongside
-- the record (previously it was gate-checked by the Phase-26A moisture
-- kernel, then dropped). Nullable: null means the operator didn't measure.
-- Persisting it makes the safety-gate decision auditable and unblocks the
-- structured moisture field the harvest renderers now emit (#322).

ALTER TABLE `harvest_events` ADD `moisture_pct` real;
