/**
 * Phase 25c (#88) — /settings/integrations loader.
 *
 * External-system integrations: the Claude API key (details live on
 * /settings/ai), the Phase 24 Bearer-token surface, and the static
 * list of data feeds.
 */

import { error, fail, redirect } from '@sveltejs/kit';
import { and, count, gte } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/db/client';
import { aiCallLog } from '$lib/db/schema';
import { withTenant } from '$lib/db/tenant';
import { listTokensForOwner } from '$lib/server/apiTokens';
import { spendSnapshot } from '$lib/server/aiGuard';
import { aiKeyStatus, saveAiKey } from '$lib/server/aiKey';

const MONTH_MS = 30 * 86_400_000;

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.user) throw redirect(303, '/');
  if (locals.user.role !== 'owner') throw error(403, 'owner-only');
  const ownerId = locals.user.activeOwnerId;
  const key = aiKeyStatus();
  const spend = spendSnapshot();
  const callsThisMonth =
    db
      .select({ n: count() })
      .from(aiCallLog)
      .where(and(withTenant(aiCallLog), gte(aiCallLog.createdAt, new Date(Date.now() - MONTH_MS))))
      .get()?.n ?? 0;
  return {
    tokenCount: ownerId ? listTokensForOwner(ownerId).length : 0,
    ai: {
      enabled: key.source !== 'none',
      fromEnv: key.source === 'env',
      keyMasked: key.source === 'setting' ? key.masked : '',
      spendThisMonth: spend.monthlyUsdSoFar,
      monthlyCapUSD: spend.cap,
      pctUsed: spend.pctUsed,
      warnAt80: spend.warnAt80,
      callsThisMonth
    }
  };
};

export const actions: Actions = {
  saveKey: ({ locals, request }) => {
    if (aiKeyStatus().source === 'env') {
      return fail(400, { error: 'AI help is included with your plan, so no key is needed.' });
    }
    return saveAiKey(locals.user, request);
  }
};
