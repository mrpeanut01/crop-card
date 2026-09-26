import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  configFromEnv,
  getJson,
  listNames,
  putJson,
  stringToSign,
  type BlobConfig
} from '../../../../scripts/lib/azureBlob.mjs';

const KEY = Buffer.from('not-a-real-key-not-a-real-key!!!').toString('base64');

function fakeFetch(
  status: number,
  body = '',
  headers: Record<string, string> = {}
): { calls: { url: string; init: RequestInit }[]; impl: typeof fetch } {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(status === 304 ? null : body, { status, headers });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

function cfg(impl: typeof fetch): BlobConfig {
  return { account: 'acct', key: KEY, container: 'cropcard', fetchImpl: impl };
}

describe('Shared Key string-to-sign', () => {
  it('orders x-ms headers and query params and blanks a zero length', () => {
    const s = stringToSign({
      method: 'get',
      account: 'acct',
      path: '/cropcard',
      query: { restype: 'container', comp: 'list', prefix: 'a/' },
      headers: { 'x-ms-version': '2021-08-06', 'x-ms-date': 'D', 'content-length': '0' }
    });
    expect(s).toBe(
      [
        'GET',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        'x-ms-date:D\nx-ms-version:2021-08-06\n/acct/cropcard\ncomp:list\nprefix:a/\nrestype:container'
      ].join('\n')
    );
  });

  it('signs requests with HMAC-SHA256 of the decoded account key', async () => {
    const f = fakeFetch(201, '', { etag: '"e1"' });
    await putJson(cfg(f.impl), '_ops/x.json', { a: 1 }, { ifMatch: '"e0"' });
    const h = f.calls[0].init.headers as Record<string, string>;
    const expected = createHmac('sha256', Buffer.from(KEY, 'base64'))
      .update(
        stringToSign({
          method: 'PUT',
          account: 'acct',
          path: '/cropcard/_ops/x.json',
          query: {},
          headers: h
        })
      )
      .digest('base64');
    expect(h.authorization).toBe(`SharedKey acct:${expected}`);
    expect(h['if-match']).toBe('"e0"');
    expect(h['x-ms-blob-type']).toBe('BlockBlob');
    expect(f.calls[0].url).toBe('https://acct.blob.core.windows.net/cropcard/_ops/x.json');
  });
});

describe('blob operations', () => {
  it('reads JSON, and treats 404 as absent', async () => {
    const ok = fakeFetch(200, '{"nonce":"n"}', { etag: '"e"' });
    expect(await getJson(cfg(ok.impl), 'a.json')).toEqual({ value: { nonce: 'n' }, etag: '"e"' });
    expect(await getJson(cfg(fakeFetch(404).impl), 'a.json')).toBeNull();
  });

  it('throws on auth or server errors instead of reporting "absent"', async () => {
    await expect(getJson(cfg(fakeFetch(403, 'AuthenticationFailed').impl), 'a')).rejects.toThrow(
      /HTTP 403/
    );
    await expect(listNames(cfg(fakeFetch(500).impl), 'cropcard.db/')).rejects.toThrow(/HTTP 500/);
    await expect(putJson(cfg(fakeFetch(403).impl), 'a', {})).rejects.toThrow(/HTTP 403/);
  });

  it('reports a lost conditional write without throwing', async () => {
    expect(await putJson(cfg(fakeFetch(412).impl), 'a', {}, { ifMatch: '"x"' })).toEqual({
      ok: false,
      status: 412,
      etag: null
    });
  });

  it('lists blob names under a prefix', async () => {
    const xml =
      '<?xml version="1.0"?><EnumerationResults><Blobs><Blob><Name>cropcard.db/generations/abc/snapshots/00000000.snapshot.lz4</Name></Blob></Blobs></EnumerationResults>';
    const f = fakeFetch(200, xml);
    expect(await listNames(cfg(f.impl), 'cropcard.db/generations/', 1)).toEqual([
      'cropcard.db/generations/abc/snapshots/00000000.snapshot.lz4'
    ]);
    expect(f.calls[0].url).toContain('restype=container');
    expect(f.calls[0].url).toContain('prefix=cropcard.db%2Fgenerations%2F');
    expect(await listNames(cfg(fakeFetch(200, '<Blobs/>').impl), 'x/')).toEqual([]);
  });

  it('needs all three storage settings', () => {
    expect(configFromEnv({})).toBeNull();
    expect(
      configFromEnv({
        AZURE_STORAGE_ACCOUNT: 'a',
        AZURE_STORAGE_KEY: 'k',
        AZURE_BLOB_CONTAINER: 'c'
      })
    ).toMatchObject({ account: 'a', key: 'k', container: 'c' });
  });
});
