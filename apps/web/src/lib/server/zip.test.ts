// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import fc from 'fast-check';
import { _crc32Js, crc32, zipSafeName, zipStream, type ZipEntry } from './zip';

const enc = new TextEncoder();

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  return Buffer.concat(parts);
}

function entry(name: string, data: Uint8Array, opts: Partial<ZipEntry> = {}): ZipEntry {
  return {
    name,
    mtime: new Date(Date.UTC(2026, 3, 15, 10, 30, 20)),
    size: data.length,
    crc32: crc32(data),
    open: async () =>
      new ReadableStream({
        start(c) {
          for (let i = 0; i < data.length; i += 7) c.enqueue(data.subarray(i, i + 7));
          c.close();
        }
      }),
    ...opts
  };
}

interface ReadEntry {
  name: string;
  size: number;
  crc: number;
  offset: number;
  data: Uint8Array;
  versionNeeded: number;
}

/** Independent reader: EOCD (and ZIP64 EOCD) → central directory → local
 *  headers, checking sizes, CRCs and offsets agree. */
function readZip(buf: Uint8Array): { entries: ReadEntry[]; zip64: boolean } {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const eocd = buf.length - 22;
  expect(dv.getUint32(eocd, true)).toBe(0x06054b50);
  let count = dv.getUint16(eocd + 10, true);
  let cdSize = dv.getUint32(eocd + 12, true);
  let cdOffset = dv.getUint32(eocd + 16, true);
  let zip64 = false;
  if (buf.length >= 42 && dv.getUint32(eocd - 20, true) === 0x07064b50) {
    zip64 = true;
    const z = Number(dv.getBigUint64(eocd - 20 + 8, true));
    expect(dv.getUint32(z, true)).toBe(0x06064b50);
    count = Number(dv.getBigUint64(z + 32, true));
    cdSize = Number(dv.getBigUint64(z + 40, true));
    cdOffset = Number(dv.getBigUint64(z + 48, true));
    expect(z).toBe(cdOffset + cdSize);
  }
  const entries: ReadEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    expect(dv.getUint32(p, true)).toBe(0x02014b50);
    const versionNeeded = dv.getUint16(p + 6, true);
    expect(dv.getUint16(p + 8, true) & 0x0008).toBe(0);
    expect(dv.getUint16(p + 10, true)).toBe(0);
    const crc = dv.getUint32(p + 16, true);
    let size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    let offset = dv.getUint32(p + 42, true);
    const name = Buffer.from(buf.subarray(p + 46, p + 46 + nameLen)).toString('latin1');
    let e = p + 46 + nameLen;
    const end = e + extraLen;
    while (e < end) {
      const id = dv.getUint16(e, true);
      const len = dv.getUint16(e + 2, true);
      if (id === 1) {
        let q = e + 4;
        if (size === 0xffffffff) {
          size = Number(dv.getBigUint64(q, true));
          q += 16;
        }
        if (offset === 0xffffffff) offset = Number(dv.getBigUint64(q, true));
      }
      e += 4 + len;
    }
    expect(dv.getUint32(offset, true)).toBe(0x04034b50);
    expect(dv.getUint32(offset + 14, true)).toBe(crc);
    const lNameLen = dv.getUint16(offset + 26, true);
    const lExtraLen = dv.getUint16(offset + 28, true);
    const dataStart = offset + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(dataStart, dataStart + size);
    expect(crc32(data)).toBe(crc);
    entries.push({ name, size, crc, offset, data, versionNeeded });
    p = end + dv.getUint16(p + 32, true);
  }
  expect(p).toBe(cdOffset + cdSize);
  return { entries, zip64 };
}

function unzipTest(buf: Uint8Array): string | null {
  if (!existsSync('/usr/bin/unzip')) return null;
  const dir = mkdtempSync(path.join(tmpdir(), 'zip-test-'));
  try {
    const f = path.join(dir, 'a.zip');
    writeFileSync(f, buf);
    return execFileSync('/usr/bin/unzip', ['-tq', f], { encoding: 'utf8', maxBuffer: 1 << 26 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('crc32', () => {
  it('matches the known check value and the pure-JS table', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
    expect(_crc32Js(enc.encode('123456789'))).toBe(0xcbf43926);
  });

  it('is incremental: crc(a+b) = crc(b, crc(a))', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), fc.uint8Array({ maxLength: 300 }), (a, b) => {
        const whole = crc32(Buffer.concat([a, b]));
        expect(crc32(b, crc32(a))).toBe(whole);
        expect(_crc32Js(b, _crc32Js(a))).toBe(whole);
      })
    );
  });
});

describe('zipStream', () => {
  it('writes a store-only archive that reads back byte for byte', async () => {
    const files = [
      entry('export.json', enc.encode(JSON.stringify({ hello: 'world' }))),
      entry('documents/a-lab-report.pdf', enc.encode('%PDF-1.4 fake')),
      entry('documents/empty.csv', new Uint8Array(0))
    ];
    const buf = await collect(zipStream(files));
    const { entries, zip64 } = readZip(buf);
    expect(zip64).toBe(false);
    expect(entries.map((e) => e.name)).toEqual(files.map((f) => f.name));
    expect(Buffer.from(entries[0].data).toString()).toBe('{"hello":"world"}');
    expect(entries.every((e) => e.versionNeeded === 20)).toBe(true);
    const out = unzipTest(buf);
    if (out !== null) expect(out).toContain('No errors detected');
  });

  it('round-trips random entries (property)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.uint8Array({ maxLength: 2000 }), { minLength: 0, maxLength: 6 }),
        async (datas) => {
          const files = datas.map((d, i) => entry(`f${i}.bin`, d));
          const { entries } = readZip(await collect(zipStream(files)));
          expect(entries.map((e) => Buffer.from(e.data))).toEqual(datas.map((d) => Buffer.from(d)));
        }
      ),
      { numRuns: 40 }
    );
  });

  it('accepts a Uint8Array body and an async iterable of entries', async () => {
    const data = enc.encode('bytes');
    async function* gen() {
      yield { ...entry('x.txt', data), open: async () => data };
    }
    const { entries } = readZip(await collect(zipStream(gen())));
    expect(Buffer.from(entries[0].data).toString()).toBe('bytes');
  });

  it('skips an entry whose body is missing and reports it', async () => {
    const skipped: string[] = [];
    const files = [
      entry('a.txt', enc.encode('a')),
      { ...entry('gone.pdf', enc.encode('zz')), open: async () => null },
      entry('b.txt', enc.encode('b'))
    ];
    const buf = await collect(zipStream(files, { onSkipped: (e) => skipped.push(e.name) }));
    expect(skipped).toEqual(['gone.pdf']);
    expect(readZip(buf).entries.map((e) => e.name)).toEqual(['a.txt', 'b.txt']);
  });

  it('errors the stream when an entry is shorter, longer or has another CRC', async () => {
    const data = enc.encode('hello');
    await expect(collect(zipStream([{ ...entry('a', data), size: 6 }]))).rejects.toThrow(/fewer/);
    await expect(collect(zipStream([{ ...entry('a', data), size: 4 }]))).rejects.toThrow(/more/);
    await expect(collect(zipStream([{ ...entry('a', data), crc32: 1 }]))).rejects.toThrow(/CRC/);
  });

  it('keeps names ASCII', () => {
    expect(zipSafeName('documents/soil-test-été.pdf')).toBe('documents/soil-test-_t_.pdf');
    expect(zipSafeName('/abs\\path')).toBe('abs/path');
  });

  it('writes ZIP64 end records when there are 65,535 or more entries', async () => {
    const n = 65_536;
    const empty = new Uint8Array(0);
    function* many() {
      for (let i = 0; i < n; i++) {
        yield {
          name: `e${i}`,
          mtime: new Date(0),
          size: 0,
          crc32: 0,
          open: async () => empty
        } satisfies ZipEntry;
      }
    }
    const buf = await collect(zipStream(many()));
    const { entries, zip64 } = readZip(buf);
    expect(zip64).toBe(true);
    expect(entries.length).toBe(n);
    const out = unzipTest(buf);
    if (out !== null) expect(out).toContain('No errors detected');
  }, 60_000);

  it('writes ZIP64 extra fields for a 4 GiB entry built from a sparse stream', async () => {
    const CHUNK = 1 << 20;
    const zeros = new Uint8Array(CHUNK);
    const bigSize = 0x100000000 + 5;
    let crc = 0;
    for (let left = bigSize; left > 0; left -= CHUNK)
      crc = crc32(zeros.subarray(0, Math.min(CHUNK, left)), crc);
    const sparse = (): ReadableStream<Uint8Array> => {
      let left = bigSize;
      return new ReadableStream({
        pull(c) {
          if (left <= 0) return c.close();
          const n = Math.min(CHUNK, left);
          left -= n;
          c.enqueue(zeros.subarray(0, n));
        }
      });
    };
    const tail = enc.encode('after the big one');
    const files: ZipEntry[] = [
      { name: 'big.bin', mtime: new Date(), size: bigSize, crc32: crc, open: async () => sparse() },
      entry('small.txt', tail)
    ];

    // Keep only the head and a rolling tail so the test never holds 4 GiB.
    let total = 0;
    const head: Uint8Array[] = [];
    let headLen = 0;
    let tailBuf = new Uint8Array(0);
    const reader = zipStream(files).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (headLen < 256) {
        head.push(value.subarray(0, 256 - headLen));
        headLen += Math.min(256, value.length);
      }
      total += value.length;
      const joined = Buffer.concat([tailBuf, value]);
      tailBuf = joined.subarray(Math.max(0, joined.length - 4096));
    }
    const h = Buffer.concat(head);
    const hv = new DataView(h.buffer, h.byteOffset, h.byteLength);
    expect(hv.getUint32(0, true)).toBe(0x04034b50);
    expect(hv.getUint16(4, true)).toBe(45);
    expect(hv.getUint32(18, true)).toBe(0xffffffff);
    expect(hv.getUint32(22, true)).toBe(0xffffffff);
    const nameLen = hv.getUint16(26, true);
    const extra = 30 + nameLen;
    expect(hv.getUint16(extra, true)).toBe(1);
    expect(Number(hv.getBigUint64(extra + 4, true))).toBe(bigSize);

    const t = tailBuf;
    const tv = new DataView(t.buffer, t.byteOffset, t.byteLength);
    const eocd = t.length - 22;
    expect(tv.getUint32(eocd, true)).toBe(0x06054b50);
    expect(tv.getUint32(eocd + 16, true)).toBe(0xffffffff);
    expect(tv.getUint32(eocd - 20, true)).toBe(0x07064b50);
    const z64 = eocd - 20 - 56;
    expect(tv.getUint32(z64, true)).toBe(0x06064b50);
    const count = Number(tv.getBigUint64(z64 + 32, true));
    const cdSize = Number(tv.getBigUint64(z64 + 40, true));
    const cdOffset = Number(tv.getBigUint64(z64 + 48, true));
    expect(count).toBe(2);
    expect(cdOffset + cdSize + 56 + 20 + 22).toBe(total);
    const smallLocal = 30 + nameLen + 20 + bigSize;
    expect(cdOffset).toBe(smallLocal + 30 + 'small.txt'.length + tail.length);
    // Second central record: offset past 4 GiB lives in its ZIP64 extra.
    const cdStartInTail = t.length - (total - cdOffset);
    const firstLen = 46 + nameLen + tv.getUint16(cdStartInTail + 30, true);
    const second = cdStartInTail + firstLen;
    expect(tv.getUint32(second, true)).toBe(0x02014b50);
    expect(tv.getUint16(second + 6, true)).toBe(45);
    expect(tv.getUint32(second + 42, true)).toBe(0xffffffff);
    const sNameLen = tv.getUint16(second + 28, true);
    const sExtra = second + 46 + sNameLen;
    expect(tv.getUint16(sExtra, true)).toBe(1);
    expect(tv.getUint16(sExtra + 2, true)).toBe(8);
    expect(Number(tv.getBigUint64(sExtra + 4, true))).toBe(smallLocal);
  }, 180_000);
});
