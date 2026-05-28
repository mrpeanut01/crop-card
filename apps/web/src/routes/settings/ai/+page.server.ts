/**
 * Phase 25d (#89 / closes #91 CTA target) — Settings → AI panel.
 *
 * Read: key configuration status + monthly cap progress + per-endpoint
 * daily quotas + recent-call summary.
 * Write: owner saves/clears the per-owner Anthropic API key. Saving
 * also flips `users.ai_enabled = true` for the current user so the
 * AI-on variant takes effect across screens on the next loader run.
 *
 * v2 addendum invariant: "AI assists, never gates" — this panel is
 * purely opt-in. Existing AI-off product mode keeps working regardless
 * of key state.
 */

import { error, fail } from '@sveltejs/kit';
import { and, count, eq, gte } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/db/client';
import { users, aiCallLog } from '$lib/db/schema';
import { getSetting, setSetting } from '$lib/db/settings';
import { getAiDailyCallQuota, getAiMonthlyUsdCap } from '$lib/schedule/settings';
import { spendSnapshot } from '$lib/server/aiGuard';
import { unscopedQueryNote } from '$lib/db/tenant';
import { withTenant } from '$lib/db/tenant';

const KEY_SETTING = 'anthropic_api_key';

function maskKey(raw: string): string {
  if (!raw) return '';
  // sk-ant-…XXXX — show prefix + last 4 chars.
  const prefix = raw.slice(0, 6);
  const suffix = raw.slice(-4);
  return `${prefix}…${suffix}`;
}

function keyStatus(): { source: 'env' | 'setting' | 'none'; masked: string } {
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) return { source: 'env', masked: maskKey(envKey) };
  const setKey = getSetting(KEY_SETTING);
  if (setKey) return { source: 'setting', masked: maskKey(setKey) };
  return { source: 'none', masked: '' };
}

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.user) throw error(401, 'sign-in required');

  const key = keyStatus();
  const spend = spendSnapshot();
  const cap = getAiMonthlyUsdCap();
  const dailyQuotas = getAiDailyCallQuota();

  // Per-user opt-out flag (lands at /settings/ai/+page.svelte as a
  // toggle in a follow-up; for now we just surface its value).
  unscopedQueryNote(
    'users.ai_enabled is a global-identity column read here for the per-user opt-out UI'
  );
  const userRow = db
    .select({ aiEnabled: users.aiEnabled })
    .from(users)
    .where(eq(users.id, locals.user.id))
    .get();

  // Recent calls + degradation breakdown for the audit row.
  const recentCalls = db
    .select({
      endpoint: aiCallLog.endpoint,
      provenance: aiCallLog.provenance,
      fallbackReason: aiCallLog.fallbackReason,
      usdEstimate: aiCallLog.usdEstimate,
      success: aiCallLog.success,
      createdAt: aiCallLog.createdAt
    })
    .from(aiCallLog)
    .where(withTenant(aiCallLog))
    .orderBy(aiCallLog.createdAt)
    .limit(50)
    .all()
    .reverse(); // newest first

  // #167 / CT-SET-004 — canonical month-window call count. Same
  // tenant-scoped query as /settings (after Sprint 17 fix) so both
  // surfaces report identical numbers. recentCalls (limit 50) is for
  // the audit-row display only — not the total.
  const MONTH_MS = 30 * 86_400_000;
  const callsThisMonth =
    db
      .select({ n: count() })
      .from(aiCallLog)
      .where(and(withTenant(aiCallLog), gte(aiCallLog.createdAt, new Date(Date.now() - MONTH_MS))))
      .get()?.n ?? 0;

  return {
    key,
    spend,
    cap,
    dailyQuotas,
    userAiEnabled: !!userRow?.aiEnabled,
    recentCalls,
    callsThisMonth,
    isOwner: locals.user.role === 'owner'
  };
};

export const actions: Actions = {
  saveKey: async ({ locals, request }) => {
    if (!locals.user) return fail(401, { error: 'sign-in required' });
    if (locals.user.role !== 'owner') {
      return fail(403, { error: 'only the Owner role can set the AI key' });
    }
    const form = await request.formData();
    const raw = (form.get('apiKey') ?? '').toString().trim();
    if (!raw) return fail(400, { error: 'API key cannot be empty' });
    if (!raw.startsWith('sk-ant-')) {
      return fail(400, {
        error:
          'expected an Anthropic key (starts with "sk-ant-"). Paste from console.anthropic.com.'
      });
    }
    setSetting(KEY_SETTING, raw);
    // Flip the current user's opt-in on so the AI-on variant takes
    // effect across screens on the next loader run.
    db.update(users).set({ aiEnabled: true }).where(eq(users.id, locals.user.id)).run();
    return { success: true, message: 'API key saved. AI proposals enabled.' };
  },

  clearKey: async ({ locals }) => {
    if (!locals.user) return fail(401, { error: 'sign-in required' });
    if (locals.user.role !== 'owner') {
      return fail(403, { error: 'only the Owner role can clear the AI key' });
    }
    setSetting(KEY_SETTING, '');
    return { success: true, message: 'API key cleared. AI proposals disabled.' };
  },

  toggleOptIn: async ({ locals, request }) => {
    if (!locals.user) return fail(401, { error: 'sign-in required' });
    const form = await request.formData();
    const next = form.get('next') === 'true';
    db.update(users).set({ aiEnabled: next }).where(eq(users.id, locals.user.id)).run();
    return { success: true, message: next ? 'AI proposals enabled.' : 'AI proposals paused.' };
  }
};
