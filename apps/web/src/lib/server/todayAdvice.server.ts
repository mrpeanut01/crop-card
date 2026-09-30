/**
 * The /today advice hook (Phase 32E, E4-15). A static provider list: E4
 * registers watering, E5 appends degree days. A provider that throws adds
 * no cards and never breaks /today.
 */

import {
  sortAdvice,
  type TodayAdviceCard,
  type TodayAdviceContext,
  type TodayAdviceProvider
} from '$lib/today/advice';
import { wateringAdvice } from './waterAdvice.server';
import { degreeDayAdvice } from './degreeDays.server';

export const TODAY_ADVICE_PROVIDERS: readonly TodayAdviceProvider[] = [
  wateringAdvice,
  degreeDayAdvice
];

export async function runAdviceProviders(
  providers: readonly TodayAdviceProvider[],
  ctx: TodayAdviceContext
): Promise<TodayAdviceCard[]> {
  const settled = await Promise.all(
    providers.map(async (p) => {
      try {
        return await p(ctx);
      } catch (e) {
        console.error('[today] advice provider failed:', e);
        return [];
      }
    })
  );
  return sortAdvice(settled.flat());
}

export function loadTodayAdvice(ctx: TodayAdviceContext): Promise<TodayAdviceCard[]> {
  return runAdviceProviders(TODAY_ADVICE_PROVIDERS, ctx);
}
