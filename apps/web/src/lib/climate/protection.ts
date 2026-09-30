/**
 * Bed covers (Phase 32E, season extension). Client-safe and pure. A cover
 * moves a bed's light-frost dates for planning only: never hardiness, PHI,
 * REI, pollinator, grazing or hold logic.
 */

export const PROTECTION_KINDS = [
  'row-cover',
  'low-tunnel',
  'caterpillar-tunnel',
  'high-tunnel',
  'cold-frame',
  'cloche',
  'greenhouse-unheated',
  'greenhouse-heated',
  'other'
] as const;
export type ProtectionKind = (typeof PROTECTION_KINDS)[number];

export type ProtectionProvenance = 'plugin' | 'data' | 'manual' | 'fallback';

export interface BlockProtection {
  id: string;
  blockId: string;
  kind: ProtectionKind;
  springShiftDays: number | null;
  fallShiftDays: number | null;
  provenance: ProtectionProvenance;
  installedOn: number | null;
  removedOn: number | null;
  seasonYear: number | null;
}

export const MAX_SHIFT_DAYS = 120;

export const PROTECTION_LABEL: Record<ProtectionKind, string> = {
  'row-cover': 'Row cover',
  'low-tunnel': 'Low tunnel',
  'caterpillar-tunnel': 'Caterpillar tunnel',
  'high-tunnel': 'High tunnel',
  'cold-frame': 'Cold frame',
  cloche: 'Cloche',
  'greenhouse-unheated': 'Unheated greenhouse',
  'greenhouse-heated': 'Heated greenhouse',
  other: 'Other cover'
};

/**
 * Sourced default shifts per kind. Every non-null number needs a quote in
 * apps/web/scripts/protection-sources.json (checked by
 * protection.sources.gate.test.ts). The extension sources checked so far
 * disagree by weeks for every kind, so none ships a default yet and the
 * owner types the days from the cover's instructions.
 */
export const PROTECTION_DEFAULTS: Readonly<
  Record<ProtectionKind, { springShiftDays: number | null; fallShiftDays: number | null }>
> = {
  'row-cover': { springShiftDays: null, fallShiftDays: null },
  'low-tunnel': { springShiftDays: null, fallShiftDays: null },
  'caterpillar-tunnel': { springShiftDays: null, fallShiftDays: null },
  'high-tunnel': { springShiftDays: null, fallShiftDays: null },
  'cold-frame': { springShiftDays: null, fallShiftDays: null },
  cloche: { springShiftDays: null, fallShiftDays: null },
  'greenhouse-unheated': { springShiftDays: null, fallShiftDays: null },
  'greenhouse-heated': { springShiftDays: null, fallShiftDays: null },
  other: { springShiftDays: null, fallShiftDays: null }
};

export function protectionDefaults(kind: ProtectionKind): {
  springShiftDays: number | null;
  fallShiftDays: number | null;
} {
  return { ...PROTECTION_DEFAULTS[kind] };
}

export function isHeated(kind: ProtectionKind): boolean {
  return kind === 'greenhouse-heated';
}

const RAIN_SHEDDING: ReadonlySet<ProtectionKind> = new Set([
  'low-tunnel',
  'caterpillar-tunnel',
  'high-tunnel',
  'cold-frame',
  'cloche',
  'greenhouse-unheated',
  'greenhouse-heated'
]);

/** Used by E4: plastic and roofs shed rain; row cover does not. */
export function shedsRain(kind: ProtectionKind): boolean {
  return RAIN_SHEDDING.has(kind);
}

/** Active at an instant (push alerts, watering). A cover saved for one
 *  season only counts during that calendar year (local time), so last
 *  year's row cover never silences this year's frost alert or rain. */
export function isActiveAt(p: BlockProtection, ms: number): boolean {
  if (p.seasonYear !== null && new Date(ms).getFullYear() !== p.seasonYear) return false;
  if (p.installedOn !== null && p.installedOn > ms) return false;
  if (p.removedOn !== null && p.removedOn <= ms) return false;
  return true;
}

export function isProtectionKind(v: unknown): v is ProtectionKind {
  return typeof v === 'string' && (PROTECTION_KINDS as readonly string[]).includes(v);
}

/** Resolves the shifts a new cover is saved with: a typed number is the
 *  owner's (`manual`); an omitted one takes the sourced default (`data`). */
export function resolveNewProtection(
  kind: ProtectionKind,
  typed: { springShiftDays?: number | null; fallShiftDays?: number | null }
): {
  springShiftDays: number | null;
  fallShiftDays: number | null;
  provenance: ProtectionProvenance;
} {
  const d = PROTECTION_DEFAULTS[kind];
  const springTyped = typeof typed.springShiftDays === 'number';
  const fallTyped = typeof typed.fallShiftDays === 'number';
  const spring = springTyped ? typed.springShiftDays! : d.springShiftDays;
  const fall = fallTyped ? typed.fallShiftDays! : d.fallShiftDays;
  return {
    springShiftDays: spring,
    fallShiftDays: fall,
    provenance: springTyped || fallTyped || (spring === null && fall === null) ? 'manual' : 'data'
  };
}

export const HARD_FREEZE_NOTE = "Covers buy a few degrees. They don't stop a hard freeze.";
export const SHIFT_UNKNOWN_NOTE =
  "Cover shift not known. Enter the days from your cover's instructions.";
