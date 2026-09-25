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

export const DEFAULT_TIME_ZONE = 'America/New_York';

export const TIME_ZONES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'America/New_York', label: 'Eastern (New York)' },
  { id: 'America/Chicago', label: 'Central (Chicago)' },
  { id: 'America/Denver', label: 'Mountain (Denver)' },
  { id: 'America/Phoenix', label: 'Arizona (Phoenix, no DST)' },
  { id: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { id: 'America/Anchorage', label: 'Alaska (Anchorage)' },
  { id: 'Pacific/Honolulu', label: 'Hawaii (Honolulu)' },
  { id: 'America/Puerto_Rico', label: 'Atlantic (Puerto Rico)' },
  { id: 'America/Halifax', label: 'Atlantic (Halifax)' },
  { id: 'America/Toronto', label: 'Eastern (Toronto)' },
  { id: 'America/Winnipeg', label: 'Central (Winnipeg)' },
  { id: 'America/Edmonton', label: 'Mountain (Edmonton)' },
  { id: 'America/Vancouver', label: 'Pacific (Vancouver)' },
  { id: 'UTC', label: 'UTC' }
];

export type DisplayUnits = 'us' | 'metric';
export const DISPLAY_UNITS: ReadonlyArray<{ id: DisplayUnits; label: string }> = [
  { id: 'us', label: 'US (acre · lb · °F)' },
  { id: 'metric', label: 'Metric (ha · kg · °C)' }
];

/** Any IANA zone the runtime knows is accepted, not just the listed ones,
 *  so a value set elsewhere never fails a later save. */
export function normalizeTimeZone(
  raw: unknown
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: true, value: DEFAULT_TIME_ZONE };
  const tz = raw.trim();
  try {
    const canonical = new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone;
    return { ok: true, value: canonical };
  } catch {
    return { ok: false, error: 'Pick a time zone from the list.' };
  }
}

export function normalizeDisplayUnits(
  raw: unknown
): { ok: true; value: DisplayUnits } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: 'us' };
  if (raw === 'us' || raw === 'metric') return { ok: true, value: raw };
  return { ok: false, error: 'Pick US or Metric units.' };
}
