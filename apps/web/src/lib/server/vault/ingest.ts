import { createHash } from 'node:crypto';
import { crc32 } from '../zip';
import type { VaultMime } from './store';

export const VAULT_MAX_FILE_BYTES = 20_000_000;

export type IngestErrorCode = 'UNSUPPORTED_TYPE' | 'TRUNCATED';

export class IngestError extends Error {
  constructor(
    readonly code: IngestErrorCode,
    readonly status: 400 | 415,
    message: string
  ) {
    super(message);
    this.name = 'IngestError';
  }
}

const NAMES: Record<VaultMime, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
  'text/csv; charset=utf-8': 'CSV'
};

const ALL: readonly VaultMime[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv; charset=utf-8'
];

export function unsupportedMessage(allow: readonly VaultMime[] = ALL): string {
  const names = allow.map((m) => NAMES[m]);
  const list =
    names.length <= 1
      ? (names[0] ?? 'supported')
      : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
  const article = /^[AEIOU]/.test(list) ? 'an' : 'a';
  return `This file type can't be stored. Use ${article} ${list} file.`;
}

const unreadable = () =>
  new IngestError(
    'UNSUPPORTED_TYPE',
    415,
    "This file couldn't be read. Save it again as a PDF, JPEG, PNG, WebP or CSV file and retry."
  );

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Type from the first bytes only; the client's declared type is ignored.
 *  Anything that is not one of the four magic numbers is a CSV candidate,
 *  which the CSV checker then accepts or refuses. */
export function sniffMime(head: Uint8Array): VaultMime {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'image/jpeg';
  }
  if (head.length >= 8 && PNG_SIG.every((b, i) => head[i] === b)) return 'image/png';
  if (head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') {
    return 'image/webp';
  }
  if (head.length >= 5 && ascii(head, 0, 5) === '%PDF-') return 'application/pdf';
  return 'text/csv; charset=utf-8';
}

function ascii(b: Uint8Array, at: number, n: number): string {
  let s = '';
  for (let i = 0; i < n && at + i < b.length; i++) s += String.fromCharCode(b[at + i]);
  return s;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** A streaming filter: push input, get output; `end` flushes or throws. */
export interface Transformer {
  push(chunk: Uint8Array): Uint8Array[];
  end(): Uint8Array[];
}

class PassThrough implements Transformer {
  push(chunk: Uint8Array): Uint8Array[] {
    return [chunk];
  }
  end(): Uint8Array[] {
    return [];
  }
}

/** UTF-8 (BOM allowed), no NUL or C0 control except tab, CR and LF, and
 *  the first non-space character is not `<` (HTML or SVG renamed .csv). */
export class CsvChecker implements Transformer {
  private decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  private sawContent = false;
  push(chunk: Uint8Array): Uint8Array[] {
    this.check(this.decode(chunk, true));
    return [chunk];
  }
  end(): Uint8Array[] {
    this.check(this.decode(undefined, false));
    return [];
  }
  private decode(chunk: Uint8Array | undefined, stream: boolean): string {
    try {
      return this.decoder.decode(chunk, { stream });
    } catch {
      throw new IngestError('UNSUPPORTED_TYPE', 415, unsupportedMessage());
    }
  }
  private check(text: string): void {
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) {
        throw new IngestError('UNSUPPORTED_TYPE', 415, unsupportedMessage());
      }
      if (!this.sawContent && c !== 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) {
        this.sawContent = true;
        if (c === 0x3c) throw new IngestError('UNSUPPORTED_TYPE', 415, unsupportedMessage());
      }
    }
  }
}

/** Minimal APP1 holding only the EXIF Orientation tag (big-endian TIFF). */
export function orientationApp1(orientation: number): Uint8Array {
  const payload = [
    0x45,
    0x78,
    0x69,
    0x66,
    0x00,
    0x00,
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0x00,
    0x00,
    0x00,
    0x08,
    0x00,
    0x01,
    0x01,
    0x12,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x01,
    (orientation >> 8) & 0xff,
    orientation & 0xff,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00
  ];
  const len = payload.length + 2;
  return Uint8Array.from([0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...payload]);
}

/** Orientation from an APP1 payload (after the length bytes), or null. */
export function exifOrientation(seg: Uint8Array): number | null {
  if (seg.length < 14 || ascii(seg, 0, 6) !== 'Exif\0\0') return null;
  const t = seg.subarray(6);
  const order = ascii(t, 0, 2);
  const le = order === 'II';
  if (!le && order !== 'MM') return null;
  const u16 = (o: number) =>
    o + 2 > t.length ? -1 : le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1];
  const u32 = (o: number) =>
    o + 4 > t.length
      ? -1
      : le
        ? (t[o] | (t[o + 1] << 8) | (t[o + 2] << 16) | (t[o + 3] << 24)) >>> 0
        : ((t[o] << 24) | (t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]) >>> 0;
  if (u16(2) !== 42) return null;
  const ifd = u32(4);
  if (ifd < 8) return null;
  const count = u16(ifd);
  if (count < 0) return null;
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > t.length) return null;
    if (u16(e) === 0x0112 && u16(e + 2) === 3) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : null;
    }
  }
  return null;
}

/** Drops APP1 (EXIF, XMP), APP13 (IPTC) and COM segments and everything
 *  after EOI; writes back a minimal Orientation-only APP1 when the source
 *  orientation was not 1. */
export class JpegStripper implements Transformer {
  private buf: Uint8Array = new Uint8Array(0);
  private state: 'soi' | 'marker' | 'scan' | 'done' = 'soi';
  private wroteOrientation = false;

  push(chunk: Uint8Array): Uint8Array[] {
    if (this.state === 'done') return [];
    this.buf = concat(this.buf, chunk);
    return this.run();
  }

  end(): Uint8Array[] {
    if (this.state === 'done') return [];
    if (this.state === 'scan') {
      const rest = this.buf;
      this.buf = new Uint8Array(0);
      return rest.length ? [rest] : [];
    }
    if (this.state === 'marker' && this.buf.length === 0) return [];
    throw unreadable();
  }

  private run(): Uint8Array[] {
    const out: Uint8Array[] = [];
    for (;;) {
      const b = this.buf;
      if (this.state === 'done') {
        this.buf = new Uint8Array(0);
        return out;
      }
      if (this.state === 'soi') {
        if (b.length < 2) return out;
        if (b[0] !== 0xff || b[1] !== 0xd8) throw unreadable();
        out.push(b.subarray(0, 2));
        this.buf = b.subarray(2);
        this.state = 'marker';
        continue;
      }
      if (this.state === 'scan') {
        let i = 0;
        let safe = b.length;
        let marker = -1;
        while (i < b.length) {
          const ff = b.indexOf(0xff, i);
          if (ff < 0) break;
          if (ff + 1 >= b.length) {
            safe = ff;
            break;
          }
          const x = b[ff + 1];
          if (x === 0x00 || (x >= 0xd0 && x <= 0xd7)) {
            i = ff + 2;
            continue;
          }
          if (x === 0xff) {
            i = ff + 1;
            continue;
          }
          marker = ff;
          break;
        }
        if (marker < 0) {
          if (safe > 0) out.push(b.subarray(0, safe));
          this.buf = b.subarray(safe);
          return out;
        }
        if (marker > 0) out.push(b.subarray(0, marker));
        this.buf = b.subarray(marker);
        this.state = 'marker';
        continue;
      }
      // marker
      let p = 0;
      while (p < b.length && b[p] === 0xff && p + 1 < b.length && b[p + 1] === 0xff) p++;
      if (p > 0) {
        this.buf = b.subarray(p);
        continue;
      }
      if (b.length < 2) return out;
      if (b[0] !== 0xff) throw unreadable();
      const m = b[1];
      if (m === 0xd9) {
        out.push(b.subarray(0, 2));
        this.state = 'done';
        this.buf = new Uint8Array(0);
        return out;
      }
      if (m === 0xd8 || m === 0x00) throw unreadable();
      if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) {
        out.push(b.subarray(0, 2));
        this.buf = b.subarray(2);
        continue;
      }
      if (b.length < 4) return out;
      const len = (b[2] << 8) | b[3];
      if (len < 2) throw unreadable();
      if (b.length < 2 + len) return out;
      const seg = b.subarray(0, 2 + len);
      this.buf = b.subarray(2 + len);
      if (m === 0xe1 || m === 0xed || m === 0xfe) {
        if (m === 0xe1 && !this.wroteOrientation) {
          const o = exifOrientation(seg.subarray(4));
          if (o !== null) {
            this.wroteOrientation = true;
            if (o !== 1) out.push(orientationApp1(o));
          }
        }
        continue;
      }
      out.push(seg);
      if (m === 0xda) this.state = 'scan';
    }
  }
}

const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

/** Drops text, EXIF and time chunks and anything after IEND. */
export class PngStripper implements Transformer {
  private buf: Uint8Array = new Uint8Array(0);
  private state: 'sig' | 'header' | 'pass' | 'skip' | 'done' = 'sig';
  private remaining = 0;
  private afterPass: 'header' | 'done' = 'header';

  push(chunk: Uint8Array): Uint8Array[] {
    if (this.state === 'done') return [];
    this.buf = concat(this.buf, chunk);
    const out: Uint8Array[] = [];
    for (;;) {
      const b = this.buf;
      if (this.state === 'done') {
        this.buf = new Uint8Array(0);
        return out;
      }
      if (this.state === 'sig') {
        if (b.length < 8) return out;
        out.push(b.subarray(0, 8));
        this.buf = b.subarray(8);
        this.state = 'header';
        continue;
      }
      if (this.state === 'header') {
        if (b.length < 8) return out;
        const len = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
        if (len > 0x7fffffff) throw unreadable();
        const type = ascii(b, 4, 4);
        if (!/^[A-Za-z]{4}$/.test(type)) throw unreadable();
        this.remaining = len + 4;
        this.afterPass = type === 'IEND' ? 'done' : 'header';
        if (PNG_DROP.has(type)) {
          this.state = 'skip';
        } else {
          out.push(b.subarray(0, 8));
          this.state = 'pass';
        }
        this.buf = b.subarray(8);
        continue;
      }
      if (b.length === 0 && this.remaining > 0) return out;
      const n = Math.min(this.remaining, b.length);
      if (this.state === 'pass' && n > 0) out.push(b.subarray(0, n));
      this.remaining -= n;
      this.buf = b.subarray(n);
      if (this.remaining === 0) this.state = this.afterPass;
    }
  }

  end(): Uint8Array[] {
    if (this.state === 'done') return [];
    throw unreadable();
  }
}

/** Renames EXIF and XMP chunks to JUNK with zeroed payloads (sizes kept,
 *  so the RIFF size in the first bytes stays right), clears the VP8X EXIF
 *  and XMP flags, and drops bytes past the RIFF size. */
export class WebpStripper implements Transformer {
  private buf: Uint8Array = new Uint8Array(0);
  private state: 'hdr' | 'chunk' | 'pass' | 'zero' = 'hdr';
  private remaining = 0;
  private riffEnd = 0;
  private consumed = 0;

  push(chunk: Uint8Array): Uint8Array[] {
    if (this.state !== 'hdr') {
      const room = this.riffEnd - this.consumed - this.buf.length;
      if (room <= 0) return [];
      if (chunk.length > room) chunk = chunk.subarray(0, room);
    }
    this.buf = concat(this.buf, chunk);
    const out: Uint8Array[] = [];
    for (;;) {
      const b = this.buf;
      if (this.state === 'hdr') {
        if (b.length < 12) return out;
        const size = (b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24)) >>> 0;
        if (size < 4) throw unreadable();
        this.riffEnd = 8 + size;
        out.push(b.subarray(0, 12));
        this.take(12);
        this.state = 'chunk';
        const extra = this.consumed + this.buf.length - this.riffEnd;
        if (extra > 0) this.buf = this.buf.subarray(0, this.buf.length - extra);
        continue;
      }
      if (this.state === 'chunk') {
        if (this.consumed >= this.riffEnd) return out;
        if (b.length < 8) return out;
        const fourcc = ascii(b, 0, 4);
        const size = (b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24)) >>> 0;
        const padded = size + (size & 1);
        if (this.consumed + 8 + padded > this.riffEnd) throw unreadable();
        if (fourcc === 'VP8X') {
          if (b.length < 8 + padded) return out;
          const seg = Uint8Array.from(b.subarray(0, 8 + padded));
          if (padded >= 1) seg[8] &= ~(0x08 | 0x04);
          out.push(seg);
          this.take(8 + padded);
          continue;
        }
        if (fourcc === 'EXIF' || fourcc === 'XMP ') {
          out.push(Uint8Array.from([0x4a, 0x55, 0x4e, 0x4b, b[4], b[5], b[6], b[7]]));
          this.take(8);
          this.remaining = padded;
          this.state = 'zero';
          continue;
        }
        out.push(b.subarray(0, 8));
        this.take(8);
        this.remaining = padded;
        this.state = 'pass';
        continue;
      }
      if (this.remaining > 0 && b.length === 0) return out;
      const n = Math.min(this.remaining, b.length);
      if (n > 0) out.push(this.state === 'pass' ? b.subarray(0, n) : new Uint8Array(n));
      this.take(n);
      this.remaining -= n;
      if (this.remaining === 0) this.state = 'chunk';
    }
  }

  private take(n: number): void {
    this.buf = this.buf.subarray(n);
    this.consumed += n;
  }

  end(): Uint8Array[] {
    if (this.state === 'chunk' && this.consumed === this.riffEnd && this.buf.length === 0) {
      return [];
    }
    throw unreadable();
  }
}

export function transformerFor(mime: VaultMime): Transformer {
  switch (mime) {
    case 'image/jpeg':
      return new JpegStripper();
    case 'image/png':
      return new PngStripper();
    case 'image/webp':
      return new WebpStripper();
    case 'text/csv; charset=utf-8':
      return new CsvChecker();
    default:
      return new PassThrough();
  }
}

export interface IngestInfo {
  mime: VaultMime;
  bytes: number;
  sha256: string;
  crc32: number;
}

export interface Ingest {
  mime: VaultMime;
  /** The bytes to store. Throws `IngestError` as soon as the input is
   *  known to be bad, so the store never commits it. */
  chunks: AsyncGenerator<Uint8Array>;
  /** Valid once `chunks` has been read to the end. */
  info(): IngestInfo;
}

const truncated = () =>
  new IngestError(
    'TRUNCATED',
    400,
    "The upload didn't arrive in one piece. Check your connection and try again."
  );

/**
 * Sniff the type from the first bytes, then stream the input through that
 * type's stripper while counting, hashing and CRC'ing the stored bytes.
 * `declaredLength` is the request's Content-Length: a body that ends short
 * of it or runs past it is TRUNCATED.
 */
export async function sniffAndStrip(
  input: AsyncIterable<Uint8Array>,
  opts: { declaredLength: number | null; allow?: readonly VaultMime[] }
): Promise<Ingest> {
  const it = input[Symbol.asyncIterator]();
  const declared = opts.declaredLength;
  let received = 0;
  const count = (c: Uint8Array) => {
    received += c.byteLength;
    if (declared !== null && received > declared) throw truncated();
  };

  let head: Uint8Array = new Uint8Array(0);
  let ended = false;
  while (head.length < 12) {
    const r = await it.next();
    if (r.done) {
      ended = true;
      break;
    }
    count(r.value);
    head = concat(head, r.value);
  }
  if (head.length === 0 || (ended && declared !== null && received < declared)) {
    await it.return?.(undefined);
    throw truncated();
  }
  const mime = sniffMime(head);
  const allow = opts.allow ?? ALL;
  if (!allow.includes(mime)) {
    await it.return?.(undefined);
    throw new IngestError('UNSUPPORTED_TYPE', 415, unsupportedMessage(allow));
  }

  const tx = transformerFor(mime);
  const hash = createHash('sha256');
  let crc = 0;
  let bytes = 0;
  let finished = false;
  const emit = function* (parts: Uint8Array[]): Generator<Uint8Array> {
    for (const p of parts) {
      if (p.byteLength === 0) continue;
      hash.update(p);
      crc = crc32(p, crc);
      bytes += p.byteLength;
      yield p;
    }
  };

  async function* chunks(): AsyncGenerator<Uint8Array> {
    try {
      yield* emit(tx.push(head));
      if (!ended) {
        for (;;) {
          const r = await it.next();
          if (r.done) break;
          count(r.value);
          yield* emit(tx.push(r.value));
        }
      }
      if (declared !== null && received !== declared) throw truncated();
      yield* emit(tx.end());
      finished = true;
    } finally {
      if (!finished) await it.return?.(undefined);
    }
  }

  let digest: string | null = null;
  return {
    mime,
    chunks: chunks(),
    info() {
      if (!finished) throw new Error('ingest not finished');
      digest ??= hash.digest('hex');
      return { mime, bytes, sha256: digest, crc32: crc >>> 0 };
    }
  };
}
