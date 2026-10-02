import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { users } from '$lib/db/schema';
import { getSetting, setSetting } from '$lib/db/settings';
import { t } from '$lib/i18n';
import type { AuthenticatedUser } from '$lib/server/auth';

export const AI_KEY_SETTING = 'anthropic_api_key';

export function maskKey(raw: string): string {
  if (!raw) return '';
  return `${raw.slice(0, 6)}…${raw.slice(-4)}`;
}

export function aiKeyStatus(): { source: 'env' | 'setting' | 'none'; masked: string } {
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) return { source: 'env', masked: maskKey(envKey) };
  const setKey = getSetting(AI_KEY_SETTING);
  if (setKey) return { source: 'setting', masked: maskKey(setKey) };
  return { source: 'none', masked: '' };
}

export async function saveAiKey(
  user: AuthenticatedUser | null | undefined,
  request: Request,
  locale?: string | null
) {
  if (!user) return fail(401, { error: t(locale, 'settings.ai.msg.signInRequired') });
  if (user.role !== 'owner') {
    return fail(403, { error: t(locale, 'settings.ai.msg.ownerSetKey') });
  }
  const form = await request.formData();
  const raw = (form.get('apiKey') ?? '').toString().trim();
  if (!raw) return fail(400, { error: t(locale, 'settings.ai.msg.keyEmpty') });
  if (!raw.startsWith('sk-ant-')) {
    return fail(400, { error: t(locale, 'settings.ai.msg.keyFormat') });
  }
  setSetting(AI_KEY_SETTING, raw);
  // Flip the saver's opt-in on so the AI-on variant takes effect on the next loader run.
  db.update(users).set({ aiEnabled: true }).where(eq(users.id, user.id)).run();
  return { success: true, message: t(locale, 'settings.ai.msg.keySaved') };
}
