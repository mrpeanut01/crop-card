import {
  safeFetch,
  type SafeFetchBinaryResponse,
  type SafeFetchOptions
} from '$lib/server/safeFetch';
import { weatherFeedsOff } from '$lib/server/weather';
import type { PhotoExtent } from '$lib/siteFinder/geometry';

/**
 * One USDA NAIP aerial photo for Find a spot, from the USGS National Map
 * image service (public domain, no key). Owner ruling O-1: this is the only
 * imagery ever sent to an AI service; the map tiles the page shows are
 * display-only and never pass through here. The photo is fetched per run and
 * never stored. A failure is "no photo", never an error.
 */

export const NAIP_HOST = 'imagery.nationalmap.gov';
export const NAIP_EXPORT_URL = `https://${NAIP_HOST}/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage`;
export const NAIP_IMAGE_PX = 1024;
export const NAIP_TIMEOUT_MS = 15_000;
export const NAIP_MAX_BYTES = 1_500_000;
/** A real 1024px photo is tens of kilobytes at least. Anything smaller is a
 *  blank tile. */
export const NAIP_MIN_BYTES = 6_000;

export type NaipFetcher = (url: string, opts: SafeFetchOptions) => Promise<SafeFetchBinaryResponse>;

export type NaipPhoto =
  | { status: 'ok'; base64: string; mediaType: 'image/jpeg'; bytes: number }
  /** The service answered, but it has no photo of this ground. */
  | { status: 'no-coverage' }
  /** The service could not be reached or sent something unusable. */
  | { status: 'unavailable' };

function validExtent(e: PhotoExtent): boolean {
  return (
    [e.minX, e.minY, e.maxX, e.maxY].every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    e.minX < e.maxX &&
    e.minY < e.maxY
  );
}

/** The one request this module sends. The only variable parts are four
 *  numbers written with fixed decimals. `format=jpgpng` answers with a JPEG
 *  where the photo covers the whole extent and a PNG where it does not. */
export function naipUrl(extent: PhotoExtent): string {
  if (!validExtent(extent)) throw new RangeError('photo extent out of range');
  const bbox = [extent.minX, extent.minY, extent.maxX, extent.maxY].map((v) => v.toFixed(2));
  return (
    `${NAIP_EXPORT_URL}?bbox=${bbox.join(',')}&bboxSR=3857&imageSR=3857` +
    `&size=${NAIP_IMAGE_PX},${NAIP_IMAGE_PX}&format=jpgpng&f=image`
  );
}

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** One image request, host-pinned (no redirects), capped and timed out.
 *  Never throws. */
export async function fetchNaipPhoto(
  extent: PhotoExtent,
  fetcher: NaipFetcher = safeFetch
): Promise<NaipPhoto> {
  if (!validExtent(extent)) return { status: 'unavailable' };
  try {
    const res = await fetcher(naipUrl(extent), {
      timeoutMs: NAIP_TIMEOUT_MS,
      maxBytes: NAIP_MAX_BYTES,
      maxRedirects: 0,
      headers: { accept: 'image/jpeg,image/png' }
    });
    if (res.status !== 200 || new URL(res.url).hostname !== NAIP_HOST) {
      res.cancel();
      return { status: 'unavailable' };
    }
    const type = res.contentType.toLowerCase();
    const { bytes, truncated } = await res.readBytes();
    if (truncated) return { status: 'unavailable' };
    if (type.startsWith('image/png')) return { status: 'no-coverage' };
    if (!type.startsWith('image/jpeg') || !isJpeg(bytes)) return { status: 'unavailable' };
    if (bytes.byteLength < NAIP_MIN_BYTES) return { status: 'no-coverage' };
    return {
      status: 'ok',
      base64: Buffer.from(bytes).toString('base64'),
      mediaType: 'image/jpeg',
      bytes: bytes.byteLength
    };
  } catch {
    return { status: 'unavailable' };
  }
}

/** The recorded Loudoun photo is served only on a dev-routes server that
 *  asked for it (the main e2e preview server), never in production. */
export function naipFixtureEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.E2E_NAIP_FIXTURE === '1' && env.ENABLE_DEV_ROUTES === '1';
}

/** The aerial photo for an extent. Honours `WEATHER_FEEDS=off`. Never
 *  throws, never caches and never stores the image. */
export async function naipPhotoFor(
  extent: PhotoExtent,
  opts: { fetcher?: NaipFetcher } = {}
): Promise<NaipPhoto> {
  if (naipFixtureEnabled()) {
    const fixture = (await import('$lib/server/__fixtures__/naip-loudoun.json')).default;
    return {
      status: 'ok',
      base64: fixture.base64,
      mediaType: 'image/jpeg',
      bytes: Math.floor((fixture.base64.length * 3) / 4)
    };
  }
  if (weatherFeedsOff()) return { status: 'unavailable' };
  return fetchNaipPhoto(extent, opts.fetcher);
}
