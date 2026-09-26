import { QrCode, QrCodeEcc } from './qrcodegen';

export const QR_QUIET_ZONE = 4;

const ECC = { M: QrCodeEcc.MEDIUM } as const;

export interface QrOptions {
  ecc?: keyof typeof ECC;
}

/** Dark-module matrix, row-major, without the quiet zone. */
export function qrMatrix(text: string, opts: QrOptions = {}): boolean[][] {
  const qr = QrCode.encodeText(text, ECC[opts.ecc ?? 'M']);
  const rows: boolean[][] = [];
  for (let y = 0; y < qr.size; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < qr.size; x++) row.push(qr.getModule(x, y));
    rows.push(row);
  }
  return rows;
}

export interface QrPath {
  /** Side length in modules, quiet zone included. */
  size: number;
  d: string;
}

/** One `<path>` of horizontal runs, offset by a 4-module quiet zone. */
export function qrPath(text: string, opts: QrOptions = {}): QrPath {
  const m = qrMatrix(text, opts);
  const q = QR_QUIET_ZONE;
  let d = '';
  for (let y = 0; y < m.length; y++) {
    let x = 0;
    while (x < m.length) {
      if (!m[y][x]) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < m.length && m[y][x + run]) run++;
      d += `M${x + q} ${y + q}h${run}v1h-${run}z`;
      x += run;
    }
  }
  return { size: m.length + q * 2, d };
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function qrSvg(text: string, opts: QrOptions = {}): string {
  const { size: n, d } = qrPath(text, opts);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"` +
    ` role="img" aria-label="QR code: ${escapeAttr(text)}">` +
    `<rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`
  );
}
