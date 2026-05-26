/**
 * Sprint 2 (#155, #156) — pure constants split out from `recordsUnified.ts`.
 *
 * `recordsUnified.ts` pulls in `$lib/server/superadmin` transitively through
 * `sprayEvents.ts` (which calls `incrementUsageCounter` from a top-level
 * import). Importing the loader from a `+page.svelte` therefore leaks a
 * server-only module into the client bundle and the page fails to hydrate
 * (see `feedback_sveltekit_server_only` memory). This file holds only the
 * IO-free constants + types the Svelte components need.
 *
 * Don't add anything that touches the DB, Node crypto, or server libs here.
 */

export const RECORD_KINDS = [
  'spray',
  'insecticide',
  'fungicide',
  'scout',
  'harvest',
  'fertility',
  'planting',
  'decon'
] as const;

export type RecordKind = (typeof RECORD_KINDS)[number];

/** Almanac tone-pill mapping per direction-almanac-pages.jsx §kindTone. */
export const KIND_TONE: Record<RecordKind, 'rust' | 'wheat' | 'sky' | 'forest' | 'neutral'> = {
  spray: 'rust',
  insecticide: 'wheat',
  fungicide: 'sky',
  scout: 'neutral',
  harvest: 'wheat',
  fertility: 'sky',
  planting: 'forest',
  decon: 'rust'
};

/** Display labels for chips + table cells. */
export const KIND_LABEL: Record<RecordKind, string> = {
  spray: 'Spray',
  insecticide: 'Insecticide',
  fungicide: 'Fungicide',
  scout: 'Scout',
  harvest: 'Harvest',
  fertility: 'Fertility',
  planting: 'Planting',
  decon: 'Decon'
};

/** FR-09 — records become immutable 48 hours after `occurredAt`. */
export const LOCK_WINDOW_MS = 48 * 60 * 60 * 1000;
