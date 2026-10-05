import { json, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { getCrop, type Crop } from '$lib/db/crops';
import { insertJournalEntry } from '$lib/db/plantingJournal';
import { ensureSystemUser } from '$lib/db/users';
import { journalEntrySchema, photoHelpSchema, queuedJournalSchema } from '$lib/journal/apiSchemas';
import { sanitizePhotoDataUrl } from '$lib/journal/photo';
import { currentUser } from './auth';
import { writeRecord } from './recordWrite';
import { canMutate } from './session';
import { t } from '$lib/i18n';
import { discardPhoto, storePhoto } from './vault/photoWrite';

export { journalEntrySchema, photoHelpSchema, queuedJournalSchema };

export type JournalWriteAuth = { ok: true; userId: string } | { ok: false; response: Response };

/** Owners and helpers may write to the journal; inspectors read only. */
export async function journalWriter(event: RequestEvent): Promise<JournalWriteAuth> {
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return {
      ok: false,
      response: json(
        { error: t(event.locals?.locale, 'stockui.api.inspectorReadOnly') },
        { status: 403 }
      )
    };
  }
  const who = auth ?? (await ensureSystemUser());
  return { ok: true, userId: who.id };
}

export async function readJson(event: RequestEvent): Promise<unknown> {
  try {
    return await event.request.json();
  } catch {
    return undefined;
  }
}

export function badRequest(error: z.ZodError, locale?: string): Response {
  return json(
    {
      error: t(locale, 'stockui.api.invalidRequest'),
      issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    },
    { status: 400 }
  );
}

export type PhotoResult = { ok: true; photo: string | null } | { ok: false; response: Response };

export function cleanPhoto(photo: string | null | undefined, locale?: string): PhotoResult {
  if (!photo) return { ok: true, photo: null };
  const checked = sanitizePhotoDataUrl(photo);
  if (!checked.ok) {
    const error =
      checked.error === 'too-large'
        ? t(locale, 'api.errB.photoTooLarge')
        : t(locale, 'api.errB.photoUnreadable');
    return { ok: false, response: json({ error, code: checked.error }, { status: 400 }) };
  }
  return { ok: true, photo: checked.dataUrl };
}

export function cropOr404(id: string | undefined, locale?: string): Crop | Response {
  const crop = id ? getCrop(id) : undefined;
  return crop ?? json({ error: t(locale, 'api.errB.plantingNotFound') }, { status: 404 });
}

export async function addJournalEntry(
  event: { request: Request; locals?: { locale?: string } },
  cropId: string,
  userId: string,
  data: z.infer<typeof journalEntrySchema>
): Promise<Response> {
  const crop = cropOr404(cropId, event.locals?.locale);
  if (crop instanceof Response) return crop;
  const photo = cleanPhoto(data.photo, event.locals?.locale);
  if (!photo.ok) return photo.response;
  const stored = photo.photo
    ? await storePhoto('journal-photo', photo.photo, {
        title: 'Journal photo',
        uploadedBy: userId
      })
    : null;
  let entry;
  try {
    entry = writeRecord(event, () =>
      insertJournalEntry({
        cropId: crop.id,
        blockId: crop.blockId,
        createdBy: userId,
        kind: data.kind,
        text: data.text.trim(),
        photoRef: stored && 'inline' in stored ? stored.inline : null,
        photoDocumentId: stored && 'documentId' in stored ? stored.documentId : null,
        provenance: 'manual',
        createdAt: data.occurredAt !== undefined ? Math.min(data.occurredAt, Date.now()) : undefined
      })
    );
  } catch (err) {
    if (stored && 'documentId' in stored) await discardPhoto(stored.documentId, userId);
    throw err;
  }
  return json({ entry }, { status: 201 });
}
