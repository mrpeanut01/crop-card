/**
 * HEIC/HEIF recognition for the photo pickers and the document vault (#572
 * panel ruling H-1). Only Safari decodes HEIC; in Chrome and Firefox a HEIC
 * photo (an iPhone photo copied to a PC, an Android phone set to HEIF) gets
 * a message that says what to do instead of "could not be read". Nothing
 * here decodes or uploads HEIC.
 */

const HEIC_TYPES = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence'
]);
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs']);

function brandOf(head: Uint8Array): string | null {
  if (head.length < 12) return null;
  const box = String.fromCharCode(...head.subarray(4, 8));
  return box === 'ftyp' ? String.fromCharCode(...head.subarray(8, 12)) : null;
}

/** True for a HEIC/HEIF file by its type, its name or its `ftyp` brand. */
export function looksLikeHeic(file: { type?: string; name?: string }, head?: Uint8Array): boolean {
  if (file.type && HEIC_TYPES.has(file.type.toLowerCase())) return true;
  if (file.name && /\.hei[cf]s?$/i.test(file.name.trim())) return true;
  const brand = head ? brandOf(head) : null;
  return brand !== null && HEIC_BRANDS.has(brand);
}

/** `looksLikeHeic` for a picked file, reading its first bytes. */
export async function fileLooksLikeHeic(file: Blob & { name?: string }): Promise<boolean> {
  if (looksLikeHeic(file)) return true;
  try {
    return looksLikeHeic({}, new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  } catch {
    return false;
  }
}
