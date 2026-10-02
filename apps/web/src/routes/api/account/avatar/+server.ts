import { json, type RequestHandler } from '@sveltejs/kit';
import { requireInteractiveUser } from '$lib/server/auth';
import { avatarUrl, deleteAvatar, saveAvatar } from '$lib/db/userProfile';
import { AVATAR_MAX_BYTES, sniffAvatarMime } from '$lib/profile';
import { t } from '$lib/i18n';

/** POST <image bytes> — replace the signed-in user's profile picture. */
export const POST: RequestHandler = async (event) => {
  const user = requireInteractiveUser(event);
  const declared = Number(event.request.headers.get('content-length') ?? 0);
  if (declared > AVATAR_MAX_BYTES) {
    return json(
      { error: t(event.locals?.locale, 'settings.avatar.err.tooLarge') },
      { status: 413 }
    );
  }
  const bytes = new Uint8Array(await event.request.arrayBuffer());
  if (bytes.length === 0)
    return json({ error: t(event.locals?.locale, 'settings.avatar.err.none') }, { status: 400 });
  if (bytes.length > AVATAR_MAX_BYTES) {
    return json(
      { error: t(event.locals?.locale, 'settings.avatar.err.tooLarge') },
      { status: 413 }
    );
  }
  const mime = sniffAvatarMime(bytes);
  if (!mime) {
    return json({ error: t(event.locals?.locale, 'settings.avatar.err.type') }, { status: 415 });
  }
  const version = saveAvatar(user.id, mime, Buffer.from(bytes));
  return json({ ok: true, avatarUrl: avatarUrl(user.id, version) });
};

/** DELETE — remove the picture; the initial-letter badge comes back. */
export const DELETE: RequestHandler = (event) => {
  const user = requireInteractiveUser(event);
  deleteAvatar(user.id);
  return json({ ok: true, avatarUrl: null });
};
