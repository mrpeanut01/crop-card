import { CHEMISTRY_KILL_MATRIX, type CropFamily, type ChemistryClass } from './safetySnapshot';
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
 * Three layers of claim:
 *   - `labelClaims.safeForCropPluginIds: string[]` — untrait-gated. Family
 *     kill matrix is enforced; any chemistry that kills the crop's family
 *     causes a registration error.
 *   - `traitGatedSafeFor: { cropPluginId, requiresTraits }[]` (Phase 11) —
 *     the registration check passes ONLY if the crop cultivar declares
 *     every listed trait. Without the trait, the herbicide cannot claim
 *     this crop. With the trait, the family-kill check is skipped for
 *     this (product, crop) pair at spray time.
 *   - `HARDCODED_BANS` — a small set of well-known sloppy claims for cases
 *     where the crop plugin isn't registered yet (installation ordering).
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
    bannedClasses: new Set<ChemistryClass>([
      'synthetic-auxin',
      'chloroacetamide',
      'hppd-inhibitor'
    ]),
    reason: 'lethal to cucurbits per kernel kill matrix'
  },
  {
    cropPluginId: 'tomato',
    bannedClasses: new Set<ChemistryClass>(['synthetic-auxin']),
    reason: 'synthetic-auxin causes severe injury to solanaceae'
  }
];

export type CropFamilyResolver = (cropPluginId: string) => CropFamily | undefined;
export type CropTraitsResolver = (cropPluginId: string) => readonly string[];

export interface BypassResolvers {
  cropFamily?: CropFamilyResolver;
  cropTraits?: CropTraitsResolver;
}

function checkFamilyKill(
  plugin: HerbicidePlugin,
  cropId: string,
  family: CropFamily,
  errors: BypassError[],
  seen: Set<string>
): void {
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

function checkHardcodedBans(
  plugin: HerbicidePlugin,
  cropId: string,
  errors: BypassError[],
  seen: Set<string>
): void {
  const hardcoded = HARDCODED_BANS.find((b) => b.cropPluginId === cropId);
  if (!hardcoded) return;
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

export function detectBypass(
  plugin: Plugin,
  resolvers?: BypassResolvers | CropFamilyResolver
): BypassError[] {
  if (plugin.type !== 'herbicide') return [];

  // Back-compat: callers that pass a bare resolver function get treated
  // as if they'd passed { cropFamily: fn }. New callers pass the object.
  const r: BypassResolvers =
    typeof resolvers === 'function' ? { cropFamily: resolvers } : (resolvers ?? {});

  const herb = plugin as HerbicidePlugin;
  const plainClaims = herb.labelClaims?.safeForCropPluginIds ?? [];
  const traitClaims = herb.traitGatedSafeFor ?? [];
  if (plainClaims.length === 0 && traitClaims.length === 0) return [];

  const errors: BypassError[] = [];
  const seen = new Set<string>();

  // Plain claims — full family-kill enforcement.
  for (const cropId of plainClaims) {
    const family = r.cropFamily?.(cropId);
    if (family) checkFamilyKill(herb, cropId, family, errors, seen);
    checkHardcodedBans(herb, cropId, errors, seen);
  }

  // Trait-gated claims — the cultivar must carry every listed trait.
  // If the registry can't resolve traits (e.g., crop registered later),
  // we accept the claim provisionally; the runtime kernel will still
  // refuse to skip the family-kill check unless the trait is present.
  for (const claim of traitClaims) {
    const have = r.cropTraits ? new Set(r.cropTraits(claim.cropPluginId)) : null;
    if (have !== null) {
      const missing = claim.requiresTraits.filter((t) => !have.has(t));
      if (missing.length > 0) {
        errors.push({
          pluginId: plugin.pluginId,
          cropPluginId: claim.cropPluginId,
          chemistryClass: plugin.activeIngredients[0]?.chemistryClass ?? 'glyphosate',
          reason: `traitGatedSafeFor requires ${missing.join(', ')} but ${claim.cropPluginId} declares only [${[...have].join(', ') || '—'}]`
        });
      }
    }
  }

  return errors;
}
