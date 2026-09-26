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

describe('stripJpegMetadata after the scan', () => {
  const EXIF_APP1 = [0xff, 0xe1, 0x00, 0x0a, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x47, 0x50];

  it('drops a second JPEG with its own EXIF appended after the end of the image', () => {
    const bytes = Uint8Array.from([
      0xff,
      0xd8,
      0xff,
      0xda,
      0x00,
      0x02,
      0x11,
      0x22,
      0xff,
      0xd9,
      0xff,
      0xd8,
      ...EXIF_APP1,
      0xff,
      0xd9
    ]);
    const clean = stripJpegMetadata(bytes)!;
    expect(Array.from(clean)).toEqual([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9]);
    const res = sanitizePhotoDataUrl(toDataUrl(bytes));
    expect(res.ok).toBe(true);
    if (res.ok)
      expect(text(decodeBase64(res.dataUrl.slice(JPEG_DATA_URL_PREFIX.length))!)).not.toContain(
        'Exif'
      );
  });

  it('drops trailer bytes after the end of the image', () => {
    const raw = Uint8Array.from([...fakeJpeg(), ...Array.from(Buffer.from(EXIF_SECRET))]);
    const clean = stripJpegMetadata(raw)!;
    expect(text(clean)).not.toContain(EXIF_SECRET);
    expect(clean).toEqual(stripJpegMetadata(fakeJpeg()));
  });

  it('keeps the tables and scans of a progressive JPEG and drops APPn between scans', () => {
    const bytes = Uint8Array.from([
      0xff,
      0xd8,
      0xff,
      0xda,
      0x00,
      0x02,
      0x11,
      0xff,
      0x00,
      0x22,
      0xff,
      0xd3,
      0x33,
      ...EXIF_APP1,
      0xff,
      0xc4,
      0x00,
      0x03,
      0x05,
      0xff,
      0xfe,
      0x00,
      0x04,
      0x68,
      0x69,
      0xff,
      0xda,
      0x00,
      0x02,
      0x44,
      0xff,
      0xd9
    ]);
    const clean = Array.from(stripJpegMetadata(bytes)!);
    expect(clean).toEqual([
      0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0x11, 0xff, 0x00, 0x22, 0xff, 0xd3, 0x33, 0xff, 0xc4,
      0x00, 0x03, 0x05, 0xff, 0xda, 0x00, 0x02, 0x44, 0xff, 0xd9
    ]);
  });

  it('never keeps an APP1 or comment marker anywhere, whatever follows the scan', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 255 }), { maxLength: 60 }),
        fc.boolean(),
        (tail, exifBetweenScans) => {
          const base = Array.from(fakeJpeg({ exif: true }));
          const body = exifBetweenScans
            ? [...base.slice(0, -2), ...EXIF_APP1, 0xff, 0xda, 0x00, 0x02, 0x10, 0xff, 0xd9]
            : base;
          const clean = stripJpegMetadata(Uint8Array.from([...body, ...tail]));
          if (!clean) return;
          expect(text(clean)).not.toContain('Exif');
          const eoi = clean.length - 2;
          expect([clean[eoi], clean[eoi + 1]]).toEqual([0xff, 0xd9]);
        }
      )
    );
  });

  it('refuses a photo wider than the phone resize allows', () => {
    const big = fakeJpeg();
    const sof = Array.from(big).findIndex((b, i) => b === 0xff && big[i + 1] === 0xc0);
    const wide = Uint8Array.from(big);
    wide[sof + 7] = 0x08;
    wide[sof + 8] = 0x00;
    expect(sanitizePhotoDataUrl(toDataUrl(wide))).toEqual({ ok: false, error: 'too-large' });
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
