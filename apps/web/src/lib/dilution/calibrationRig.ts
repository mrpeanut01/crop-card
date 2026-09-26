/** How a sprayer is calibrated on the 1/128-acre course: walked with a
 *  hand sprayer catching all of its output, or driven with a boom, ATV or
 *  3-point rig and timed, then one nozzle caught for that time. */
export type CalibrationRig = 'walk' | 'drive';

const DRIVE_PATTERN =
  /\b(atv|utv|boom|pull|pull-type|3-?pt|3-point|three-point|tractor|airblast|trailer)\b|\d+\s*-?gal-(atv|pull|3pt)/i;
const WALK_PATTERN = /\b(backpack|hand|handheld|pump-up|knapsack|wand)\b/i;

export function calibrationRig(s: {
  templateId?: string | null;
  label?: string | null;
  tankGal?: number | null;
}): CalibrationRig {
  const id = s.templateId ?? '';
  if (/backpack/i.test(id)) return 'walk';
  if (/atv|pull|3pt|airblast/i.test(id)) return 'drive';
  const label = s.label ?? '';
  if (WALK_PATTERN.test(label)) return 'walk';
  if (DRIVE_PATTERN.test(label)) return 'drive';
  if (typeof s.tankGal === 'number' && s.tankGal > 10) return 'drive';
  return 'walk';
}
