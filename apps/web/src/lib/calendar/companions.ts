/**
 * Companion-system advisor (FR-15).
 *
 * Pure function over the plugin registry: given a primary crop family and
 * the registered companion-system plugins, suggest companion plantings +
 * day offsets for established interplanting systems.
 *
 * B8 (Phase 17, Track 1) — companion systems are now data-driven. Plugins
 * under `plugins/companions/` declare `primaryFamily` + `members[]`; this
 * module reads them at call-time. Adding Wheat-clover or sunflower-bee-strip
 * companion systems is a JSON file, not a TypeScript change.
 *
 * The advisor never fires the actual plantings — it returns suggestions
 * the UI can present to the Owner for one-tap acceptance.
 */

import type { CompanionPlugin, CropPlugin } from '$lib/plugins/schemas';
import type { CropFamily } from '$lib/safety/cropFamilyLethality';

/**
 * Legacy fallback for callers that don't (yet) thread the companion plugin
 * registry. Shape matches `plugins/companions/three-sisters.json`. Once
 * every caller loads from the registry, this can be removed.
 */
const LEGACY_FALLBACK_SYSTEMS: ReadonlyArray<CompanionPlugin> = [
  {
    pluginId: 'three-sisters',
    type: 'companion',
    displayName: 'Three Sisters',
    version: '1.1.0',
    goodWith: ['corn', 'beans', 'squash'],
    badWith: [],
    primaryFamily: 'corn',
    benefit:
      'Beans fix nitrogen + climb cornstalks; squash/pumpkin vines suppress weeds at the ground layer.',
    members: [
      { family: 'legume', role: 'trellis + n-fixer', plantingOffsetDays: 14 },
      { family: 'cucurbit', role: 'ground-cover', plantingOffsetDays: 35 }
    ]
  }
];

export interface CompanionSuggestion {
  systemName: string;
  systemBenefit: string;
  members: ReadonlyArray<{
    cropPluginId: string;
    displayName: string;
    cropFamily: CropFamily;
    plantingOffsetDays: number;
    role: string;
  }>;
}

/**
 * For each companion-system plugin whose `primaryFamily` matches and whose
 * member families are all available in the crop registry, return one
 * suggestion. Returns [] when no system is satisfiable.
 */
export function suggestCompanions(
  primaryCropFamily: CropFamily,
  availableCrops: ReadonlyArray<CropPlugin>,
  companionSystems?: ReadonlyArray<CompanionPlugin>
): ReadonlyArray<CompanionSuggestion> {
  const systems = companionSystems ?? LEGACY_FALLBACK_SYSTEMS;
  const suggestions: CompanionSuggestion[] = [];
  for (const sys of systems) {
    if (!sys.primaryFamily || !sys.members?.length) continue;
    if (sys.primaryFamily !== primaryCropFamily) continue;

    type Member = CompanionSuggestion['members'][number];
    const members: Member[] = [];
    let allFound = true;
    for (const m of sys.members) {
      const candidate = availableCrops.find((c) => c.cropFamily === m.family);
      if (!candidate) {
        allFound = false;
        break;
      }
      members.push({
        cropPluginId: candidate.pluginId,
        displayName: candidate.displayName,
        cropFamily: candidate.cropFamily,
        plantingOffsetDays: m.plantingOffsetDays,
        role: m.role
      });
    }
    if (allFound) {
      suggestions.push({
        systemName: sys.displayName,
        systemBenefit: sys.benefit ?? '',
        members
      });
    }
  }
  return suggestions;
}
