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
 *   no-till                    — all products allowed (burndown herbicides
 *                                  stand in for tillage, so nothing is gated)
 *   non-gmo                    — requires `complianceFlags.nonGmoCompliant === true`
 *   organic-transitioning      — requires `transitioningAllowed === true`
 *                                  OR `omriListed === true`; a fertilizer
 *                                  the library marks neither way is never
 *                                  planned, but the farmer may pick it by
 *                                  hand (`philosophyProductClass`)
 *   certified-organic          — requires `omriListed === true` AND
 *                                  `certifiedOrganicAllowed !== false`
 *
 * "Absent flag = unknown". The planner treats unknown as excluded — a
 * safe default that avoids retroactively breaking existing plugins. The
 * UI surfaces a "no compliant product available" warning instead of
 * silently substituting the wrong product.
 *
 * Ruling OT-1 (docs/design/LABEL_FOLLOWUP_RULINGS.md): the fertilizer
 * source-class field is never read here. 7 CFR 205.202(b) gives land in
 * transition the same prohibited-substance rule as certified land, so only
 * a sourced flag admits a product to an organic-transitioning plan.
 *
 * Phase 33B (B-18): the flags are read through
 * `$lib/organic/inputCompliance`, the same reader organic records use, and
 * an `organic-transitioning` plan never offers a product the library marks
 * `not-allowed`. The certified-organic planner stays stricter (OMRI).
 */

import type { Philosophy } from './setup';
import { organicInputClass } from '$lib/organic/inputCompliance';
import type {
  FertilizerPlugin,
  FungicidePlugin,
  HerbicidePlugin,
  InsecticidePlugin
} from '$lib/plugins/schemas';

/** Any plugin type that carries `complianceFlags`. */
export type FilterableInputPlugin =
  HerbicidePlugin | InsecticidePlugin | FungicidePlugin | FertilizerPlugin;

/**
 * Returns true iff `plugin` is allowed under `philosophy`. See file
 * docstring for the matrix.
 */
export function isProductAllowed(plugin: FilterableInputPlugin, philosophy: Philosophy): boolean {
  if (philosophy === 'conventional' || philosophy === 'no-till') return true;

  const flags = plugin.complianceFlags;

  if (philosophy === 'non-gmo') {
    return flags?.nonGmoCompliant === true;
  }

  if (philosophy === 'organic-transitioning') {
    if (organicInputClass(plugin) === 'not-allowed') return false;
    if (flags?.transitioningAllowed === true) return true;
    return flags?.omriListed === true;
  }

  if (philosophy === 'certified-organic') {
    return flags?.omriListed === true && organicInputClass(plugin) === 'allowed';
  }

  // Exhaustiveness check — TS catches missing branches at compile time;
  // the runtime fallback is the conservative deny.
  const _exhaustive: never = philosophy;
  void _exhaustive;
  return false;
}

export type PhilosophyProductClass = 'allowed' | 'not-marked' | 'not-allowed';

/**
 * OT-1: `allowed` products may be planned. A `not-marked` product is a
 * fertilizer the library marks neither way for organic use under an
 * organic-transitioning season: the planner and Claude never choose it,
 * and the farmer may pick it by hand beside "Ask your certifier."
 */
export function philosophyProductClass(
  plugin: FilterableInputPlugin,
  philosophy: Philosophy
): PhilosophyProductClass {
  if (isProductAllowed(plugin, philosophy)) return 'allowed';
  if (
    philosophy === 'organic-transitioning' &&
    plugin.type === 'fertilizer' &&
    organicInputClass(plugin) === 'not-marked'
  ) {
    return 'not-marked';
  }
  return 'not-allowed';
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
  if (philosophy === 'conventional' || philosophy === 'no-till') return ''; // never reached
  const flags = plugin.complianceFlags;

  if (philosophy === 'non-gmo') {
    if (flags?.nonGmoCompliant === undefined) {
      return `${plugin.displayName} has no nonGmoCompliant flag set — author must verify.`;
    }
    return `${plugin.displayName} is not flagged non-GMO compliant.`;
  }

  if (philosophy === 'organic-transitioning') {
    if (organicInputClass(plugin) === 'not-allowed') {
      return `${plugin.displayName} is marked not allowed for organic use in the library.`;
    }
    return `${plugin.displayName} is not OMRI-listed and not flagged transitioning-allowed.`;
  }

  if (philosophy === 'certified-organic') {
    if (flags?.omriListed !== true) {
      return `${plugin.displayName} is not OMRI-listed.`;
    }
    if (organicInputClass(plugin) === 'not-allowed') {
      return `${plugin.displayName} is explicitly excluded from certified-organic use.`;
    }
  }

  return `${plugin.displayName} is not allowed under ${philosophy}.`;
}
