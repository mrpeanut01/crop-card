/**
 * Task-category vocabulary shared between the plugin Zod schema (this
 * package) and apps/web's plan-side UI helpers.
 *
 * Lives here (not in apps/web/src/lib/plan/) so the shared schemas can
 * import it without dragging in any app code. apps/web's `lib/plan/
 * taskCategory.ts` carries the UI-specific helpers (labels, emoji
 * glyphs, palette subset, calendar-event→category mapper) and SHOULD
 * be refactored to re-export `TASK_CATEGORY_VALUES` from here at the
 * Phase 23 merge so the vocabulary has a single source. Until that
 * cleanup lands, this file and apps/web/src/lib/plan/taskCategory.ts
 * keep their copies of the array in lockstep — any added category must
 * land in both at the same time. The plugin registry test in apps/web
 * + the marketplace's scan-pipeline tests will catch drift.
 */

export const TASK_CATEGORY_VALUES = [
  'plant',
  'till',
  'fertilize',
  'spray',
  'scout',
  'companion-check',
  'prune',
  'harvest',
  'hay-cutting',
  'other'
] as const;

export type TaskCategory = (typeof TASK_CATEGORY_VALUES)[number];
