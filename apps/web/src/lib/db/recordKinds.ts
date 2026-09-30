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
  'hay',
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
  hay: 'forest',
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
  hay: 'Hay',
  fertility: 'Fertility',
  planting: 'Planting',
  decon: 'Decon'
};

/** FR-09 — records become immutable 48 hours after `occurredAt`. */
export const LOCK_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Phase 32E (E4-14): light records that get a record card and a /records
 *  chip but stay out of the compliance ledger, its counts, the lock, the
 *  exports and `RETENTION_RULES`. */
export const LIGHT_RECORD_KINDS = ['irrigation'] as const;

export type LightRecordKind = (typeof LIGHT_RECORD_KINDS)[number];

/** Every record kind a record card (`rc_<kind>.<id>`) can name. */
export const CARD_RECORD_KINDS: readonly string[] = [...RECORD_KINDS, ...LIGHT_RECORD_KINDS];
