import { killsFamily, type CropFamily } from '$lib/safety/cropFamilyLethality';
import { ingredientKillsFamily, ingredientStopsCropPlugin } from '$lib/safety/ingredientLethality';
import { CHEMISTRY_CLASSES, type ChemistryClass } from '$lib/safety/types';

export interface HarmHerbicide {
  chemistryClasses: ReadonlyArray<string | null | undefined>;
  activeNames: ReadonlyArray<string>;
}

export interface HarmCrop {
  pluginId: string;
  displayName: string;
  family?: CropFamily;
}

export interface HerbicideHarm {
  families: string[];
  ruledOut: string[];
}

/** The /spray card hint: the families of the picked crops a herbicide would
 *  harm, and (ruling LF-1) the picked crops its label rules out by name. It
 *  reads the same kernel tables as `checkCropCompatibility`. */
export function herbicideHarm(h: HarmHerbicide, crops: ReadonlyArray<HarmCrop>): HerbicideHarm {
  const families = new Set<string>();
  const ruledOut = new Set<string>();
  const picked = [...new Set(crops.flatMap((c) => (c.family ? [c.family] : [])))];
  for (const cls of h.chemistryClasses) {
    if (!cls || !(CHEMISTRY_CLASSES as readonly string[]).includes(cls)) continue;
    for (const f of picked) if (killsFamily(cls as ChemistryClass, f)) families.add(f);
  }
  for (const name of h.activeNames) {
    for (const f of picked) if (ingredientKillsFamily(name, f)) families.add(f);
    for (const c of crops) {
      const stop = ingredientStopsCropPlugin(name, c.pluginId, c.family);
      if (!stop) continue;
      families.add(stop);
      ruledOut.add(c.displayName);
    }
  }
  return { families: [...families].sort(), ruledOut: [...ruledOut].sort() };
}
