-- Sprint 3 (#212 / CT-PP-004) — per-planting source_provenance column.
--
-- Phase 25d shipped per-field provenance JSON on operational event
-- tables (spray, insecticide, fungicide, harvest) but didn't extend it
-- to `crops` (plantings). Result: every committed wizard planting fell
-- back to PlantingCard's "Manual entry" footer because no sourceTag
-- prop was threaded.
--
-- This column closes that gap. Wizard commits send `'ai'` or `'fallback'`
-- based on the allocator's `meta.fallback` flag; manual drag-drop from
-- /plan?tab=crops leaves it NULL so the existing "Manual entry" footer
-- still renders. NULL = manual; explicit values cover the AI path.
--
-- Per AI_PROVENANCE_ADDENDUM.md field map:
--   - Block/date assignment: `ai` ↔ `fallback`
--   - DTM-derived harvest window: `plugin` (rendered at read time,
--     never persisted here — that's the plugin's job)
--   - User-typed lot # or notes: `manual` (NULL)

ALTER TABLE `crops` ADD COLUMN `source_provenance` TEXT;
