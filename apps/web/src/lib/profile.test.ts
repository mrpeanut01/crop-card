import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_TIME_ZONE,
  DISPLAY_NAME_MAX,
  TIME_ZONES,
  normalizeDisplayName,
  normalizeDisplayUnits,
  normalizeTimeZone,
  sniffAvatarMime
} from './profile';

describe('normalizeDisplayName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeDisplayName('  Dale   Ridge ')).toEqual({ ok: true, value: 'Dale Ridge' });
  });

  it.each([null, undefined, '', '   '])('clears to null for %j', (raw) => {
    expect(normalizeDisplayName(raw)).toEqual({ ok: true, value: null });
  });

  it('rejects non-strings and control characters', () => {
    expect(normalizeDisplayName(42).ok).toBe(false);
    expect(normalizeDisplayName('Dale\u0000').ok).toBe(false);
    expect(normalizeDisplayName('Dale\nRidge').ok).toBe(false);
  });

  it('counts characters, not UTF-16 units, against the limit', () => {
    expect(normalizeDisplayName('🌾'.repeat(DISPLAY_NAME_MAX)).ok).toBe(true);
    expect(normalizeDisplayName('a'.repeat(DISPLAY_NAME_MAX + 1)).ok).toBe(false);
  });

  it('never returns a value with edge or doubled whitespace', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const r = normalizeDisplayName(raw);
        if (r.ok && r.value !== null) {
          expect(r.value).toBe(r.value.trim());
          expect(r.value).not.toMatch(/\s{2}/);
          expect([...r.value].length).toBeLessThanOrEqual(DISPLAY_NAME_MAX);
        }
      })
    );
  });
});

describe('sniffAvatarMime', () => {
  const bytes = (...b: number[]) => new Uint8Array(b);
  const ascii = (s: string) => new TextEncoder().encode(s);

  it('recognizes JPEG, PNG and WebP by magic bytes', () => {
    expect(sniffAvatarMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffAvatarMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(
      'image/png'
    );
    expect(sniffAvatarMime(ascii('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
  });

  it('refuses SVG, GIF, HTML and truncated headers', () => {
    expect(sniffAvatarMime(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffAvatarMime(ascii('GIF89a'))).toBeNull();
    expect(sniffAvatarMime(ascii('<html><script>'))).toBeNull();
    expect(sniffAvatarMime(bytes(0xff, 0xd8))).toBeNull();
    expect(sniffAvatarMime(ascii('RIFF\0\0\0\0WAVE'))).toBeNull();
    expect(sniffAvatarMime(bytes())).toBeNull();
  });
});

describe('normalizeTimeZone', () => {
  it('accepts every listed zone unchanged', () => {
    for (const tz of TIME_ZONES)
      expect(normalizeTimeZone(tz.id)).toEqual({ ok: true, value: tz.id });
  });

  it('canonicalizes aliases and defaults blanks', () => {
    expect(normalizeTimeZone('US/Eastern')).toEqual({ ok: true, value: 'America/New_York' });
    expect(normalizeTimeZone('')).toEqual({ ok: true, value: DEFAULT_TIME_ZONE });
    expect(normalizeTimeZone(null)).toEqual({ ok: true, value: DEFAULT_TIME_ZONE });
  });

  it('refuses unknown zones', () => {
    expect(normalizeTimeZone('Mars/Olympus_Mons').ok).toBe(false);
    expect(normalizeTimeZone('<script>').ok).toBe(false);
  });
});

describe('normalizeDisplayUnits', () => {
  it('accepts us and metric, defaults blanks to us', () => {
    expect(normalizeDisplayUnits('metric')).toEqual({ ok: true, value: 'metric' });
    expect(normalizeDisplayUnits('us')).toEqual({ ok: true, value: 'us' });
    expect(normalizeDisplayUnits('')).toEqual({ ok: true, value: 'us' });
  });

  it('refuses anything else', () => {
    expect(normalizeDisplayUnits('imperial').ok).toBe(false);
    expect(normalizeDisplayUnits('METRIC').ok).toBe(false);
  });
});
