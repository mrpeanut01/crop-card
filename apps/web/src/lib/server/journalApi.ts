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

export { journalEntrySchema, photoHelpSchema, queuedJournalSchema };

export type JournalWriteAuth = { ok: true; userId: string } | { ok: false; response: Response };

/** Owners and helpers may write to the journal; inspectors read only. */
export async function journalWriter(event: RequestEvent): Promise<JournalWriteAuth> {
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return { ok: false, response: json({ error: 'inspector role is read-only' }, { status: 403 }) };
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

export function badRequest(error: z.ZodError): Response {
  return json(
    {
      error: 'invalid request',
      issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    },
    { status: 400 }
  );
}

export type PhotoResult = { ok: true; photo: string | null } | { ok: false; response: Response };

export function cleanPhoto(photo: string | null | undefined): PhotoResult {
  if (!photo) return { ok: true, photo: null };
  const checked = sanitizePhotoDataUrl(photo);
  if (!checked.ok) {
    const error =
      checked.error === 'too-large'
        ? 'That photo is too large. Try again and it will be made smaller.'
        : 'That photo could not be read. Use a JPEG photo.';
    return { ok: false, response: json({ error, code: checked.error }, { status: 400 }) };
  }
  return { ok: true, photo: checked.dataUrl };
}

export function cropOr404(id: string | undefined): Crop | Response {
  const crop = id ? getCrop(id) : undefined;
  return crop ?? json({ error: 'planting not found' }, { status: 404 });
}

export async function addJournalEntry(
  event: { request: Request },
  cropId: string,
  userId: string,
  data: z.infer<typeof journalEntrySchema>
): Promise<Response> {
  const crop = cropOr404(cropId);
  if (crop instanceof Response) return crop;
  const photo = cleanPhoto(data.photo);
  if (!photo.ok) return photo.response;
  const entry = writeRecord(event, () =>
    insertJournalEntry({
      cropId: crop.id,
      blockId: crop.blockId,
      createdBy: userId,
      kind: data.kind,
      text: data.text.trim(),
      photoRef: photo.photo,
      provenance: 'manual',
      createdAt: data.occurredAt !== undefined ? Math.min(data.occurredAt, Date.now()) : undefined
    })
  );
  return json({ entry }, { status: 201 });
}
