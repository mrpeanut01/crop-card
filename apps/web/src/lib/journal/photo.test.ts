import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  JPEG_DATA_URL_PREFIX,
  MAX_PHOTO_BYTES,
  MAX_PHOTO_DATA_URL_CHARS,
  decodeBase64,
  encodeBase64,
  fitWithin,
  hasJpegMetadata,
  sanitizePhotoDataUrl,
  stripJpegMetadata
} from './photo';
import { EXIF_SECRET, fakeJpeg, toDataUrl } from './jpegFixture';

const text = (b: Uint8Array) => Buffer.from(b).toString('latin1');

describe('stripJpegMetadata', () => {
  it('removes EXIF and comment segments and keeps the image data', () => {
    const raw = fakeJpeg({ exif: true, comment: true });
    expect(text(raw)).toContain(EXIF_SECRET);
    expect(hasJpegMetadata(raw)).toBe(true);
    const clean = stripJpegMetadata(raw)!;
    expect(text(clean)).not.toContain(EXIF_SECRET);
    expect(text(clean)).not.toContain('taken at home');
    expect(text(clean)).toContain('JFIF');
    expect(Array.from(clean.slice(0, 2))).toEqual([0xff, 0xd8]);
    expect(Array.from(clean.slice(-2))).toEqual([0xff, 0xd9]);
    expect(clean).toEqual(stripJpegMetadata(fakeJpeg()));
    expect(hasJpegMetadata(clean)).toBe(false);
  });

  it('refuses bytes that are not a JPEG', () => {
    expect(stripJpegMetadata(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(stripJpegMetadata(Uint8Array.from([0xff, 0xd8, 0x00]))).toBeNull();
    expect(stripJpegMetadata(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]))).toBeNull();
  });

  it('never keeps an APP1 segment ahead of the scan, whatever the padding', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), fc.nat(400), (exif, comment, padding) => {
        const clean = stripJpegMetadata(fakeJpeg({ exif, comment, padding }))!;
        const head = clean.slice(0, clean.indexOf(0xda) + 1);
        for (let i = 0; i < head.length - 1; i++) {
          if (head[i] === 0xff) expect(head[i + 1]).not.toBe(0xe1);
        }
        expect(text(clean)).not.toContain(EXIF_SECRET);
      })
    );
  });
});

describe('sanitizePhotoDataUrl', () => {
  it('re-encodes a JPEG without its metadata', () => {
    const res = sanitizePhotoDataUrl(toDataUrl(fakeJpeg({ exif: true })));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.dataUrl.startsWith(JPEG_DATA_URL_PREFIX)).toBe(true);
    expect(text(decodeBase64(res.dataUrl.slice(JPEG_DATA_URL_PREFIX.length))!)).not.toContain(
      EXIF_SECRET
    );
  });

  it('refuses other image types, broken base64 and oversize photos', () => {
    expect(sanitizePhotoDataUrl('data:image/png;base64,iVBORw0KGgo=')).toEqual({
      ok: false,
      error: 'not-jpeg'
    });
    expect(sanitizePhotoDataUrl(`${JPEG_DATA_URL_PREFIX}!!!`)).toEqual({
      ok: false,
      error: 'not-jpeg'
    });
    const big = toDataUrl(fakeJpeg({ padding: MAX_PHOTO_BYTES }));
    expect(sanitizePhotoDataUrl(big)).toEqual({ ok: false, error: 'too-large' });
    expect(big.length).toBeGreaterThan(MAX_PHOTO_DATA_URL_CHARS);
  });

  it('round-trips base64', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 2000 }), (bytes) => {
        const b64 = encodeBase64(bytes);
        expect(b64).toBe(Buffer.from(bytes).toString('base64'));
        if (bytes.length) expect(decodeBase64(b64)).toEqual(bytes);
      })
    );
  });
});

describe('fitWithin', () => {
  it('shrinks the long side to 1024 and never upscales', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1024, height: 768 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 768, height: 1024 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(0, 600)).toEqual({ width: 0, height: 0 });
  });

  it('keeps both sides within the cap', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20000 }),
        fc.integer({ min: 1, max: 20000 }),
        (w, h) => {
          const out = fitWithin(w, h);
          expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(1024);
          expect(out.width).toBeGreaterThanOrEqual(1);
        }
      )
    );
  });
});
