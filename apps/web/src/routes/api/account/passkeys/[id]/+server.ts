import { json, type RequestHandler } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { passkeyRenameSchema } from '$lib/auth/apiSchemas';
import { requireInteractiveUser } from '$lib/server/auth';
import { deletePasskey, renamePasskey } from '$lib/server/passkeys';

export const _requestSchema = passkeyRenameSchema;

/** PATCH { name } — rename one of your own passkeys; null or blank clears
 *  the name. Another person's id answers 404. */
export const PATCH: RequestHandler = async (event) => {
  const user = requireInteractiveUser(event);
  const locale = event.locals?.locale;
  const parsed = _requestSchema.safeParse(await event.request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: t(locale, 'passkey.err.badRequest') }, { status: 400 });
  }
  const name = parsed.data.name?.trim() || null;
  if (!renamePasskey(user.id, event.params.id ?? '', name)) {
    return json({ error: t(locale, 'passkey.err.notFound') }, { status: 404 });
  }
  return json({ ok: true });
};

/** DELETE — remove one of your own passkeys. Sessions stay signed in
 *  (P38-10). */
export const DELETE: RequestHandler = (event) => {
  const user = requireInteractiveUser(event);
  if (!deletePasskey(user.id, event.params.id ?? '')) {
    return json({ error: t(event.locals?.locale, 'passkey.err.notFound') }, { status: 404 });
  }
  return json({ ok: true });
};
