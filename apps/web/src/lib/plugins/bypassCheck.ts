import {
  CHEMISTRY_KILL_MATRIX,
  type CropFamily
} from '$lib/safety/cropFamilyLethality';
import type { ChemistryClass } from '$lib/safety/types';
import type { HerbicidePlugin, Plugin } from './schemas';

/**
 * Catches plugins that try to declare a herbicide "safe for crop X" while
 * its declared chemistry class is one the safety kernel will reject for X.
 * Without this check a malicious or sloppy plugin could whitelist itself
 * past kernel rules at the UI layer (e.g., hide the "blocked" warning).
 *
 * The kernel is still authoritative at spray time — this is defense in
 * depth, run at registration so bad plugins fail fast with a clear message.
 *
 * Two layers:
 *   1. Matrix-driven: if a `cropFamilyResolver` is provided (registry passes
 *      its lookup), each cropPluginId is resolved to a CropFamily and tested
 *      against the chemistry kill matrix. This catches all real cases.
 *   2. Hardcoded fallback: a small list of well-known sloppy claims for
 *      cases where the crop plugin isn't registered yet (e.g., installation
 *      ordering). Removable once we require crops-before-herbicides ordering.
 */

export interface BypassError {
  pluginId: string;
  cropPluginId: string;
  chemistryClass: ChemistryClass;
  reason: string;
}

interface HardcodedBan {
  cropPluginId: string;
  bannedClasses: ReadonlySet<ChemistryClass>;
  reason: string;
}

const HARDCODED_BANS: readonly HardcodedBan[] = [
  {
    cropPluginId: 'pumpkin',
    bannedClasses: new Set<ChemistryClass>(['synthetic-auxin', 'chloroacetamide', 'hppd-inhibitor']),
    reason: 'lethal to cucurbits per kernel kill matrix'
  },
  {
    cropPluginId: 'tomato',
    bannedClasses: new Set<ChemistryClass>(['synthetic-auxin']),
    reason: 'synthetic-auxin causes severe injury to solanaceae'
  }
];

export type CropFamilyResolver = (cropPluginId: string) => CropFamily | undefined;

export function detectBypass(
  plugin: Plugin,
  resolveCropFamily?: CropFamilyResolver
): BypassError[] {
  if (plugin.type !== 'herbicide') return [];
  const claims = (plugin as HerbicidePlugin).labelClaims?.safeForCropPluginIds ?? [];
  if (claims.length === 0) return [];

  const errors: BypassError[] = [];
  const seen = new Set<string>();

  for (const cropId of claims) {
    // Layer 1: matrix-driven via registry-resolved family
    const family = resolveCropFamily?.(cropId);
    if (family) {
      for (const ai of plugin.activeIngredients) {
        if (CHEMISTRY_KILL_MATRIX[ai.chemistryClass].killsFamilies.includes(family)) {
          const key = `${cropId}|${ai.chemistryClass}`;
          if (seen.has(key)) continue;
          seen.add(key);
          errors.push({
            pluginId: plugin.pluginId,
            cropPluginId: cropId,
            chemistryClass: ai.chemistryClass,
            reason: `${ai.chemistryClass} is lethal to ${family} per kernel kill matrix`
          });
        }
      }
    }

    // Layer 2: hardcoded fallback (independent of resolver)
    const hardcoded = HARDCODED_BANS.find((b) => b.cropPluginId === cropId);
    if (!hardcoded) continue;
    for (const ai of plugin.activeIngredients) {
      if (hardcoded.bannedClasses.has(ai.chemistryClass)) {
        const key = `${cropId}|${ai.chemistryClass}`;
        if (seen.has(key)) continue;
        seen.add(key);
        errors.push({
          pluginId: plugin.pluginId,
          cropPluginId: cropId,
          chemistryClass: ai.chemistryClass,
          reason: hardcoded.reason
        });
      }
    }
  }
  return errors;
}
