import { t } from '$lib/i18n';
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
export function aiLimitReason(limit: AiLimit, locale?: string | null): string {
  switch (limit.detail) {
    case 'monthly-budget':
      return t(locale, 'billing.limit.monthly');
    case 'owner-disabled':
      return t(locale, 'billing.limit.ownerOff');
    case 'plan-excluded':
      return limit.plan
        ? t(locale, 'billing.limit.planExcludedNamed', { plan: PLANS[limit.plan].name })
        : t(locale, 'billing.limit.planExcluded');
    case 'free-pool':
      return t(locale, 'billing.limit.freePool');
    case 'global':
      return t(locale, 'billing.limit.global');
    case 'daily-quota':
    case 'token-quota':
      return t(locale, 'billing.limit.daily');
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
