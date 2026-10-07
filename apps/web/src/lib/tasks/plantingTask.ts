import { t } from '$lib/i18n';

const PREFIX = 'planting:';

export function plantingTaskId(cropId: string): string {
  return `tk_plant_${cropId}`;
}

export function plantingTaskTemplateKey(cropId: string): string {
  return `${PREFIX}${cropId}`;
}

export function isPlantingTaskKey(key: string | null | undefined): boolean {
  return !!key && key.startsWith(PREFIX);
}

/** Stored English title; `plantingTaskDisplayTitle` reads it back. */
export function plantingTaskTitle(input: {
  establishment: 'direct-seed' | 'transplant' | null;
  cropName: string;
  bedName: string;
}): string {
  const { cropName, bedName } = input;
  if (input.establishment === 'direct-seed') return `Sow ${cropName} in ${bedName}`;
  if (input.establishment === 'transplant') return `Transplant ${cropName} to ${bedName}`;
  return `Plant ${cropName} in ${bedName}`;
}

const SOW = /^Sow (.+) in (.+)$/;
const TRANSPLANT = /^Transplant (.+?) to (.+)$/;
const PLANT = /^Plant (.+) in (.+)$/;

export function plantingTaskDisplayTitle(title: string, locale: string): string | null {
  let m = SOW.exec(title);
  if (m) return t(locale, 'tasks.planting.sow', { crop: m[1], bed: m[2] });
  m = TRANSPLANT.exec(title);
  if (m) return t(locale, 'tasks.planting.transplant', { crop: m[1], bed: m[2] });
  m = PLANT.exec(title);
  if (m) return t(locale, 'tasks.planting.plant', { crop: m[1], bed: m[2] });
  return null;
}
