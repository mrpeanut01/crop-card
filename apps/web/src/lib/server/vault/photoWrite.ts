import { error, json } from '@sveltejs/kit';
import { getDocument } from '$lib/db/documents';
import { JPEG_DATA_URL_PREFIX, decodeBase64 } from '$lib/journal/photo';
import { VAULT_MESSAGES, discardDocument, openDocument, saveDocument } from './documents';
import { vaultStore } from './store';

export type PhotoDocumentKind = 'journal-photo' | 'animal-photo';
export type StoredPhotoRef = { documentId: string } | { inline: string };

/** "Photo of Henrietta", "Photo of tag 42", or "Animal photo". */
export function animalPhotoTitle(animal: { name: string | null; tag: string | null }): string {
  const name = animal.name?.trim();
  if (name) return `Photo of ${name}`.slice(0, 120);
  const tag = animal.tag?.trim();
  return tag ? `Photo of tag ${tag}`.slice(0, 120) : 'Animal photo';
}

/** The JPEG bytes of a photo data URL, or null when it is not one. */
export function photoDataUrlBytes(dataUrl: string): Uint8Array | null {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(JPEG_DATA_URL_PREFIX)) return null;
  return decodeBase64(dataUrl.slice(JPEG_DATA_URL_PREFIX.length));
}

/**
 * Puts an already-sanitized photo data URL into the active Owner's vault.
 * Photos count toward the plan's storage but are never refused by it
 * (A-44). With the vault off, or on any refusal or store failure, the photo
 * comes back inline so the caller stores it in `photo_ref` as before (A-45):
 * a photo is never lost.
 */
export async function storePhoto(
  kind: PhotoDocumentKind,
  dataUrl: string,
  meta: { title: string; uploadedBy: string | null }
): Promise<StoredPhotoRef> {
  if (!vaultStore()) return { inline: dataUrl };
  const bytes = photoDataUrlBytes(dataUrl);
  if (!bytes || bytes.length === 0) return { inline: dataUrl };
  try {
    const saved = await saveDocument({
      kind,
      title: meta.title,
      originalName: null,
      uploadedBy: meta.uploadedBy,
      body: bytes,
      declaredLength: bytes.length,
      allow: ['image/jpeg'],
      capBytes: null
    });
    if (saved.ok) return { documentId: saved.document.id };
    console.warn(`[vault] ${kind} kept inline: ${saved.code}`);
  } catch (err) {
    console.warn(`[vault] ${kind} kept inline: ${(err as Error)?.message ?? err}`);
  }
  return { inline: dataUrl };
}

/** Marks a photo document deleted and removes its bytes. Never throws: a
 *  leftover is caught by the daily sweep. */
export async function discardPhoto(
  documentId: string | null | undefined,
  deletedBy: string | null
): Promise<void> {
  if (!documentId) return;
  try {
    await discardDocument(documentId, deletedBy);
  } catch (err) {
    console.error(
      `[vault] could not discard photo ${documentId}: ${(err as Error)?.message ?? err}`
    );
  }
}

const PHOTO_HEADERS = {
  'content-type': 'image/jpeg',
  'cache-control': 'private, max-age=86400',
  'x-content-type-options': 'nosniff'
} as const;

/** The response for a photo route: the vault bytes or the inline data URL,
 *  both as image/jpeg with the headers the routes always sent. Throws 404
 *  when there is no photo, 503 VAULT_OFF when the photo is in the vault and the vault is
 *  off. */
export async function photoResponse(ref: StoredPhotoRef | null): Promise<Response> {
  const notFound = (): never => {
    throw error(404, 'photo not found');
  };
  if (!ref) return notFound();
  if ('inline' in ref) {
    const bytes = photoDataUrlBytes(ref.inline);
    if (!bytes) return notFound();
    return new Response(bytes.buffer as ArrayBuffer, {
      headers: { ...PHOTO_HEADERS, 'content-length': String(bytes.byteLength) }
    });
  }
  if (!vaultStore()) {
    return json(
      { error: VAULT_MESSAGES.VAULT_OFF, code: 'VAULT_OFF' },
      { status: 503, headers: { 'retry-after': '300' } }
    );
  }
  const doc = getDocument(ref.documentId);
  if (!doc) return notFound();
  const body = await openDocument(doc);
  if (!body) return notFound();
  return new Response(body, {
    headers: { ...PHOTO_HEADERS, 'content-length': String(doc.byteSize) }
  });
}
