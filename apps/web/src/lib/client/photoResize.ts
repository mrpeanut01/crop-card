/** Shrinks a camera photo to a small JPEG before it leaves the phone. Drawing
 *  it on a canvas and re-encoding drops EXIF (GPS, camera, time), and the
 *  metadata strip runs again as a second line of defence. */

import {
  JPEG_DATA_URL_PREFIX,
  MAX_PHOTO_BYTES,
  MAX_PHOTO_DIM,
  encodeBase64,
  fitWithin,
  stripJpegMetadata
} from '$lib/journal/photo';

const QUALITIES = [0.82, 0.72, 0.62, 0.52, 0.42];
const MIN_DIM = 320;

export class PhotoTooLargeError extends Error {
  constructor() {
    super('That photo could not be made small enough. Try a closer, simpler shot.');
  }
}

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* fall through to <img> decoding */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function sizeOf(src: ImageBitmap | HTMLImageElement): { width: number; height: number } {
  return 'naturalWidth' in src
    ? { width: src.naturalWidth, height: src.naturalHeight }
    : { width: src.width, height: src.height };
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/** A JPEG data URL no larger than 1024 px on its long side and 300 KB. */
export async function resizePhoto(file: Blob): Promise<string> {
  const src = await loadBitmap(file);
  const natural = sizeOf(src);
  let maxDim = MAX_PHOTO_DIM;
  while (maxDim >= MIN_DIM) {
    const { width, height } = fitWithin(natural.width, natural.height, maxDim);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot resize photos.');
    ctx.drawImage(src, 0, 0, width, height);
    for (const q of QUALITIES) {
      const blob = await toJpeg(canvas, q);
      if (!blob || blob.size > MAX_PHOTO_BYTES) continue;
      const bytes = stripJpegMetadata(new Uint8Array(await blob.arrayBuffer()));
      if (!bytes) continue;
      if ('close' in src) src.close();
      return JPEG_DATA_URL_PREFIX + encodeBase64(bytes);
    }
    maxDim = Math.floor(maxDim * 0.75);
  }
  if ('close' in src) src.close();
  throw new PhotoTooLargeError();
}
