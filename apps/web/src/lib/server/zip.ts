import * as zlib from 'node:zlib';

/**
 * Store-only ZIP writer with ZIP64, streamed and pull-based so a large
 * export never sits in memory. Every entry's size and CRC-32 are known up
 * front, so local headers carry real values and no data descriptors are
 * written. The bytes each entry actually streams are counted and CRC'd, and
 * any mismatch errors the output stream instead of producing a corrupt file.
 */

export interface ZipEntry {
  name: string;
  mtime: Date;
  size: number;
  crc32: number;
  /** Null skips the entry (reported through `onSkipped`). */
  open: () => Promise<ReadableStream<Uint8Array> | Uint8Array | null>;
}

const nativeCrc = (zlib as unknown as { crc32?: (d: Uint8Array, v?: number) => number }).crc32;

let table: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (table) return table;
  table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

/** Incremental CRC-32 (ISO-HDLC, as ZIP and PNG use): pass the previous
 *  result as `seed` to continue over the next chunk. */
export function crc32(bytes: Uint8Array, seed = 0): number {
  if (nativeCrc) return nativeCrc(bytes, seed) >>> 0;
  const t = crcTable();
  let c = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Pure-JS CRC, exposed so tests can check the native path against it. */
export function _crc32Js(bytes: Uint8Array, seed = 0): number {
  const t = crcTable();
  let c = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;
const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;

/** Printable ASCII only; anything else becomes `_`. */
export function zipSafeName(name: string): string {
  const cleaned = name.replace(/[^\x20-\x7e]/g, '_').replace(/\\/g, '/');
  return cleaned.replace(/^\/+/, '') || '_';
}

function dosDateTime(d: Date): { time: number; date: number } {
  let year = d.getUTCFullYear();
  let month = d.getUTCMonth() + 1;
  let day = d.getUTCDate();
  let h = d.getUTCHours();
  let m = d.getUTCMinutes();
  let s = d.getUTCSeconds();
  if (!Number.isFinite(year) || year < 1980) {
    year = 1980;
    month = 1;
    day = 1;
    h = m = s = 0;
  } else if (year > 2107) {
    year = 2107;
  }
  return {
    time: ((h << 11) | (m << 5) | (s >> 1)) & 0xffff,
    date: (((year - 1980) << 9) | (month << 5) | day) & 0xffff
  };
}

class Writer {
  private bytes: number[] = [];
  u16(v: number): this {
    this.bytes.push(v & 0xff, (v >>> 8) & 0xff);
    return this;
  }
  u32(v: number): this {
    this.bytes.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    return this;
  }
  u64(v: number): this {
    const lo = v % 0x100000000;
    const hi = Math.floor(v / 0x100000000);
    return this.u32(lo).u32(hi);
  }
  raw(b: Uint8Array): this {
    for (const x of b) this.bytes.push(x);
    return this;
  }
  done(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

interface Written {
  name: Uint8Array;
  size: number;
  crc: number;
  offset: number;
  time: number;
  date: number;
}

function centralRecord(e: Written): Uint8Array {
  const sizeBig = e.size >= U32_MAX;
  const offBig = e.offset >= U32_MAX;
  const extra = new Writer();
  if (sizeBig || offBig) {
    const fields = new Writer();
    if (sizeBig) fields.u64(e.size).u64(e.size);
    if (offBig) fields.u64(e.offset);
    const body = fields.done();
    extra.u16(0x0001).u16(body.length).raw(body);
  }
  const extraBytes = extra.done();
  const version = sizeBig || offBig ? 45 : 20;
  return new Writer()
    .u32(SIG_CENTRAL)
    .u16(version)
    .u16(version)
    .u16(0)
    .u16(0)
    .u16(e.time)
    .u16(e.date)
    .u32(e.crc)
    .u32(sizeBig ? U32_MAX : e.size)
    .u32(sizeBig ? U32_MAX : e.size)
    .u16(e.name.length)
    .u16(extraBytes.length)
    .u16(0)
    .u16(0)
    .u16(0)
    .u32(0)
    .u32(offBig ? U32_MAX : e.offset)
    .raw(e.name)
    .raw(extraBytes)
    .done();
}

function localHeader(e: Written): Uint8Array {
  const sizeBig = e.size >= U32_MAX;
  const extra = sizeBig
    ? new Writer().u16(0x0001).u16(16).u64(e.size).u64(e.size).done()
    : new Uint8Array(0);
  const version = sizeBig || e.offset >= U32_MAX ? 45 : 20;
  return new Writer()
    .u32(SIG_LOCAL)
    .u16(version)
    .u16(0)
    .u16(0)
    .u16(e.time)
    .u16(e.date)
    .u32(e.crc)
    .u32(sizeBig ? U32_MAX : e.size)
    .u32(sizeBig ? U32_MAX : e.size)
    .u16(e.name.length)
    .u16(extra.length)
    .raw(e.name)
    .raw(extra)
    .done();
}

function endRecords(count: number, cdOffset: number, cdSize: number): Uint8Array {
  const needs64 = count >= U16_MAX || cdSize >= U32_MAX || cdOffset >= U32_MAX;
  const w = new Writer();
  if (needs64) {
    const zip64EocdOffset = cdOffset + cdSize;
    w.u32(SIG_ZIP64_EOCD)
      .u64(44)
      .u16(45)
      .u16(45)
      .u32(0)
      .u32(0)
      .u64(count)
      .u64(count)
      .u64(cdSize)
      .u64(cdOffset);
    w.u32(SIG_ZIP64_LOCATOR).u32(0).u64(zip64EocdOffset).u32(1);
  }
  w.u32(SIG_EOCD)
    .u16(0)
    .u16(0)
    .u16(Math.min(count, U16_MAX))
    .u16(Math.min(count, U16_MAX))
    .u32(Math.min(cdSize, U32_MAX))
    .u32(Math.min(cdOffset, U32_MAX))
    .u16(0);
  return w.done();
}

async function* entryBody(
  src: ReadableStream<Uint8Array> | Uint8Array
): AsyncGenerator<Uint8Array> {
  if (src instanceof Uint8Array) {
    if (src.byteLength) yield src;
    return;
  }
  const reader = src.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value?.byteLength) yield value;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

async function* zipChunks(
  entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>,
  onSkipped?: (entry: ZipEntry) => void
): AsyncGenerator<Uint8Array> {
  const written: Written[] = [];
  let offset = 0;
  for await (const entry of entries as AsyncIterable<ZipEntry>) {
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new Error(`zip entry ${entry.name}: bad size`);
    }
    const src = await entry.open();
    if (src === null) {
      onSkipped?.(entry);
      continue;
    }
    const { time, date } = dosDateTime(entry.mtime);
    const w: Written = {
      name: new TextEncoder().encode(zipSafeName(entry.name)),
      size: entry.size,
      crc: entry.crc32 >>> 0,
      offset,
      time,
      date
    };
    const header = localHeader(w);
    yield header;
    offset += header.length;
    let seen = 0;
    let crc = 0;
    for await (const chunk of entryBody(src)) {
      seen += chunk.byteLength;
      if (seen > entry.size) throw new Error(`zip entry ${entry.name}: more bytes than its size`);
      crc = crc32(chunk, crc);
      yield chunk;
    }
    if (seen !== entry.size) throw new Error(`zip entry ${entry.name}: fewer bytes than its size`);
    if (crc !== w.crc) throw new Error(`zip entry ${entry.name}: CRC-32 mismatch`);
    offset += seen;
    written.push(w);
  }
  const cdOffset = offset;
  let cdSize = 0;
  for (const w of written) {
    const rec = centralRecord(w);
    cdSize += rec.length;
    yield rec;
  }
  yield endRecords(written.length, cdOffset, cdSize);
}

export function zipStream(
  entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>,
  opts: { onSkipped?: (entry: ZipEntry) => void } = {}
): ReadableStream<Uint8Array> {
  const it = zipChunks(entries, opts.onSkipped);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await it.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await it.return(undefined);
    }
  });
}
