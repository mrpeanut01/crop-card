import { t, type MessageKey } from '$lib/i18n';
import { hracGroupOf } from '$lib/safety/cropFamilyLethality';
import { CHEMISTRY_CLASSES, type ChemistryClass } from '$lib/safety/types';

const KEY: Record<ChemistryClass, MessageKey> = {
  'synthetic-auxin': 'records.chem.syntheticAuxin',
  chloroacetamide: 'records.chem.chloroacetamide',
  'hppd-inhibitor': 'records.chem.hppd',
  'accase-inhibitor': 'records.chem.accase',
  glyphosate: 'records.chem.glyphosate',
  sulfonylurea: 'records.chem.sulfonylurea',
  'microtubule-inhibitor': 'records.chem.microtubule',
  'photosystem-ii-triazine': 'records.chem.psiiTriazine',
  'photosystem-i-diquat': 'records.chem.psiDiquat',
  glufosinate: 'records.chem.glufosinate',
  'ppo-inhibitor': 'records.chem.ppo',
  'als-imidazolinone': 'records.chem.imidazolinone',
  'vlcfa-pyroxasulfone': 'records.chem.pyroxasulfone',
  clomazone: 'records.chem.clomazone',
  unclassified: 'records.chem.unclassified'
};

function isChemistryClass(code: string): code is ChemistryClass {
  return (CHEMISTRY_CLASSES as readonly string[]).includes(code);
}

/** #631: a herbicide chemistry class code ("synthetic-auxin") by name,
 *  with its HRAC group from the kernel table ("Synthetic auxin (HRAC 4)").
 *  Anything else (IRAC/FRAC labels) is returned as given. English without
 *  a locale, which is what the PDF uses. */
export function chemistryClassLabel(code: string, locale?: string | null): string {
  if (!isChemistryClass(code)) return code;
  const name = t(locale, KEY[code]);
  const group = hracGroupOf(code);
  return group === null ? name : `${name} (HRAC ${group})`;
}
