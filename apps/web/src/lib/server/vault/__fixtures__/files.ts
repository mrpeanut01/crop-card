import { _crc32Js } from '../../zip';

const enc = new TextEncoder();
export const ascii = (s: string): Uint8Array => enc.encode(s);

export function cat(...parts: (Uint8Array | number[] | string)[]): Uint8Array {
  const arrays = parts.map((p) =>
    typeof p === 'string' ? ascii(p) : p instanceof Uint8Array ? p : Uint8Array.from(p)
  );
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrays) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

export function hasBytes(hay: Uint8Array, needle: Uint8Array | string): boolean {
  const n = typeof needle === 'string' ? ascii(needle) : needle;
  return Buffer.from(hay).indexOf(Buffer.from(n)) >= 0;
}

function seg(marker: number, payload: Uint8Array): Uint8Array {
  const len = payload.length + 2;
  return cat([0xff, marker, (len >> 8) & 0xff, len & 0xff], payload);
}

export const JFIF_APP0 = seg(0xe0, cat('JFIF\0', [1, 1, 0, 0, 1, 0, 1, 0, 0]));
const DQT = seg(0xdb, cat([0], new Uint8Array(64).fill(1)));
const SOF0 = seg(0xc0, Uint8Array.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0]));
const DHT = seg(0xc4, cat([0], new Uint8Array(16), []));
const SOS = seg(0xda, Uint8Array.from([1, 1, 0, 0, 0x3f, 0]));
/** Entropy data with byte stuffing (FF 00) and a restart marker (FF D0). */
const SCAN = Uint8Array.from([
  0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78, 0x9a, 0xff, 0xff, 0x00
]);

/** EXIF APP1 (little-endian TIFF) with Orientation and a GPS IFD whose
 *  latitude ref holds the marker `GPSMARK`. */
export function exifApp1(orientation: number): Uint8Array {
  const t: number[] = [];
  const u16 = (v: number) => t.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v: number) => t.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  t.push(0x49, 0x49);
  u16(42);
  u32(8);
  u16(2);
  u16(0x0112);
  u16(3);
  u32(1);
  u16(orientation);
  u16(0);
  u16(0x8825);
  u16(4);
  u32(1);
  u32(38);
  u32(0);
  // GPS IFD at 38
  u16(1);
  u16(0x0001);
  u16(2);
  u32(8);
  u32(56);
  u32(0);
  while (t.length < 56) t.push(0);
  for (const c of 'GPSMARK\0') t.push(c.charCodeAt(0));
  return seg(0xe1, cat('Exif\0\0', t));
}

export const XMP_APP1 = seg(
  0xe1,
  cat('http://ns.adobe.com/xap/1.0/\0', '<x:xmpmeta>XMPMARK</x:xmpmeta>')
);
export const IPTC_APP13 = seg(0xed, cat('Photoshop 3.0\0', 'IPTCMARK'));
export const COM = seg(0xfe, ascii('COMMARK'));

/** A structurally valid baseline JPEG with no metadata, as the app's
 *  canvas-made photos are. */
export function plainJpeg(): Uint8Array {
  return cat([0xff, 0xd8], JFIF_APP0, DQT, SOF0, DHT, SOS, SCAN, [0xff, 0xd9]);
}

export function exifJpeg(orientation = 6): Uint8Array {
  return cat(
    [0xff, 0xd8],
    JFIF_APP0,
    exifApp1(orientation),
    XMP_APP1,
    IPTC_APP13,
    COM,
    DQT,
    SOF0,
    DHT,
    SOS,
    SCAN,
    [0xff, 0xd9]
  );
}

export function polyglotJpeg(): Uint8Array {
  return cat(plainJpeg(), '<html><script>alert("POLYGLOT")</script></html>');
}

function pngChunk(type: string, data: Uint8Array | string): Uint8Array {
  const d = typeof data === 'string' ? ascii(data) : data;
  const td = cat(type, d);
  const crc = _crc32Js(td);
  return cat(
    [(d.length >>> 24) & 0xff, (d.length >> 16) & 0xff, (d.length >> 8) & 0xff, d.length & 0xff],
    td,
    [(crc >>> 24) & 0xff, (crc >> 16) & 0xff, (crc >> 8) & 0xff, crc & 0xff]
  );
}

export const PNG_SIG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR = pngChunk('IHDR', Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]));
const IDAT = pngChunk('IDAT', Uint8Array.from([0x78, 0x9c, 0x63, 0x60, 0, 0, 0, 4, 0, 1]));
const IEND = pngChunk('IEND', new Uint8Array(0));

export function plainPng(): Uint8Array {
  return cat(PNG_SIG, IHDR, IDAT, IEND);
}

export function metaPng(): Uint8Array {
  return cat(
    PNG_SIG,
    IHDR,
    pngChunk('tEXt', 'Comment\0TEXTMARK'),
    pngChunk('zTXt', 'Comment\0\0ZTXTMARK'),
    pngChunk('iTXt', 'XML:com.adobe.xmp\0\0\0\0\0ITXTMARK'),
    pngChunk('eXIf', cat('MM', 'GPSMARK')),
    pngChunk('tIME', Uint8Array.from([7, 234, 1, 1, 0, 0, 0])),
    IDAT,
    IEND,
    '<svg onload="TAILMARK">'
  );
}

function riffChunk(fourcc: string, payload: Uint8Array | string): Uint8Array {
  const p = typeof payload === 'string' ? ascii(payload) : payload;
  const n = p.length;
  return cat(
    fourcc,
    [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff],
    p,
    n & 1 ? [0] : []
  );
}

function riff(chunks: Uint8Array): Uint8Array {
  const size = 4 + chunks.length;
  return cat(
    'RIFF',
    [size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, size >>> 24],
    'WEBP',
    chunks
  );
}

const VP8 = riffChunk('VP8 ', Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));

export function plainWebp(): Uint8Array {
  return riff(VP8);
}

export function metaWebp(): Uint8Array {
  const vp8x = riffChunk('VP8X', Uint8Array.from([0x08 | 0x04 | 0x10, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  return cat(
    riff(cat(vp8x, VP8, riffChunk('EXIF', cat('II*\0', 'GPSMARK')), riffChunk('XMP ', 'XMPMARK!'))),
    'TRAILERMARK'
  );
}

export function pdf(marker = 'PDFMARK'): Uint8Array {
  return ascii(
    `%PDF-1.4\n% ${marker}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`
  );
}
