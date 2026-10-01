import { z } from 'zod';
import {
  DOCUMENT_KINDS,
  DOCUMENT_SUBJECT_TYPES,
  PHOTO_DOCUMENT_KINDS,
  type DocumentKind,
  type DocumentSubjectType
} from './kinds';

export { DOCUMENT_KINDS, DOCUMENT_SUBJECT_TYPES, PHOTO_DOCUMENT_KINDS };

const UPLOAD_KINDS = DOCUMENT_KINDS.filter(
  (k) => !(PHOTO_DOCUMENT_KINDS as readonly string[]).includes(k)
) as Exclude<DocumentKind, (typeof PHOTO_DOCUMENT_KINDS)[number]>[];

const optionalText = (max: number) =>
  z
    .string()
    .max(max * 4)
    .transform((s) => s.trim())
    .pipe(z.string().max(max))
    .optional();

/** Query of `POST /api/documents`. The file itself is the raw request body
 *  (A-29); its declared Content-Type is ignored. */
export const documentUploadQuerySchema = z
  .object({
    kind: z.enum(UPLOAD_KINDS as [string, ...string[]]),
    title: optionalText(120),
    name: optionalText(200),
    subjectType: z.enum(DOCUMENT_SUBJECT_TYPES).optional(),
    subjectId: z.string().min(1).max(200).optional()
  })
  .refine((q) => (q.subjectType === undefined) === (q.subjectId === undefined), {
    message: 'subjectType and subjectId go together',
    path: ['subjectId']
  });

export type DocumentUploadQuery = z.infer<typeof documentUploadQuerySchema>;

/** Body of `POST /api/documents/[id]/links`. */
export const documentLinkCreateSchema = z
  .object({
    subjectType: z.enum(DOCUMENT_SUBJECT_TYPES),
    subjectId: z.string().min(1).max(200)
  })
  .strict();

export type DocumentLinkCreate = z.infer<typeof documentLinkCreateSchema>;

/** Query of `GET /api/documents`. */
export const documentListQuerySchema = z
  .object({
    kind: z.enum(DOCUMENT_KINDS).optional(),
    subjectType: z.enum(DOCUMENT_SUBJECT_TYPES).optional(),
    subjectId: z.string().min(1).max(200).optional(),
    includeDeleted: z.enum(['0', '1']).optional(),
    before: z.coerce.number().int().positive().optional(),
    beforeId: z.string().min(1).max(200).optional()
  })
  .refine((q) => (q.subjectType === undefined) === (q.subjectId === undefined), {
    message: 'subjectType and subjectId go together',
    path: ['subjectId']
  });

export type DocumentListQuery = z.infer<typeof documentListQuerySchema>;

/** `PATCH /api/fertility/soil-tests/[id]`: attach, replace or remove the
 *  lab report (A-36). */
export const soilTestDocumentPatchSchema = z
  .object({ documentId: z.string().min(1).max(200).nullable() })
  .strict();

export const DOCUMENTS_PAGE_SIZE = 100;

export interface DocumentPerson {
  id: string;
  label: string;
}

export interface DocumentLinkMeta {
  id: string;
  subjectType: DocumentSubjectType;
  subjectId: string;
  subjectExists: boolean;
}

/** Contract C-6. `storage_key` is never sent to a client. */
export interface DocumentMeta {
  id: string;
  kind: DocumentKind;
  title: string;
  mime: string;
  byteSize: number;
  sha256: string;
  originalName: string | null;
  createdAt: string;
  uploadedBy: DocumentPerson | null;
  deletedAt: string | null;
  deletedBy: DocumentPerson | null;
  links: DocumentLinkMeta[];
}

const person = z.object({ id: z.string(), label: z.string() }).nullable();

/** Response shape of the metadata routes, for OpenAPI. */
export const documentMetaSchema = z.object({
  id: z.string(),
  kind: z.enum(DOCUMENT_KINDS),
  title: z.string(),
  mime: z.string(),
  byteSize: z.number().int(),
  sha256: z.string(),
  originalName: z.string().nullable(),
  createdAt: z.string(),
  uploadedBy: person,
  deletedAt: z.string().nullable(),
  deletedBy: person,
  links: z.array(
    z.object({
      id: z.string(),
      subjectType: z.enum(DOCUMENT_SUBJECT_TYPES),
      subjectId: z.string(),
      subjectExists: z.boolean()
    })
  )
});

export const DOCUMENT_ERROR_CODES = [
  'VAULT_OFF',
  'FENCED',
  'LENGTH_REQUIRED',
  'TOO_LARGE',
  'STORAGE_FULL',
  'UNSUPPORTED_TYPE',
  'EMPTY',
  'TRUNCATED',
  'ABORTED',
  'OWNER_ONLY',
  'INTERACTIVE_OWNER_ONLY',
  'PHOTO_DOCUMENT',
  'DOCUMENT_DELETED',
  'NOT_FOUND',
  'FOREIGN_REF',
  'INVALID'
] as const;
