import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  QRCodeReader,
  RGBLuminanceSource
} from '@zxing/library';
import { QR_QUIET_ZONE, qrMatrix, qrSvg } from './index';

const PX = 4;

function decode(matrix: boolean[][]): string {
  const n = matrix.length + QR_QUIET_ZONE * 2;
  const size = n * PX;
  const lum = new Uint8ClampedArray(size * size).fill(255);
  matrix.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < PX; dy++) {
        for (let dx = 0; dx < PX; dx++) {
          lum[((y + QR_QUIET_ZONE) * PX + dy) * size + (x + QR_QUIET_ZONE) * PX + dx] = 0;
        }
      }
    })
  );
  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, size, size)));
  const hints = new Map<DecodeHintType, unknown>([
    [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]],
    [DecodeHintType.PURE_BARCODE, true]
  ]);
  return new QRCodeReader().decode(bitmap, hints).getText();
}

describe('qrSvg', () => {
  const url = 'https://app.cropcard.io/c/pl_8f2c1e0a';

  it('is deterministic', () => {
    expect(qrSvg(url)).toBe(qrSvg(url));
    expect(qrSvg(url)).not.toBe(qrSvg(`${url}x`));
  });

  it('is one path with crisp edges and a 4-module quiet zone', () => {
    const svg = qrSvg(url);
    const n = qrMatrix(url).length + 8;
    expect(svg).toContain(`viewBox="0 0 ${n} ${n}"`);
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg.match(/<path /g)).toHaveLength(1);
    const coords = [...svg.matchAll(/M(\d+) (\d+)/g)].map((m) => [+m[1], +m[2]]);
    expect(Math.min(...coords.map((c) => c[0]))).toBe(QR_QUIET_ZONE);
    expect(Math.min(...coords.map((c) => c[1]))).toBe(QR_QUIET_ZONE);
  });

  it('escapes the aria label', () => {
    expect(qrSvg('a"<b&')).toContain('aria-label="QR code: a&quot;&lt;b&amp;"');
  });

  it('round-trips through the zxing decoder', () => {
    expect(decode(qrMatrix(url))).toBe(url);
  });

  it('property: arbitrary card URLs decode back to themselves', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z]{2}_[A-Za-z0-9_-]{1,40}$/), (key) => {
        const text = `https://app.cropcard.io/c/${key}`;
        expect(decode(qrMatrix(text))).toBe(text);
      }),
      { numRuns: 40 }
    );
  });
});
