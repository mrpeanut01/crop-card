import { checkChemistryCompatibility } from './chemistry';
import { checkCropCompatibility } from './cropCompatibility';
import { checkCropStage } from './cropStage';
import { checkCrossContamination } from './crossContamination';
import { checkEnvironment } from './environment';
import { checkTankMix, type PriorApplication } from './tankMix';
import type { SafetyResult, SprayContext } from './types';

export interface EvaluateOptions {
  priorApplications?: PriorApplication[];
}

/**
 * Top-level safety gate. The server endpoint that records spray events MUST
 * call this and reject when `ok === false`, regardless of UI state. Callers
 * should branch on `requiresDecon` to route the operator to the decon wizard
 * rather than rendering the dilution table.
 */
export function evaluateSpray(
  ctx: SprayContext,
  options: EvaluateOptions = {}
): SafetyResult {
  const violations = [
    ...checkCropCompatibility(ctx.products, ctx.crop, ctx.coPlantedCrops),
    ...checkChemistryCompatibility(ctx.products),
    ...checkCropStage(ctx.products, ctx.crop),
    ...checkTankMix(ctx.products, ctx.occurredAt, options.priorApplications),
    ...checkEnvironment(ctx.conditions)
  ];

  const contamination = checkCrossContamination(ctx.products, ctx.sprayer);
  violations.push(...contamination.violations);

  return {
    ok: violations.length === 0,
    violations,
    requiresDecon: contamination.requiresDecon
  };
}
