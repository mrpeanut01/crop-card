/**
 * GET /api/records/:kind/:id/card: the read-only Card a /records row expands
 * into, for the active Owner. Helpers may read it, like /records itself.
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { prefsFor } from '$lib/db/userProfile';
import {
  buildIrrigationRecordCards,
  buildRecordCards,
  isRecordKind
} from '$lib/server/recordCards';
import { recordedAtOf } from '$lib/db/holdParams';
import { canVoidHolds, voidableUntilMs } from '$lib/server/holdVoid';
import { t } from '$lib/i18n';

const VOIDABLE_KINDS = ['spray', 'insecticide', 'fungicide'] as const;
type VoidableKind = (typeof VOIDABLE_KINDS)[number];

export const GET: RequestHandler = async (event) => {
  const user = requireUser(event);
  const { kind, id } = event.params;
  if (!kind || !id) throw error(404, t(event.locals?.locale, 'api.errB.noSuchRecord'));
  const opts = {
    prefs: { ...prefsFor(user.id), locale: event.locals.locale ?? 'en' },
    origin: process.env.ORIGIN?.trim().replace(/\/+$/, '') || null
  };
  let result;
  if (kind === 'irrigation') result = buildIrrigationRecordCards(id, opts);
  else if (isRecordKind(kind)) result = await buildRecordCards(kind, id, opts);
  else throw error(404, t(event.locals?.locale, 'api.errB.noSuchRecord'));
  if (!result) throw error(404, t(event.locals?.locale, 'api.errB.noSuchRecord'));
  const voidKind = (VOIDABLE_KINDS as readonly string[]).includes(kind)
    ? (kind as VoidableKind)
    : null;
  return json(
    {
      ...result,
      voidableUntilMs: voidKind ? voidableUntilMs(recordedAtOf(voidKind, id)) : null,
      canVoidHolds: canVoidHolds(event, user)
    },
    {
      headers: { 'cache-control': 'private, no-store', vary: 'Cookie, Authorization' }
    }
  );
};
