/**
 * Phase 21b follow-up — shared task-category vocabulary.
 *
 * Lives in `$lib/plan/` (not `$lib/db/`) so the plugin Zod schemas in
 * `$lib/plugins/schemas.ts` can import it without dragging in the
 * Drizzle / better-sqlite3 server bundle.
 *
 * The category is the swim-lane pip's authoritative glyph driver and
 * the value the popover dropdown writes back. Plugin pre/post/seasonal
 * task definitions tag it; the inputs-plan commit and manual entry
 * surfaces (today, popover) also stamp it. The categorize() fallback
 * in /plan/+page.server.ts only kicks in for legacy rows + v1 plugins
 * that predate the tag.
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

/**
 * The subset of categories surfaced in the PipPalette (drag-onto-bar
 * menu on the schedule swim-lane). `plant` is implicit in the planting
 * itself (drag the seed onto the swim-lane), `harvest` is implicit in
 * the harvest-target window already rendered on the bar, and `other`
 * isn't a meaningful default — operators should pick a specific
 * category when authoring a one-off. The popover + plugin author UI
 * still expose every category so existing rows remain editable.
 */
export const PALETTE_TASK_CATEGORY_VALUES = [
  'till',
  'fertilize',
  'spray',
  'scout',
  'companion-check',
  'prune',
  'hay-cutting'
] as const satisfies ReadonlyArray<TaskCategory>;

/** Human-readable label used in dropdown options + popover headings. */
export function labelForTaskCategory(c: TaskCategory): string {
  switch (c) {
    case 'plant':
      return 'Plant';
    case 'till':
      return 'Till';
    case 'fertilize':
      return 'Fertilize';
    case 'spray':
      return 'Spray';
    case 'scout':
      return 'Scout';
    case 'companion-check':
      return 'Companion check';
    case 'prune':
      return 'Prune';
    case 'harvest':
      return 'Harvest';
    case 'hay-cutting':
      return 'Hay';
    case 'other':
      return 'Other';
  }
}

/**
 * Phase 21b follow-up — map a CalendarEvent.kind (engine output) to the
 * authoritative task category that /today's scheduleFromEvent stamps
 * on the materialized task. Keeps the categorize() fallback in
 * /plan/+page.server.ts off the critical path for events the operator
 * promotes through /today.
 */
export function categoryForCalendarEventKind(kind: string): TaskCategory {
  switch (kind) {
    case 'planting':
      return 'plant';
    case 'spray-window':
      return 'spray';
    case 'companion-trigger':
      return 'companion-check';
    case 'harvest-window':
    case 'curing-progress':
    case 'curing-ready':
      return 'harvest';
    case 'cover-termination':
      return 'till';
    case 'emergence':
    case 'stage-window':
      return 'scout';
    default:
      return 'other';
  }
}

/** Picture-emoji glyph paired with each category on the swim-lane pip. */
export function glyphForTaskCategory(c: TaskCategory): string {
  switch (c) {
    case 'plant':
      return '🌱';
    case 'till':
      return '🚜';
    case 'fertilize':
      return '💩';
    case 'spray':
      return '💧';
    case 'scout':
      return '🔍';
    case 'companion-check':
      return '🤝';
    case 'prune':
      return '✂️';
    case 'harvest':
      return '🌾';
    case 'hay-cutting':
      return '🌿';
    case 'other':
      return '·';
  }
}
