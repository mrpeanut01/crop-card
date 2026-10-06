import { describe, expect, it } from 'vitest';
import { fileLooksLikeHeic, looksLikeHeic } from './photoFormat';

function ftyp(brand: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array([0, 0, 0, 0x24, ...[...`ftyp${brand}`].map((c) => c.charCodeAt(0))]);
}

describe('looksLikeHeic', () => {
  it('knows HEIC by type, name or brand', () => {
    expect(looksLikeHeic({ type: 'image/heic' })).toBe(true);
    expect(looksLikeHeic({ type: 'IMAGE/HEIF' })).toBe(true);
    expect(looksLikeHeic({ name: 'IMG_0001.HEIC' })).toBe(true);
    expect(looksLikeHeic({ name: 'leaf.heif' })).toBe(true);
    expect(looksLikeHeic({}, ftyp('heic'))).toBe(true);
    expect(looksLikeHeic({}, ftyp('heix'))).toBe(true);
  });

  it('leaves other images alone', () => {
    expect(looksLikeHeic({ type: 'image/jpeg', name: 'leaf.jpg' })).toBe(false);
    expect(looksLikeHeic({ type: 'image/avif', name: 'leaf.avif' }, ftyp('avif'))).toBe(false);
    expect(looksLikeHeic({}, new Uint8Array([0xff, 0xd8, 0xff]))).toBe(false);
    expect(looksLikeHeic({ name: 'heic-notes.pdf' })).toBe(false);
  });

  it('reads the brand from a file with no type or name', async () => {
    expect(await fileLooksLikeHeic(new Blob([ftyp('heic'), new Uint8Array(20)]))).toBe(true);
    expect(await fileLooksLikeHeic(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])]))).toBe(
      false
    );
  });
});
