/**
 * Companion-system advisor (FR-15).
 *
 * Pure function over the plugin registry: given a primary crop family,
 * suggest companion plantings + day offsets for established interplanting
 * systems. Today only Three Sisters is encoded; future systems plug in by
 * adding to SYSTEMS.
 *
 * The advisor never fires the actual plantings — it returns suggestions
 * the UI can present to the Owner for one-tap acceptance.
 */

import type { CropPlugin } from '$lib/plugins/schemas';
import type { CropFamily } from '$lib/safety/cropFamilyLethality';

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

interface SystemDefinition {
  name: string;
  benefit: string;
  primaryFamily: CropFamily;
  members: ReadonlyArray<{
    family: CropFamily;
    role: string;
    plantingOffsetDays: number;
  }>;
}

const SYSTEMS: ReadonlyArray<SystemDefinition> = [
  {
    name: 'Three Sisters',
    benefit:
      'Beans fix nitrogen + climb cornstalks; squash/pumpkin vines suppress weeds at the ground layer.',
    primaryFamily: 'corn',
    members: [
      { family: 'legume', role: 'trellis + n-fixer', plantingOffsetDays: 14 },
      { family: 'cucurbit', role: 'ground-cover', plantingOffsetDays: 35 }
    ]
  }
];

/**
 * For each suggested member family, pick the first registered crop plugin
 * matching that family. Returns null if any required member is unavailable
 * (the planner needs to install/author the plugin first).
 */
export function suggestCompanions(
  primaryCropFamily: CropFamily,
  availableCrops: ReadonlyArray<CropPlugin>
): ReadonlyArray<CompanionSuggestion> {
  const suggestions: CompanionSuggestion[] = [];
  for (const sys of SYSTEMS) {
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
        systemName: sys.name,
        systemBenefit: sys.benefit,
        members
      });
    }
  }
  return suggestions;
}
