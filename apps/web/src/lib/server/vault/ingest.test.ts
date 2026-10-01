// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createHash } from 'node:crypto';
import { crc32 } from '../zip';
import {
  IngestError,
  exifOrientation,
  orientationApp1,
  sniffAndStrip,
  sniffMime,
  unsupportedMessage
} from './ingest';
import type { VaultMime } from './store';
import {
  ascii,
  cat,
  exifJpeg,
  hasBytes,
  metaPng,
  metaWebp,
  pdf,
  plainJpeg,
  plainPng,
  plainWebp,
  polyglotJpeg
} from './__fixtures__/files';

async function* chunked(bytes: Uint8Array, cuts: number[] = []): AsyncGenerator<Uint8Array> {
  let at = 0;
  for (const c of [...cuts].sort((a, b) => a - b)) {
    if (c <= at || c >= bytes.length) continue;
    yield bytes.subarray(at, c);
    at = c;
  }
  if (at < bytes.length) yield bytes.subarray(at);
}

async function run(
  bytes: Uint8Array,
  opts: { declared?: number | null; allow?: readonly VaultMime[]; cuts?: number[] } = {}
): Promise<{
  mime: VaultMime;
  out: Uint8Array;
  info: ReturnType<Awaited<ReturnType<typeof sniffAndStrip>>['info']>;
}> {
  const ing = await sniffAndStrip(chunked(bytes, opts.cuts), {
    declaredLength: opts.declared === undefined ? bytes.length : opts.declared,
    allow: opts.allow
  });
  const parts: Uint8Array[] = [];
  for await (const c of ing.chunks) parts.push(c);
  return { mime: ing.mime, out: cat(...parts), info: ing.info() };
}

async function refusal(
  bytes: Uint8Array,
  opts: { declared?: number | null; allow?: readonly VaultMime[]; cuts?: number[] } = {}
): Promise<IngestError> {
  try {
    await run(bytes, opts);
  } catch (err) {
    expect(err).toBeInstanceOf(IngestError);
    return err as IngestError;
  }
  throw new Error('expected a refusal');
}

describe('sniffMime', () => {
  it('reads each allowed type from its first bytes', () => {
    expect(sniffMime(plainJpeg())).toBe('image/jpeg');
    expect(sniffMime(plainPng())).toBe('image/png');
    expect(sniffMime(plainWebp())).toBe('image/webp');
    expect(sniffMime(pdf())).toBe('application/pdf');
    expect(sniffMime(ascii('a,b\n1,2\n'))).toBe('text/csv; charset=utf-8');
  });
});

describe('sniffAndStrip: allowed types', () => {
  it('stores a PDF as sent, with size, sha256 and crc of the stored bytes', async () => {
    const bytes = pdf();
    const r = await run(bytes);
    expect(r.mime).toBe('application/pdf');
    expect(r.out).toEqual(bytes);
    expect(r.info.bytes).toBe(bytes.length);
    expect(r.info.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(r.info.crc32).toBe(crc32(bytes));
  });

  it('treats a PDF named .jpg as a PDF (the name and declared type are ignored)', async () => {
    expect((await run(pdf())).mime).toBe('application/pdf');
  });

  it('accepts a CSV with a BOM, tabs and CRLF', async () => {
    const bytes = cat([0xef, 0xbb, 0xbf], 'name,qty\r\n"Tomato\tSeed",3\r\n');
    const r = await run(bytes);
    expect(r.mime).toBe('text/csv; charset=utf-8');
    expect(r.out).toEqual(bytes);
  });

  it('accepts multi-byte UTF-8 split across chunks', async () => {
    const bytes = ascii('crop,note\nPiment,très épicé 🌶\n');
    for (let cut = 1; cut < bytes.length; cut++) {
      const r = await run(bytes, { cuts: [cut] });
      expect(r.out).toEqual(bytes);
    }
  });

  it('keeps a metadata-free JPEG byte-identical', async () => {
    const bytes = plainJpeg();
    const r = await run(bytes);
    expect(r.mime).toBe('image/jpeg');
    expect(r.out).toEqual(bytes);
  });

  it('keeps a metadata-free PNG and WebP byte-identical', async () => {
    expect((await run(plainPng())).out).toEqual(plainPng());
    expect((await run(plainWebp())).out).toEqual(plainWebp());
  });
});

describe('sniffAndStrip: refused types', () => {
  const cases: [string, Uint8Array][] = [
    ['HTML renamed .pdf', ascii('<!doctype html><html><body>hi</body></html>')],
    ['HTML with leading spaces', ascii('  \n\t<html></html>')],
    ['HTML after a BOM', cat([0xef, 0xbb, 0xbf], ' <html></html>')],
    ['SVG', ascii('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>')],
    ['XML', ascii('<?xml version="1.0"?><a/>')],
    ['GIF', cat('GIF89a', [1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0])],
    ['ZIP / Office', cat('PK', [3, 4, 20, 0, 0, 0, 0, 0], 'word/document.xml')],
    ['HEIC', cat([0, 0, 0, 0x18], 'ftypheic', [0, 0, 0, 0], 'mif1heic')],
    ['binary with NUL', cat('a,b\n', [0], 'c\n')],
    ['invalid UTF-8', cat('a,b\n', [0xc3, 0x28], '\n')]
  ];
  for (const [name, bytes] of cases) {
    it(`refuses ${name} as UNSUPPORTED_TYPE (415)`, async () => {
      const e = await refusal(bytes);
      expect(e.code).toBe('UNSUPPORTED_TYPE');
      expect(e.status).toBe(415);
      expect(e.message).toBe(
        "This file type can't be stored. Use a PDF, JPEG, PNG, WebP or CSV file."
      );
    });
  }

  it('refuses a CSV that turns bad only near the end', async () => {
    const big = cat(ascii('a,b\n'.repeat(50_000)), [0xff, 0xfe]);
    const e = await refusal(big, { cuts: [4096, 65536, 150_000] });
    expect(e.code).toBe('UNSUPPORTED_TYPE');
  });

  it('refuses a CSV that ends inside a multi-byte character', async () => {
    const e = await refusal(cat('a,b\n', [0xe2, 0x82]));
    expect(e.code).toBe('UNSUPPORTED_TYPE');
  });

  it('applies the allow list and names only the allowed types', async () => {
    const e = await refusal(pdf(), { allow: ['image/jpeg'] });
    expect(e.code).toBe('UNSUPPORTED_TYPE');
    expect(e.message).toBe("This file type can't be stored. Use a JPEG file.");
    expect(unsupportedMessage(['image/png', 'image/jpeg'])).toBe(
      "This file type can't be stored. Use a PNG or JPEG file."
    );
  });
});

describe('sniffAndStrip: sizes', () => {
  it('is TRUNCATED when the body ends short of Content-Length', async () => {
    const bytes = pdf();
    const e = await refusal(bytes, { declared: bytes.length + 10 });
    expect(e.code).toBe('TRUNCATED');
    expect(e.status).toBe(400);
  });

  it('is TRUNCATED when the body runs past Content-Length', async () => {
    const bytes = pdf();
    expect((await refusal(bytes, { declared: bytes.length - 1 })).code).toBe('TRUNCATED');
    expect((await refusal(bytes, { declared: 3, cuts: [2] })).code).toBe('TRUNCATED');
  });

  it('is TRUNCATED for an empty body', async () => {
    expect((await refusal(new Uint8Array(0), { declared: 5 })).code).toBe('TRUNCATED');
  });

  it('accepts a body of exactly Content-Length', async () => {
    const bytes = ascii('x');
    expect((await run(bytes)).out).toEqual(bytes);
  });
});

describe('JPEG metadata strip', () => {
  it('drops EXIF (with GPS), XMP, IPTC and COM and keeps the orientation', async () => {
    const r = await run(exifJpeg(6));
    for (const m of ['GPSMARK', 'XMPMARK', 'IPTCMARK', 'COMMARK', 'http://ns.adobe.com']) {
      expect(hasBytes(r.out, m)).toBe(false);
    }
    expect(hasBytes(r.out, Uint8Array.from([0x25, 0x88]))).toBe(false);
    expect(hasBytes(r.out, orientationApp1(6))).toBe(true);
    expect(r.out.subarray(0, 2)).toEqual(Uint8Array.from([0xff, 0xd8]));
    expect(r.out.subarray(-2)).toEqual(Uint8Array.from([0xff, 0xd9]));
  });

  it('writes no APP1 back when the orientation is 1', async () => {
    const r = await run(exifJpeg(1));
    expect(hasBytes(r.out, 'Exif')).toBe(false);
    expect(r.out).toEqual(plainJpeg());
  });

  it('round-trips the orientation it writes back', () => {
    for (let o = 1; o <= 8; o++) {
      expect(exifOrientation(orientationApp1(o).subarray(4))).toBe(o);
    }
  });

  it('drops a polyglot HTML tail after EOI', async () => {
    const r = await run(polyglotJpeg());
    expect(hasBytes(r.out, 'POLYGLOT')).toBe(false);
    expect(hasBytes(r.out, '<html')).toBe(false);
    expect(r.out).toEqual(plainJpeg());
  });

  it('keeps a JPEG cut off inside its scan data', async () => {
    const full = plainJpeg();
    const cut = full.subarray(0, full.length - 3);
    const r = await run(cut);
    expect(r.out).toEqual(cut);
  });

  it('refuses a JPEG cut off inside a header segment', async () => {
    expect((await refusal(exifJpeg().subarray(0, 40))).code).toBe('UNSUPPORTED_TYPE');
  });

  it('gives the same output however the input is chunked', async () => {
    const bytes = cat(exifJpeg(3), '<html>tail</html>');
    const expected = (await run(bytes)).out;
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: bytes.length - 1 }), { maxLength: 12 }),
        async (cuts) => {
          const r = await run(bytes, { cuts });
          expect(r.out).toEqual(expected);
        }
      ),
      { numRuns: 120 }
    );
  });
});

describe('PNG metadata strip', () => {
  it('drops tEXt, zTXt, iTXt, eXIf and tIME and anything after IEND', async () => {
    const r = await run(metaPng());
    for (const m of ['TEXTMARK', 'ZTXTMARK', 'ITXTMARK', 'GPSMARK', 'tIME', 'TAILMARK', 'eXIf']) {
      expect(hasBytes(r.out, m)).toBe(false);
    }
    expect(r.out).toEqual(plainPng());
  });

  it('gives the same output however the input is chunked', async () => {
    const bytes = metaPng();
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: bytes.length - 1 }), { maxLength: 10 }),
        async (cuts) => {
          expect((await run(bytes, { cuts })).out).toEqual(plainPng());
        }
      ),
      { numRuns: 80 }
    );
  });

  it('refuses a PNG with no IEND', async () => {
    const p = plainPng();
    expect((await refusal(p.subarray(0, p.length - 12))).code).toBe('UNSUPPORTED_TYPE');
  });
});

describe('WebP metadata strip', () => {
  it('renames EXIF and XMP to zeroed JUNK, clears the flags and drops the trailer', async () => {
    const src = metaWebp();
    const r = await run(src);
    for (const m of ['GPSMARK', 'XMPMARK', 'TRAILERMARK', 'EXIF', 'XMP ']) {
      expect(hasBytes(r.out, m)).toBe(false);
    }
    expect(hasBytes(r.out, 'JUNK')).toBe(true);
    const riffSize = r.out[4] | (r.out[5] << 8) | (r.out[6] << 16) | (r.out[7] << 24);
    expect(r.out.length).toBe(8 + riffSize);
    expect(r.out.length).toBe(src.length - 'TRAILERMARK'.length);
    const vp8xFlags = r.out[12 + 8];
    expect(vp8xFlags & 0x0c).toBe(0);
    expect(vp8xFlags & 0x10).toBe(0x10);
  });

  it('gives the same output however the input is chunked', async () => {
    const bytes = metaWebp();
    const expected = (await run(bytes)).out;
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: bytes.length - 1 }), { maxLength: 10 }),
        async (cuts) => {
          expect((await run(bytes, { cuts })).out).toEqual(expected);
        }
      ),
      { numRuns: 80 }
    );
  });

  it('refuses a WebP shorter than its RIFF size', async () => {
    const w = plainWebp();
    expect((await refusal(w.subarray(0, w.length - 4))).code).toBe('UNSUPPORTED_TYPE');
  });
});
