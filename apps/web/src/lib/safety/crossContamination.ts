import type { HerbicideProduct, SafetyViolation, SprayerLoadClass, SprayerState } from './types';

/**
 * Cross-contamination gate. If the planned chemistry classes differ from the
 * sprayer's last load and no decon has been recorded since, the kernel asks
 * the UI to route to the decon wizard instead of the dilution table.
 *
 * Returns either a list of violations OR a decon-required signal — the
 * caller decides routing. The `requiresDecon` flag in SafetyResult is set
 * when this rule fires.
 */
export interface ContaminationCheck {
  violations: SafetyViolation[];
  requiresDecon: boolean;
}

/**
 * Core evaluator over an explicit set of planned load classes. The
 * herbicide path derives these from `activeIngredients[].chemistryClass`;
 * the insecticide / fungicide paths (#321) pass the coarse
 * `insecticide-load` / `fungicide-load` token so a different chemistry
 * category still trips the decon requirement.
 */
export function checkCrossContaminationForClasses(
  plannedClasses: readonly SprayerLoadClass[],
  sprayer: SprayerState
): ContaminationCheck {
  const last = sprayer.lastChemistryClass;
  if (!last) return { violations: [], requiresDecon: false };

  const planned = new Set<SprayerLoadClass>(plannedClasses);

  if (planned.has(last)) return { violations: [], requiresDecon: false };

  const decontaminatedAfterLast =
    typeof sprayer.lastSprayedAt === 'number' &&
    typeof sprayer.lastDeconAt === 'number' &&
    sprayer.lastDeconAt >= sprayer.lastSprayedAt;
  if (decontaminatedAfterLast) return { violations: [], requiresDecon: false };

  return {
    violations: [
      {
        code: 'CROSS_CONTAMINATION',
        message: `Sprayer last carried ${last}; decon required before different chemistry`,
        detail: {
          sprayerId: sprayer.id,
          lastChemistryClass: last,
          plannedChemistryClasses: Array.from(planned)
        }
      }
    ],
    requiresDecon: true
  };
}

export function checkCrossContamination(
  products: HerbicideProduct[],
  sprayer: SprayerState
): ContaminationCheck {
  const plannedClasses = products.flatMap((p) =>
    p.activeIngredients.map((ai) => ai.chemistryClass)
  );
  return checkCrossContaminationForClasses(plannedClasses, sprayer);
}
