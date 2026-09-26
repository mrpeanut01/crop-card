import { json, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { getCrop, type Crop } from '$lib/db/crops';
import { insertJournalEntry } from '$lib/db/plantingJournal';
import { ensureSystemUser } from '$lib/db/users';
import { MAX_JOURNAL_TEXT, MAX_PHOTO_QUESTION, PHOTO_QUESTIONS } from '$lib/journal/model';
import { MAX_PHOTO_DATA_URL_CHARS, sanitizePhotoDataUrl } from '$lib/journal/photo';
import { currentUser } from './auth';
import { canMutate } from './session';

const photoField = z
  .string()
  .max(MAX_PHOTO_DATA_URL_CHARS + 8)
  .nullable()
  .optional();

export const journalEntrySchema = z
  .object({
    kind: z.enum(['note', 'observation', 'photo_help']).default('note'),
    text: z.string().max(MAX_JOURNAL_TEXT).default(''),
    photo: photoField,
    occurredAt: z.number().int().positive().optional()
  })
  .refine((v) => v.text.trim().length > 0 || !!v.photo, {
    message: 'add a note or a photo'
  });

export const queuedJournalSchema = z
  .object({ cropId: z.string().min(1).max(128) })
  .and(journalEntrySchema);

export const photoHelpSchema = z.object({
  question: z.enum(PHOTO_QUESTIONS),
  text: z.string().max(MAX_PHOTO_QUESTION).default(''),
  photo: photoField
});

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
  cropId: string,
  userId: string,
  data: z.infer<typeof journalEntrySchema>
): Promise<Response> {
  const crop = cropOr404(cropId);
  if (crop instanceof Response) return crop;
  const photo = cleanPhoto(data.photo);
  if (!photo.ok) return photo.response;
  const entry = insertJournalEntry({
    cropId: crop.id,
    blockId: crop.blockId,
    createdBy: userId,
    kind: data.kind,
    text: data.text.trim(),
    photoRef: photo.photo,
    provenance: 'manual',
    createdAt: data.occurredAt !== undefined ? Math.min(data.occurredAt, Date.now()) : undefined
  });
  return json({ entry }, { status: 201 });
}
