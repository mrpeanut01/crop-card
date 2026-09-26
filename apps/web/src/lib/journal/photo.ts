/** Journal photos: one downscaled JPEG, never with EXIF or other metadata.
 *  Pure and isomorphic so the client and the server apply the same rules. */

export const MAX_PHOTO_BYTES = 300 * 1024;
export const MAX_PHOTO_DIM = 1024;
export const JPEG_DATA_URL_PREFIX = 'data:image/jpeg;base64,';
/** Hard cap on the stored string: the byte cap in base64 plus the prefix. */
export const MAX_PHOTO_DATA_URL_CHARS =
  JPEG_DATA_URL_PREFIX.length + Math.ceil(MAX_PHOTO_BYTES / 3) * 4;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function decodeBase64(b64: string): Uint8Array | null {
  if (!b64 || b64.length % 4 !== 0 || !BASE64.test(b64)) return null;
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    return null;
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function isDroppedMarker(marker: number): boolean {
  return (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
}

/** Copies a JPEG without APP1-APP15 (EXIF, XMP, ICC, maker notes) and
 *  comment segments. Null when the bytes are not a well-formed JPEG. */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    let j = i;
    while (j < bytes.length && bytes[j] === 0xff) j++;
    if (j >= bytes.length) return null;
    const marker = bytes[j];
    const segStart = j - 1;
    if (marker === 0xd9) {
      parts.push(bytes.subarray(segStart, j + 1));
      i = j + 1;
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(bytes.subarray(segStart, j + 1));
      i = j + 1;
      continue;
    }
    if (j + 2 >= bytes.length) return null;
    const len = (bytes[j + 1] << 8) | bytes[j + 2];
    if (len < 2) return null;
    const end = j + 1 + len;
    if (end > bytes.length) return null;
    if (marker === 0xda) {
      parts.push(bytes.subarray(segStart));
      i = bytes.length;
      break;
    }
    if (!isDroppedMarker(marker)) parts.push(bytes.subarray(segStart, end));
    i = end;
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function hasJpegMetadata(bytes: Uint8Array): boolean {
  const stripped = stripJpegMetadata(bytes);
  return stripped !== null && stripped.length !== bytes.length;
}

export type PhotoCheck =
  { ok: true; dataUrl: string; bytes: number } | { ok: false; error: 'not-jpeg' | 'too-large' };

/** Validates a client photo and returns it re-encoded without metadata. */
export function sanitizePhotoDataUrl(input: string): PhotoCheck {
  if (typeof input !== 'string' || !input.startsWith(JPEG_DATA_URL_PREFIX)) {
    return { ok: false, error: 'not-jpeg' };
  }
  if (input.length > MAX_PHOTO_DATA_URL_CHARS + 8) return { ok: false, error: 'too-large' };
  const bytes = decodeBase64(input.slice(JPEG_DATA_URL_PREFIX.length));
  if (!bytes) return { ok: false, error: 'not-jpeg' };
  if (bytes.length > MAX_PHOTO_BYTES) return { ok: false, error: 'too-large' };
  const clean = stripJpegMetadata(bytes);
  if (!clean) return { ok: false, error: 'not-jpeg' };
  return {
    ok: true,
    dataUrl: JPEG_DATA_URL_PREFIX + encodeBase64(clean),
    bytes: clean.length
  };
}

/** Largest size inside `maxDim` on the long side, never upscaled. */
export function fitWithin(
  width: number,
  height: number,
  maxDim = MAX_PHOTO_DIM
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, maxDim / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}
