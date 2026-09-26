import { PLANS, type PaidPlanId, type PlanId } from './plans';

export type AiLimitDetail =
  | 'global'
  | 'owner-disabled'
  | 'plan-excluded'
  | 'monthly-budget'
  | 'free-pool'
  | 'daily-quota'
  | 'token-quota';

/** Why the farm's AI help did not run, for the banner and the upgrade nudge. */
export interface AiLimit {
  detail: AiLimitDetail;
  plan: PlanId | null;
  upgrade: PaidPlanId | null;
}

/** A short clause with no end punctuation, to lead a fallback sentence. */
export function aiLimitReason(limit: AiLimit): string {
  switch (limit.detail) {
    case 'monthly-budget':
      return "This month's AI help for your farm is used up";
    case 'owner-disabled':
      return 'AI help is turned off for this farm';
    case 'plan-excluded':
      return limit.plan
        ? `This AI help isn't on the ${PLANS[limit.plan].name} plan`
        : "This AI help isn't on your plan";
    case 'free-pool':
      return 'Free AI help is resting until the 1st';
    case 'global':
      return 'AI help is paused for this month';
    case 'daily-quota':
    case 'token-quota':
      return "Today's AI help for this is used up";
  }
}

const LIFTED_BY_PLAN: readonly AiLimitDetail[] = [
  'monthly-budget',
  'plan-excluded',
  'free-pool',
  'daily-quota'
];

/** Only limits that a bigger plan actually lifts get an upgrade nudge. */
export function aiLimitUpgrade(limit: AiLimit | null | undefined): PaidPlanId | null {
  if (!limit?.upgrade) return null;
  return LIFTED_BY_PLAN.includes(limit.detail) ? limit.upgrade : null;
}
