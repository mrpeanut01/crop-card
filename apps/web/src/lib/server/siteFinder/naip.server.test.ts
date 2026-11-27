// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SafeFetchError, safeFetch, type SafeFetchOptions } from '$lib/server/safeFetch';
import { photoExtentAround } from '$lib/siteFinder/geometry';
import fixture from '$lib/server/__fixtures__/naip-loudoun.json';
import {
  NAIP_HOST,
  NAIP_IMAGE_PX,
  NAIP_MAX_BYTES,
  NAIP_MIN_BYTES,
  fetchNaipPhoto,
  isJpeg,
  naipFixtureEnabled,
  naipPhotoFor,
  naipUrl,
  type NaipFetcher
} from './naip.server';

const extent = photoExtentAround([-77.69888, 39.07881], 200);
const jpeg = (size = 20_000) => {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return bytes;
};

function fetcherReturning(
  res:
    | {
        status?: number;
        contentType?: string;
        bytes?: Uint8Array;
        truncated?: boolean;
        url?: string;
      }
    | Error
) {
  const calls: Array<{ url: string; opts: SafeFetchOptions }> = [];
  const cancel = vi.fn();
  const fetcher: NaipFetcher = async (url, opts) => {
    calls.push({ url, opts });
    if (res instanceof Error) throw res;
    return {
      url: res.url ?? url,
      status: res.status ?? 200,
      contentType: res.contentType ?? 'image/jpeg',
      readText: async () => ({ text: '', truncated: false }),
      readBytes: async () => ({ bytes: res.bytes ?? jpeg(), truncated: res.truncated ?? false }),
      cancel
    };
  };
  return { fetcher, calls, cancel };
}

const ENV_VARS = ['WEATHER_FEEDS', 'E2E_NAIP_FIXTURE', 'ENABLE_DEV_ROUTES'] as const;
const savedEnv = Object.fromEntries(ENV_VARS.map((k) => [k, process.env[k]]));
beforeEach(() => {
  for (const k of ENV_VARS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_VARS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('naipUrl', () => {
  it('asks the USGS image service for a square Web Mercator JPEG of the extent', () => {
    const url = new URL(naipUrl(extent));
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe(NAIP_HOST);
    expect(url.pathname).toBe('/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage');
    expect(url.searchParams.get('bboxSR')).toBe('3857');
    expect(url.searchParams.get('imageSR')).toBe('3857');
    expect(url.searchParams.get('size')).toBe(`${NAIP_IMAGE_PX},${NAIP_IMAGE_PX}`);
    expect(url.searchParams.get('format')).toBe('jpgpng');
    expect(url.searchParams.get('f')).toBe('image');
    const bbox = url.searchParams.get('bbox')!.split(',').map(Number);
    expect(bbox).toHaveLength(4);
    expect(bbox[2] - bbox[0]).toBeCloseTo(bbox[3] - bbox[1], 1);
    expect(bbox[0]).toBeCloseTo(extent.minX, 1);
    expect(bbox[3]).toBeCloseTo(extent.maxY, 1);
  });

  it('refuses an extent that is not finite numbers in order', () => {
    expect(() => naipUrl({ ...extent, minX: Number.NaN })).toThrow(RangeError);
    expect(() => naipUrl({ ...extent, maxX: extent.minX })).toThrow(RangeError);
  });
});

describe('fetchNaipPhoto', () => {
  it('returns the photo as base64, host-pinned with no redirects, a cap and a timeout', async () => {
    const bytes = jpeg(30_000);
    const { fetcher, calls } = fetcherReturning({ bytes });
    const out = await fetchNaipPhoto(extent, fetcher);
    expect(out).toMatchObject({ status: 'ok', mediaType: 'image/jpeg', bytes: 30_000 });
    if (out.status === 'ok') expect(Buffer.from(out.base64, 'base64')).toHaveLength(30_000);
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).hostname).toBe(NAIP_HOST);
    expect(calls[0].opts).toMatchObject({ maxRedirects: 0, maxBytes: NAIP_MAX_BYTES });
    expect(calls[0].opts.timeoutMs).toBeGreaterThan(0);
    expect(calls[0].opts.method).toBeUndefined();
    expect(calls[0].opts.body).toBeUndefined();
  });

  it('a PNG answer means the service has no photo of this ground', async () => {
    const { fetcher } = fetcherReturning({ contentType: 'image/png', bytes: new Uint8Array(4144) });
    expect(await fetchNaipPhoto(extent, fetcher)).toEqual({ status: 'no-coverage' });
  });

  it('a tiny JPEG is a blank tile', async () => {
    const { fetcher } = fetcherReturning({ bytes: jpeg(NAIP_MIN_BYTES - 1) });
    expect(await fetchNaipPhoto(extent, fetcher)).toEqual({ status: 'no-coverage' });
  });

  it('is unavailable for a bad status, another host, a cut-off body or the wrong bytes', async () => {
    const cases = [
      fetcherReturning({ status: 500 }),
      fetcherReturning({ status: 302 }),
      fetcherReturning({ url: 'https://example.com/exportImage' }),
      fetcherReturning({ truncated: true }),
      fetcherReturning({ bytes: new Uint8Array(20_000) }),
      fetcherReturning({ contentType: 'text/html', bytes: jpeg() }),
      fetcherReturning(new SafeFetchError('timeout', 'Request timed out')),
      fetcherReturning(new SafeFetchError('too-many-redirects', 'no redirects')),
      fetcherReturning(new Error('ENOTFOUND'))
    ];
    for (const c of cases) {
      expect(await fetchNaipPhoto(extent, c.fetcher)).toEqual({ status: 'unavailable' });
    }
    expect(cases[0].cancel).toHaveBeenCalled();
    expect(cases[2].cancel).toHaveBeenCalled();
  });

  it('never fetches for a bad extent', async () => {
    const { fetcher, calls } = fetcherReturning({});
    expect(await fetchNaipPhoto({ ...extent, minY: Infinity }, fetcher)).toEqual({
      status: 'unavailable'
    });
    expect(calls).toHaveLength(0);
  });

  it('isJpeg reads the magic bytes', () => {
    expect(isJpeg(jpeg())).toBe(true);
    expect(isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(isJpeg(new Uint8Array(0))).toBe(false);
  });
});

describe('safeFetch byte read', () => {
  const resolver = async () => [{ address: '93.184.216.34', family: 4 as const }];
  const connectorFor = (chunks: Uint8Array[], status = 200, headers = {}) =>
    vi.fn(async () => ({
      status,
      headers: { 'content-type': 'image/jpeg', ...headers },
      body: (async function* () {
        for (const c of chunks) yield c;
      })(),
      destroy: vi.fn()
    }));

  it('returns the bytes unchanged', async () => {
    const a = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x80]);
    const b = new Uint8Array([0xfe, 0x01]);
    const res = await safeFetch('https://example.com/a.jpg', {
      resolver,
      connector: connectorFor([a, b])
    });
    const { bytes, truncated } = await res.readBytes();
    expect(truncated).toBe(false);
    expect([...bytes]).toEqual([...a, ...b]);
    await expect(res.readBytes()).rejects.toThrow(/already read/);
  });

  it('stops at maxBytes and says so', async () => {
    const res = await safeFetch('https://example.com/a.jpg', {
      resolver,
      maxBytes: 6,
      connector: connectorFor([new Uint8Array(4), new Uint8Array(4), new Uint8Array(4)])
    });
    const { bytes, truncated } = await res.readBytes();
    expect(truncated).toBe(true);
    expect(bytes.byteLength).toBe(6);
  });

  it('keeps every address check: a private address is refused before any connection', async () => {
    const connector = connectorFor([new Uint8Array(1)]);
    await expect(
      safeFetch('https://example.com/a.jpg', {
        resolver: async () => [{ address: '10.0.0.5', family: 4 as const }],
        connector
      })
    ).rejects.toBeInstanceOf(SafeFetchError);
    expect(connector).not.toHaveBeenCalled();
  });

  it('with maxRedirects 0 a redirect is refused, so the request stays on the pinned host', async () => {
    const connector = connectorFor([], 302, { location: 'https://evil.example/x.jpg' });
    await expect(
      safeFetch('https://example.com/a.jpg', { resolver, connector, maxRedirects: 0 })
    ).rejects.toMatchObject({ code: 'too-many-redirects' });
    expect(connector).toHaveBeenCalledTimes(1);
  });
});

describe('naipPhotoFor', () => {
  it('is unavailable with WEATHER_FEEDS=off and never fetches', async () => {
    process.env.WEATHER_FEEDS = 'off';
    const { fetcher, calls } = fetcherReturning({});
    expect(await naipPhotoFor(extent, { fetcher })).toEqual({ status: 'unavailable' });
    expect(calls).toHaveLength(0);
  });

  it('fetches when feeds are on', async () => {
    const { fetcher, calls } = fetcherReturning({});
    expect((await naipPhotoFor(extent, { fetcher })).status).toBe('ok');
    expect(calls).toHaveLength(1);
  });
});

describe('the e2e aerial photo fixture', () => {
  it('needs both flags', () => {
    expect(naipFixtureEnabled({ E2E_NAIP_FIXTURE: '1', ENABLE_DEV_ROUTES: '1' })).toBe(true);
    for (const env of [
      {},
      { E2E_NAIP_FIXTURE: '1' },
      { ENABLE_DEV_ROUTES: '1' },
      { E2E_NAIP_FIXTURE: 'true', ENABLE_DEV_ROUTES: '1' },
      { E2E_NAIP_FIXTURE: '1', ENABLE_DEV_ROUTES: 'yes' }
    ]) {
      expect(naipFixtureEnabled(env)).toBe(false);
    }
  });

  it('serves the recorded Loudoun photo with feeds off and no fetch', async () => {
    process.env.E2E_NAIP_FIXTURE = '1';
    process.env.ENABLE_DEV_ROUTES = '1';
    process.env.WEATHER_FEEDS = 'off';
    const { fetcher, calls } = fetcherReturning(new Error('should not be called'));
    const out = await naipPhotoFor(extent, { fetcher });
    expect(out.status).toBe('ok');
    if (out.status === 'ok') {
      const bytes = Buffer.from(out.base64, 'base64');
      expect(isJpeg(bytes)).toBe(true);
      expect(bytes.byteLength).toBeGreaterThan(NAIP_MIN_BYTES);
    }
    expect(calls).toHaveLength(0);
  });

  it('is off with only one flag', async () => {
    process.env.E2E_NAIP_FIXTURE = '1';
    process.env.WEATHER_FEEDS = 'off';
    expect(await naipPhotoFor(extent)).toEqual({ status: 'unavailable' });
  });

  it('the recorded photo is a small real JPEG with its source noted', () => {
    const bytes = Buffer.from(fixture.base64, 'base64');
    expect(isJpeg(bytes)).toBe(true);
    expect(bytes.byteLength).toBeLessThan(150_000);
    expect(fixture.source).toMatch(/NAIP/);
    expect(fixture.recorded).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  const repo = (rel: string) => readFileSync(resolve(process.cwd(), '../..', rel), 'utf8');

  for (const file of ['infra/azure/main.bicep', 'infra/Dockerfile', 'infra/docker-compose.yml']) {
    it(`${file} never mentions E2E_NAIP_FIXTURE`, () => {
      expect(repo(file)).not.toMatch(/E2E_NAIP_FIXTURE/);
    });
  }

  it('infra/.env.dev.example documents the flag without setting it', () => {
    const text = repo('infra/.env.dev.example');
    expect(text).toMatch(/E2E_NAIP_FIXTURE/);
    for (const line of text.split('\n')) {
      if (line.includes('E2E_NAIP_FIXTURE')) expect(line.startsWith('#')).toBe(true);
    }
  });

  it('the Playwright config sets it on the main preview server only', () => {
    const config = repo('apps/web/playwright.config.ts');
    expect(config.match(/E2E_NAIP_FIXTURE=1 /g)).toHaveLength(1);
    const main = config.indexOf('E2E_NAIP_FIXTURE=1 ');
    const magic = config.indexOf('AUTH_MODE=magic-link AUTH_SECRET');
    expect(main).toBeGreaterThan(0);
    expect(main).toBeLessThan(magic);
  });
});

describe('owner ruling O-1: map tiles are never sent to an AI service', () => {
  const root = resolve(process.cwd(), 'src');
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]
    );

  it('no Find a spot server or API code names the display tile service', () => {
    const scanned = [
      ...files(join(root, 'lib/server/siteFinder')),
      ...files(join(root, 'routes/api/site-finder')),
      join(root, 'lib/server/aiFixture/siteFinder.ts'),
      join(root, 'routes/plan/site-finder/+page.server.ts'),
      ...files(join(root, 'lib/siteFinder'))
    ].filter((f) => !f.endsWith('.test.ts'));
    expect(scanned.length).toBeGreaterThan(8);
    for (const file of scanned) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/arcgisonline|World_Imagery|mapTiles/i);
    }
  });

  it('the only image host the server code names is the USGS NAIP service', () => {
    const text = readFileSync(join(root, 'lib/server/siteFinder/naip.server.ts'), 'utf8');
    const urls = text.match(/https?:\/\/[^\s'"`]+/g) ?? [];
    expect(urls).toHaveLength(1);
    expect(urls[0]?.startsWith('https://${NAIP_HOST}/')).toBe(true);
    expect(text).toContain("NAIP_HOST = 'imagery.nationalmap.gov'");
  });
});
