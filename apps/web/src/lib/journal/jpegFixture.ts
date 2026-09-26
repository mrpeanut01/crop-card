/** Test-only JPEG bytes: a structurally valid file with optional EXIF (GPS
 *  text) and comment segments, so metadata stripping can be checked. */

function seg(marker: number, payload: number[]): number[] {
  const len = payload.length + 2;
  return [0xff, marker, (len >> 8) & 0xff, len & 0xff, ...payload];
}

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

export const EXIF_SECRET = 'GPS 39.1157N 77.5636W';

export function fakeJpeg(
  opts: { exif?: boolean; comment?: boolean; padding?: number } = {}
): Uint8Array {
  const bytes: number[] = [0xff, 0xd8];
  bytes.push(...seg(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]));
  if (opts.exif) bytes.push(...seg(0xe1, [...ascii('Exif'), 0, 0, ...ascii(EXIF_SECRET)]));
  if (opts.comment) bytes.push(...seg(0xfe, ascii('taken at home')));
  bytes.push(...seg(0xdb, [0, ...new Array(64).fill(1)]));
  bytes.push(...seg(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]));
  bytes.push(...seg(0xda, [1, 1, 0, 0, 0x3f, 0]));
  bytes.push(0xd2, 0xcf, 0x20);
  for (let i = 0; i < (opts.padding ?? 0); i++) bytes.push(0x55);
  bytes.push(0xff, 0x00, 0x12);
  bytes.push(0xff, 0xd9);
  return Uint8Array.from(bytes);
}

export function toDataUrl(bytes: Uint8Array): string {
  return `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`;
}
