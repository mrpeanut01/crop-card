/** Client-safe profile rules shared by the settings form and the server. */

export const DISPLAY_NAME_MAX = 60;
export const AVATAR_MAX_BYTES = 512 * 1024;

export type AvatarMime = 'image/jpeg' | 'image/png' | 'image/webp';

export type DisplayNameResult = { ok: true; value: string | null } | { ok: false; error: string };

/** Trims and collapses whitespace; empty clears the name back to the
 *  identity fallback. Control characters are refused rather than stripped
 *  so a pasted value never silently changes. */
export function normalizeDisplayName(raw: unknown): DisplayNameResult {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, error: 'Name must be text.' };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) {
    return { ok: false, error: 'Name contains characters that cannot be displayed.' };
  }
  const value = raw.trim().replace(/\s+/g, ' ');
  if (!value) return { ok: true, value: null };
  if ([...value].length > DISPLAY_NAME_MAX) {
    return { ok: false, error: `Keep the name to ${DISPLAY_NAME_MAX} characters or fewer.` };
  }
  return { ok: true, value };
}

/** Identifies the image type from its leading bytes. The declared
 *  Content-Type is never trusted, and SVG is never accepted. */
export function sniffAvatarMime(bytes: Uint8Array): AvatarMime | null {
  const at = (i: number) => bytes[i];
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => at(i) === b)
  ) {
    return 'image/png';
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}
