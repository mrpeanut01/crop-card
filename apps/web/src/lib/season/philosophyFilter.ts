/**
 * Philosophy → product filter (Phase 21 / B-25).
 *
 * Single source of truth for "is this input plugin allowed under this
 * Season Setup philosophy?". Consumed by:
 *
 *   - the deterministic inputs planner (`lib/plan/inputsPlan.ts`, B-26),
 *     to filter the candidate product pool per slot,
 *   - the AI inputs refinement layer (`lib/server/aiInputsPlan.ts`, B-27),
 *     as the first validator in the philosophy → kernel → tank-mix → date
 *     → rate pyramid,
 *   - the wizard step UI (`InputsPlanStep.svelte`, B-28), to gate the
 *     inline product picker so the operator can't substitute a non-
 *     compliant alternative.
 *
 * Allow-deny matrix:
 *
 *   conventional               — all products allowed
 *   non-gmo                    — requires `complianceFlags.nonGmoCompliant === true`
 *   organic-transitioning      — requires `transitioningAllowed === true`
 *                                  OR `omriListed === true`
 *   certified-organic          — requires `omriListed === true` AND
 *                                  `certifiedOrganicAllowed !== false`
 *
 * "Absent flag = unknown". The planner treats unknown as excluded — a
 * safe default that avoids retroactively breaking existing plugins. The
 * UI surfaces a "no compliant product available" warning instead of
 * silently substituting the wrong product.
 *
 * Fertilizer plugins additionally honor their existing `organic: boolean`
 * flag: when philosophy demands organic, `organic === true` is required
 * even when `complianceFlags` are missing. This keeps the existing
 * fertilizer library usable under organic philosophies without a
 * mass-backfill of `complianceFlags`.
 */

import type { Philosophy } from './setup';
import type {
  FertilizerPlugin,
  FungicidePlugin,
  HerbicidePlugin,
  InsecticidePlugin
} from '$lib/plugins/schemas';

/** Any plugin type that carries `complianceFlags`. */
export type FilterableInputPlugin =
  | HerbicidePlugin
  | InsecticidePlugin
  | FungicidePlugin
  | FertilizerPlugin;

/**
 * Returns true iff `plugin` is allowed under `philosophy`. See file
 * docstring for the matrix.
 */
export function isProductAllowed(plugin: FilterableInputPlugin, philosophy: Philosophy): boolean {
  if (philosophy === 'conventional') return true;

  const flags = plugin.complianceFlags;

  if (philosophy === 'non-gmo') {
    return flags?.nonGmoCompliant === true;
  }

  if (philosophy === 'organic-transitioning') {
    if (flags?.transitioningAllowed === true) return true;
    if (flags?.omriListed === true) return true;
    // Fertilizer-specific escape: `organic: true` is the historical
    // signal for organic-compatible amendments; honor it during the
    // transition window even without an OMRI listing.
    if (plugin.type === 'fertilizer' && plugin.organic) return true;
    return false;
  }

  if (philosophy === 'certified-organic') {
    if (flags?.omriListed === true && flags?.certifiedOrganicAllowed !== false) return true;
    return false;
  }

  // Exhaustiveness check — TS catches missing branches at compile time;
  // the runtime fallback is the conservative deny.
  const _exhaustive: never = philosophy;
  void _exhaustive;
  return false;
}

/**
 * Filter a list of input plugins to those allowed under `philosophy`.
 * Pure convenience wrapper around `isProductAllowed`. Order is preserved.
 */
export function filterByPhilosophy<T extends FilterableInputPlugin>(
  plugins: T[],
  philosophy: Philosophy
): T[] {
  return plugins.filter((p) => isProductAllowed(p, philosophy));
}

/** Reason string for the "no compliant product" warning. Used by the
 *  inputs planner when no candidate survives the filter for a needed slot. */
export function philosophyRejectionReason(
  plugin: FilterableInputPlugin,
  philosophy: Philosophy
): string {
  if (philosophy === 'conventional') return ''; // never reached
  const flags = plugin.complianceFlags;

  if (philosophy === 'non-gmo') {
    if (flags?.nonGmoCompliant === undefined) {
      return `${plugin.displayName} has no nonGmoCompliant flag set — author must verify.`;
    }
    return `${plugin.displayName} is not flagged non-GMO compliant.`;
  }

  if (philosophy === 'organic-transitioning') {
    return `${plugin.displayName} is not OMRI-listed and not flagged transitioning-allowed.`;
  }

  if (philosophy === 'certified-organic') {
    if (flags?.omriListed !== true) {
      return `${plugin.displayName} is not OMRI-listed.`;
    }
    if (flags?.certifiedOrganicAllowed === false) {
      return `${plugin.displayName} is explicitly excluded from certified-organic use.`;
    }
  }

  return `${plugin.displayName} is not allowed under ${philosophy}.`;
}
