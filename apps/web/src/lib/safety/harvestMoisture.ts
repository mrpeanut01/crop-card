/**
 * UC-16 — harvest moisture safety gate.
 *
 * Family-keyed maximum moisture thresholds for safe storage. Above these
 * thresholds, harvested material spoils (mold, heating, mycotoxin growth
 * on small-grain; sprouting on dry legumes; combustion risk on hay).
 *
 * Sprint 19 (Phase 26A) — promoted to a hard safety-kernel rule:
 *   - SAFE   — below threshold; harvest commits.
 *   - WARN   — within 1.0% of threshold; commit proceeds with a banner.
 *   - BLOCK  — over threshold; /api/harvest/record returns 422.
 *
 * Thresholds align with USDA storage guidelines (small-grain: 13.5% mc
 * wb; dry legume: 15% wb; forage hay: 18% wb; cure-then-store: 70%
 * after cure-down). All values are wet-basis percentages.
 *
 * The kernel only fires when the operator supplied moisture (the
 * `moisturePct` field on /api/harvest/record). Missing moisture is
 * not a kernel violation — it surfaces as the existing "moisture not
 * captured" warning chip on the renderer.
 */

import type { Archetype } from '$lib/plugins/schemas';
import { resolveArchetype } from '$lib/plugins/schemas';

export type HarvestMoistureDecision = 'safe' | 'warn' | 'block';

export interface HarvestMoistureResult {
  decision: HarvestMoistureDecision;
  thresholdPct: number;
  reason: string;
  warnBufferPct: number;
}

/**
 * Per-archetype maximum wet-basis moisture % for safe storage. Source:
 * Penn State Extension small-plot grain handling; UMD forage handbook;
 * NCDA dry-bean storage guide.
 *
 * Keyed on the Phase-27A explicit archetype enum (Invariant 8). For
 * plugins that pre-date the explicit enum, `resolveArchetype()` derives
 * a fallback from cropFamily + harvestStyle.
 */
const ARCHETYPE_MOISTURE_MAX: Partial<Record<Archetype, number>> = {
  'small-grain.zadoks': 13.5,
  'row-grain.pollination': 15.0,
  'dry-seed-legume': 15.0,
  'forage-cutting-cycle': 18.0,
  // Winter squash + cure-then-store crops finish at much higher % during
  // cure; the gate only catches outright spoilage above 70%.
  'winter-squash-cure': 70.0
};

const WARN_BUFFER_PCT = 1.0;

export const HARVEST_MOISTURE_BLOCK = 'HARVEST_MOISTURE_OVER_THRESHOLD' as const;

interface PluginShape {
  archetype?: Archetype | undefined;
  cropFamily?: string | undefined;
}

export interface HarvestMoistureInput {
  moisturePct: number;
  cropPlugin: PluginShape;
}

/**
 * Resolve the storage threshold for the given crop plugin. Returns null
 * when the resolved archetype has no kernel gate (moisture is then
 * informational only — surfaces as the existing renderer chip).
 */
export function thresholdForPlugin(plugin: PluginShape): number | null {
  const archetype = resolveArchetype(plugin);
  return ARCHETYPE_MOISTURE_MAX[archetype] ?? null;
}

export function evaluateHarvestMoisture(input: HarvestMoistureInput): HarvestMoistureResult | null {
  const threshold = thresholdForPlugin(input.cropPlugin);
  if (threshold == null) return null;

  const m = input.moisturePct;
  if (!Number.isFinite(m) || m < 0) {
    // Caller-side validation should reject this upstream; treat as no-gate
    // rather than blocking on a typo.
    return null;
  }

  if (m > threshold) {
    return {
      decision: 'block',
      thresholdPct: threshold,
      warnBufferPct: WARN_BUFFER_PCT,
      reason: `Stored moisture ${m.toFixed(1)}% > ${threshold.toFixed(1)}% safe-storage threshold for this crop family. Drying required before commit.`
    };
  }
  if (m >= threshold - WARN_BUFFER_PCT) {
    return {
      decision: 'warn',
      thresholdPct: threshold,
      warnBufferPct: WARN_BUFFER_PCT,
      reason: `Stored moisture ${m.toFixed(1)}% within ${WARN_BUFFER_PCT.toFixed(1)}% of the ${threshold.toFixed(1)}% threshold. Monitor for heating.`
    };
  }
  return {
    decision: 'safe',
    thresholdPct: threshold,
    warnBufferPct: WARN_BUFFER_PCT,
    reason: `Stored moisture ${m.toFixed(1)}% safely below ${threshold.toFixed(1)}% threshold.`
  };
}
