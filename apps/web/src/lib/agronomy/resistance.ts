/**
 * Resistance-rotation hints (Phase 9).
 *
 * Sibling to safety/ — NOT part of the plugin-immune kill-matrix kernel.
 * The kill matrix covers herbicide-vs-crop lethality. This module covers
 * the *pesticide stewardship* concern: don't apply two products from the
 * same FRAC/IRAC mode-of-action group back-to-back, or you'll select for
 * resistant pest/pathogen populations.
 *
 * Rules are advisory — the UI should show a soft warning, not block.
 *
 * Data sources:
 *   - FRAC Code List 2025 (https://www.frac.info/)
 *   - IRAC Mode of Action Classification v10.5 (37 groups)
 *   - HRAC global classification (covered by safety kernel via hracGroup)
 */

import type { FungicidePlugin, InsecticidePlugin, HerbicidePlugin } from '$lib/plugins/schemas';
import { hracGroupOf } from '$lib/safety/cropFamilyLethality';

export interface RotationWarning {
  group: string;
  groupKind: 'HRAC' | 'IRAC' | 'FRAC';
  productPluginIds: string[];
  message: string;
}

/**
 * Detects when the planned spray reuses a mode-of-action group that was
 * already used in the prior application(s) on the same block. Caller passes
 * the prior groups list (typically from the last 2 spray events for the
 * block).
 */
export function checkResistanceRotation(args: {
  herbicides?: HerbicidePlugin[];
  insecticides?: InsecticidePlugin[];
  fungicides?: FungicidePlugin[];
  /** Mode-of-action groups used on this block in the prior 1-2 applications. */
  priorGroups: ReadonlyArray<{ kind: 'HRAC' | 'IRAC' | 'FRAC'; group: string }>;
}): RotationWarning[] {
  const warnings: RotationWarning[] = [];
  const priorByKind = new Map<string, Set<string>>();
  for (const p of args.priorGroups) {
    const k = p.kind;
    if (!priorByKind.has(k)) priorByKind.set(k, new Set());
    priorByKind.get(k)!.add(p.group);
  }

  // Herbicides — HRAC group lookup via the kill matrix profile.
  const hracPrior = priorByKind.get('HRAC') ?? new Set<string>();
  for (const h of args.herbicides ?? []) {
    for (const ai of h.activeIngredients) {
      const g = String(hracGroupOf(ai.chemistryClass));
      if (hracPrior.has(g)) {
        warnings.push({
          group: g,
          groupKind: 'HRAC',
          productPluginIds: [h.pluginId],
          message: `${h.displayName} is HRAC ${g} — same group as a prior application on this block. Rotate to a different mode of action to slow resistance.`
        });
      }
    }
  }

  // Insecticides — IRAC code declared on each ingredient.
  const iracPrior = priorByKind.get('IRAC') ?? new Set<string>();
  for (const i of args.insecticides ?? []) {
    for (const ai of i.activeIngredients) {
      if (!ai.iracGroup) continue;
      if (iracPrior.has(ai.iracGroup)) {
        warnings.push({
          group: ai.iracGroup,
          groupKind: 'IRAC',
          productPluginIds: [i.pluginId],
          message: `${i.displayName} is IRAC ${ai.iracGroup} — same group as a prior insecticide. Rotate per IRAC stewardship guidelines.`
        });
      }
    }
  }

  // Fungicides — FRAC code declared on each ingredient.
  const fracPrior = priorByKind.get('FRAC') ?? new Set<string>();
  for (const f of args.fungicides ?? []) {
    for (const ai of f.activeIngredients) {
      if (fracPrior.has(ai.fracCode)) {
        warnings.push({
          group: ai.fracCode,
          groupKind: 'FRAC',
          productPluginIds: [f.pluginId],
          message: `${f.displayName} is FRAC ${ai.fracCode} — same group as a prior fungicide. Alternate mode of action per FRAC code list.`
        });
      }
    }
  }

  return warnings;
}

/**
 * Group display labels for FRAC and IRAC groups commonly seen in this app's
 * starter library. Used by the UI to render readable badges (e.g. "FRAC 11
 * — QoI / strobilurin").
 */
export const FRAC_LABELS: Readonly<Record<string, string>> = {
  '1': 'MBC / benzimidazole',
  '3': 'DMI / triazole',
  '4': 'phenylamide',
  '7': 'SDHI',
  '9': 'anilinopyrimidine',
  '11': 'QoI / strobilurin',
  '12': 'phenylpyrrole',
  '17': 'hydroxyanilide',
  '21': 'QiI / quinone-inside',
  '40': 'CAA / carboxylic acid amide',
  M01: 'copper (multi-site)',
  M02: 'sulfur (multi-site)',
  M03: 'dithiocarbamate (multi-site)',
  M04: 'phthalimide (multi-site)',
  M05: 'chloronitrile (multi-site)',
  P01: 'host plant defense inducer',
  U06: 'cyflufenamid (unknown)',
  BM01: 'biological multi-site'
};

export const IRAC_LABELS: Readonly<Record<string, string>> = {
  '1A': 'carbamate',
  '1B': 'organophosphate',
  '3A': 'pyrethroid',
  '4A': 'neonicotinoid',
  '4D': 'butenolide',
  '5': 'spinosyn',
  '6': 'avermectin',
  '11A': 'Bacillus thuringiensis',
  '15': 'IGR / benzoylurea',
  '22': 'oxadiazine',
  '23': 'tetronic / tetramic',
  '28': 'diamide',
  '29': 'flonicamid',
  UN: 'unknown / botanical'
};
