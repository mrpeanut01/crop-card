/**
 * Class-specific decontamination SOPs (UC-45).
 *
 * Promotes the long-standing CLAUDE.md "class-specific decon protocols"
 * follow-up to real kernel code. The generic cross-contamination gate
 * (`crossContamination.ts`) only knows "previous class differs → decon
 * required"; it does not model that three chemistries need a stricter
 * rinse sequence than the default ammonia soak:
 *
 *   - paraquat (HRAC 22 bipyridylium): 1% bleach + 1% TSP + 3 water rinses
 *   - glufosinate (Liberty, HRAC 10):  detergent + water rinse
 *   - copper fungicides:               vinegar rinse (prevents next-pass
 *                                      crop phytotoxicity)
 *
 * The selector is pure and total over `SprayerLoadClass | undefined`: any
 * class that is NOT one of the three strict chemistries — including a clean
 * (undefined) sprayer — resolves to the generic ammonia protocol. The
 * winterize wizard renders the returned protocol's steps in place of the
 * generic decon step. Kept beside `crossContamination.ts` so the SOP table
 * lives with the gate it refines.
 */

import type { SprayerLoadClass } from './types';

export type DeconProtocolId = 'generic-ammonia' | 'paraquat' | 'glufosinate' | 'copper';

export interface DeconProtocol {
  id: DeconProtocolId;
  /** Human label for the wizard step header. */
  label: string;
  /** True for the three strict-SOP chemistries; false for the default. */
  strict: boolean;
  /** Ordered rinse instructions the winterize wizard renders verbatim. */
  steps: readonly string[];
  /** One-line reason surfaced in the UI when a strict SOP is selected. */
  rationale: string;
}

const GENERIC_AMMONIA: DeconProtocol = {
  id: 'generic-ammonia',
  label: 'Ammonia decon',
  strict: false,
  steps: [
    'Drain the tank fully. Verify boom is empty.',
    'Add 1 cup household ammonia per 5 gal of water; fill to operating volume.',
    'Run the pump 30 seconds, then let the solution soak 30 minutes.',
    'Spray the ammonia solution out through the boom and nozzles.',
    'Two final clear-water rinses through the boom.'
  ],
  rationale: 'Standard end-of-season decon before storage.'
};

/**
 * The three strict SOPs. Keyed on the exact `SprayerLoadClass` the sprayer
 * carries in `lastChemistryClass`:
 *   - `photosystem-i-diquat` is the HRAC-22 class that covers paraquat.
 *   - `glufosinate` is the HRAC-10 Liberty class.
 *   - `fungicide-load` covers copper fungicides (the coarse fungicide token).
 */
const STRICT_PROTOCOLS: Partial<Record<SprayerLoadClass, DeconProtocol>> = {
  'photosystem-i-diquat': {
    id: 'paraquat',
    label: 'Paraquat decon (strict SOP)',
    strict: true,
    steps: [
      'Drain the tank fully into approved containment. Paraquat is acutely toxic — wear PPE.',
      'Rinse #1: fill with clean water, agitate, spray out through the boom.',
      'Bleach + TSP soak: 1% household bleach + 1% trisodium phosphate (TSP) in the tank; run pump, then soak.',
      'Rinse #2: clear water through the boom.',
      'Rinse #3: final clear-water pass. Inspect and flush screens and nozzles.'
    ],
    rationale: 'Paraquat requires a 1% bleach + 1% TSP wash plus three water rinses.'
  },
  glufosinate: {
    id: 'glufosinate',
    label: 'Glufosinate / Liberty decon (strict SOP)',
    strict: true,
    steps: [
      'Drain the tank fully. Verify boom is empty.',
      'Detergent wash: fill with clean water + tank-cleaning detergent; run pump and agitate.',
      'Spray the detergent solution out through the boom and nozzles.',
      'Water rinse: one clear-water pass through the boom. Inspect screens and nozzles.'
    ],
    rationale: 'Glufosinate (Liberty) requires a detergent wash followed by a water rinse.'
  },
  'fungicide-load': {
    id: 'copper',
    label: 'Copper fungicide decon (strict SOP)',
    strict: true,
    steps: [
      'Drain the tank fully. Verify boom is empty.',
      'Vinegar rinse: fill with clean water + household vinegar (acetic acid); run pump and agitate.',
      'Spray the vinegar solution out through the boom and nozzles to dissolve copper residue.',
      'Water rinse: one clear-water pass. Inspect screens and nozzles for copper scale.'
    ],
    rationale: 'Copper fungicides require a vinegar rinse to prevent next-pass crop phytotoxicity.'
  }
};

/**
 * Select the decon protocol for a sprayer's last-carried chemistry class.
 * Strict chemistries return their bespoke SOP; every other class — and a
 * clean (undefined) sprayer — returns the generic ammonia protocol.
 */
export function selectDeconProtocol(
  lastChemistryClass: SprayerLoadClass | undefined | null
): DeconProtocol {
  if (!lastChemistryClass) return GENERIC_AMMONIA;
  return STRICT_PROTOCOLS[lastChemistryClass] ?? GENERIC_AMMONIA;
}

/** True when the class carries a stricter-than-generic decon SOP. */
export function hasStrictDeconProtocol(
  lastChemistryClass: SprayerLoadClass | undefined | null
): boolean {
  return selectDeconProtocol(lastChemistryClass).strict;
}
