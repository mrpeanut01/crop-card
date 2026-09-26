import { z } from 'zod';
import { MAX_JOURNAL_TEXT, MAX_PHOTO_QUESTION, PHOTO_QUESTIONS } from './model';
import { MAX_PHOTO_DATA_URL_CHARS } from './photo';

/** Request bodies of the planting journal and photo help endpoints. Kept free
 *  of server imports so the OpenAPI generator can publish them. */

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
