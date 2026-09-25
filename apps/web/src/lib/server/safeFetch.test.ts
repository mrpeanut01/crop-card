import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import {
  assertUrlAllowed,
  isPublicAddress,
  nodeConnector,
  safeFetch,
  SafeFetchError,
  type ConnectArgs,
  type Connector,
  type RawResponse,
  type Resolver
} from './safeFetch';

const PUBLIC_V4 = '93.184.216.34';

function body(...chunks: Array<string | Uint8Array>): AsyncIterable<Uint8Array> {
  return (async function* () {
    for (const c of chunks) yield typeof c === 'string' ? new TextEncoder().encode(c) : c;
  })();
}

function response(
  status: number,
  headers: Record<string, string> = {},
  b: AsyncIterable<Uint8Array> = body('')
): RawResponse {
  return { status, headers, body: b, destroy: vi.fn() };
}

const publicResolver: Resolver = async () => [{ address: PUBLIC_V4, family: 4 }];

function routes(map: Record<string, RawResponse | (() => RawResponse)>): Connector & {
  calls: ConnectArgs[];
} {
  const calls: ConnectArgs[] = [];
  const fn = (async (args: ConnectArgs) => {
    calls.push(args);
    const r = map[args.url.toString()];
    if (!r) throw new Error(`unexpected connect to ${args.url}`);
    return typeof r === 'function' ? r() : r;
  }) as Connector & { calls: ConnectArgs[] };
  fn.calls = calls;
  return fn;
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(SafeFetchError);
  await expect(p).rejects.toMatchObject({ code });
}

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '100.127.255.255',
    '224.0.0.1',
    '255.255.255.255',
    '198.18.0.1',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '::ffff:a9fe:a9fe',
    '64:ff9b::a9fe:a9fe',
    '2002:c0a8:0101::1',
    'fc00::1',
    'fd00:ec2::254',
    'fe80::1',
    'fe80::1%eth0',
    'ff02::1',
    '2001:db8::1',
    '2001::1',
    '::127.0.0.1',
    'not-an-ip'
  ])('%s is not public', (addr) => {
    expect(isPublicAddress(addr)).toBe(false);
  });

  it.each([
    '93.184.216.34',
    '8.8.8.8',
    '172.32.0.1',
    '100.128.0.1',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
    '2002:0808:0808::1'
  ])('%s is public', (addr) => {
    expect(isPublicAddress(addr)).toBe(true);
  });
});

describe('assertUrlAllowed (no DNS)', () => {
  it.each([
    ['http://127.0.0.1/', 'blocked-address'],
    ['http://10.1.2.3/', 'blocked-address'],
    ['http://172.16.5.5/', 'blocked-address'],
    ['http://192.168.0.10/', 'blocked-address'],
    ['http://169.254.169.254/latest/meta-data/', 'blocked-address'],
    ['http://0.0.0.0/', 'blocked-address'],
    ['http://[::1]/', 'blocked-address'],
    ['http://[::ffff:127.0.0.1]/', 'blocked-address'],
    ['http://[fc00::1]/', 'blocked-address'],
    ['http://[fd00:ec2::254]/', 'blocked-address'],
    ['http://[fe80::1]/', 'blocked-address'],
    ['http://100.64.0.1/', 'blocked-address'],
    ['http://2130706433/', 'blocked-address'],
    ['http://0x7f000001/', 'blocked-address'],
    ['http://0177.0.0.1/', 'blocked-address'],
    ['http://127.1/', 'blocked-address'],
    ['http://localhost/', 'blocked-address'],
    ['http://foo.localhost/', 'blocked-address'],
    ['file:///etc/passwd', 'bad-scheme'],
    ['gopher://example.com/', 'bad-scheme'],
    ['ftp://example.com/', 'bad-scheme'],
    ['http://user:pass@example.com/', 'credentials'],
    ['not a url', 'invalid-url']
  ])('%s → %s', (url, code) => {
    expect(() => assertUrlAllowed(url)).toThrow(SafeFetchError);
    try {
      assertUrlAllowed(url);
    } catch (e) {
      expect((e as SafeFetchError).code).toBe(code);
    }
  });

  it('the WHATWG parser canonicalises decimal/hex/octal IPv4 before the check', () => {
    expect(new URL('http://2130706433/').hostname).toBe('127.0.0.1');
    expect(new URL('http://0x7f000001/').hostname).toBe('127.0.0.1');
    expect(new URL('http://0177.0.0.1/').hostname).toBe('127.0.0.1');
  });

  it('accepts ordinary public URLs', () => {
    expect(assertUrlAllowed('https://www.johnnyseeds.com/x').hostname).toBe('www.johnnyseeds.com');
    expect(assertUrlAllowed(`http://${PUBLIC_V4}/`).hostname).toBe(PUBLIC_V4);
  });
});

describe('safeFetch', () => {
  it('literal private IPs never reach the connector', async () => {
    const connector = routes({});
    for (const url of [
      'http://127.0.0.1/',
      'http://169.254.169.254/',
      'http://[::1]/',
      'http://2130706433/'
    ]) {
      await expectCode(safeFetch(url, { resolver: publicResolver, connector }), 'blocked-address');
    }
    expect(connector.calls).toHaveLength(0);
  });

  it('rejects a hostname that resolves to a private address (DNS rebinding)', async () => {
    const connector = routes({});
    const resolver: Resolver = async () => [{ address: '10.0.0.5', family: 4 }];
    await expectCode(
      safeFetch('http://rebind.attacker.test/', { resolver, connector }),
      'blocked-address'
    );
    expect(connector.calls).toHaveLength(0);
  });

  it('rejects when ANY resolved address is private', async () => {
    const connector = routes({});
    const resolver: Resolver = async () => [
      { address: PUBLIC_V4, family: 4 },
      { address: '::ffff:169.254.169.254', family: 6 }
    ];
    await expectCode(
      safeFetch('http://mixed.attacker.test/', { resolver, connector }),
      'blocked-address'
    );
    expect(connector.calls).toHaveLength(0);
  });

  it('pins the connection to the validated address and keeps the hostname in the URL', async () => {
    const connector = routes({
      'https://shop.test/p': response(200, { 'content-type': 'text/html' }, body('<p>hi</p>'))
    });
    const res = await safeFetch('https://shop.test/p', { resolver: publicResolver, connector });
    expect(connector.calls[0].address).toBe(PUBLIC_V4);
    expect(connector.calls[0].family).toBe(4);
    expect(connector.calls[0].url.hostname).toBe('shop.test');
    expect(res.status).toBe(200);
    expect(res.contentType).toBe('text/html');
    expect((await res.readText()).text).toBe('<p>hi</p>');
  });

  it('resolves each hop only once, so a later DNS answer cannot swap the target', async () => {
    let n = 0;
    const resolver: Resolver = async () =>
      n++ === 0 ? [{ address: PUBLIC_V4, family: 4 }] : [{ address: '127.0.0.1', family: 4 }];
    const connector = routes({ 'http://flip.test/': response(200, {}, body('ok')) });
    const res = await safeFetch('http://flip.test/', { resolver, connector });
    expect(connector.calls[0].address).toBe(PUBLIC_V4);
    expect(n).toBe(1);
    await res.readText();
  });

  it('blocks a public URL that redirects to the metadata IP', async () => {
    const connector = routes({
      'http://shop.test/': response(302, { location: 'http://169.254.169.254/latest/meta-data/' })
    });
    await expectCode(
      safeFetch('http://shop.test/', { resolver: publicResolver, connector }),
      'blocked-address'
    );
    expect(connector.calls).toHaveLength(1);
  });

  it('re-resolves and re-validates redirect targets by hostname', async () => {
    const resolver: Resolver = async (host) =>
      host === 'internal.test'
        ? [{ address: '192.168.1.10', family: 4 }]
        : [{ address: PUBLIC_V4, family: 4 }];
    const connector = routes({
      'http://shop.test/': response(301, { location: '//internal.test/admin' })
    });
    await expectCode(safeFetch('http://shop.test/', { resolver, connector }), 'blocked-address');
    expect(connector.calls).toHaveLength(1);
  });

  it.each(['file:///etc/passwd', 'gopher://127.0.0.1:6379/_INFO', 'data:text/html,hi'])(
    'blocks a redirect to a non-http scheme (%s)',
    async (location) => {
      const connector = routes({ 'http://shop.test/': response(302, { location }) });
      await expectCode(
        safeFetch('http://shop.test/', { resolver: publicResolver, connector }),
        'bad-redirect'
      );
    }
  );

  it('follows up to 5 redirects and fails on the 6th', async () => {
    const map: Record<string, RawResponse> = {};
    for (let i = 0; i < 5; i++)
      map[`http://r.test/${i}`] = response(302, { location: `/${i + 1}` });
    map['http://r.test/5'] = response(200, { 'content-type': 'text/html' }, body('done'));
    const ok = await safeFetch('http://r.test/0', {
      resolver: publicResolver,
      connector: routes(map)
    });
    expect(ok.url).toBe('http://r.test/5');
    expect((await ok.readText()).text).toBe('done');

    map['http://r.test/5'] = response(302, { location: '/6' });
    map['http://r.test/6'] = response(200, {}, body('too far'));
    const connector = routes(map);
    await expectCode(
      safeFetch('http://r.test/0', { resolver: publicResolver, connector }),
      'too-many-redirects'
    );
    expect(connector.calls).toHaveLength(6);
  });

  it('a redirect loop terminates', async () => {
    const connector = routes({
      'http://loop.test/a': () => response(302, { location: '/b' }),
      'http://loop.test/b': () => response(302, { location: '/a' })
    });
    await expectCode(
      safeFetch('http://loop.test/a', { resolver: publicResolver, connector }),
      'too-many-redirects'
    );
  });

  it('caps the body at maxBytes and stops reading', async () => {
    let pulled = 0;
    const big = (async function* () {
      for (let i = 0; i < 1000; i++) {
        pulled++;
        yield new Uint8Array(1024).fill(97);
      }
    })();
    const raw = response(200, { 'content-type': 'text/html' }, big);
    const res = await safeFetch('http://big.test/', {
      resolver: publicResolver,
      connector: routes({ 'http://big.test/': raw }),
      maxBytes: 4096 + 10
    });
    const { text, truncated } = await res.readText();
    expect(truncated).toBe(true);
    expect(text.length).toBe(4096 + 10);
    expect(pulled).toBe(5);
    expect(raw.destroy).toHaveBeenCalled();
  });

  it('times out a stalled connect', async () => {
    const connector: Connector = () => new Promise(() => {});
    await expectCode(
      safeFetch('http://slow.test/', { resolver: publicResolver, connector, timeoutMs: 30 }),
      'timeout'
    );
  });

  it('times out a stalled DNS lookup', async () => {
    const resolver: Resolver = () => new Promise(() => {});
    await expectCode(
      safeFetch('http://slow.test/', { resolver, connector: routes({}), timeoutMs: 30 }),
      'timeout'
    );
  });

  it('times out a body that stops streaming', async () => {
    const stalled = (async function* () {
      yield new TextEncoder().encode('<html>');
      await new Promise(() => {});
    })();
    const res = await safeFetch('http://slow.test/', {
      resolver: publicResolver,
      connector: routes({ 'http://slow.test/': response(200, {}, stalled) }),
      timeoutMs: 50
    });
    await expectCode(res.readText(), 'timeout');
  });

  it('surfaces DNS failures as dns errors', async () => {
    const resolver: Resolver = async () => {
      throw new Error('ENOTFOUND');
    };
    await expectCode(safeFetch('http://nx.test/', { resolver, connector: routes({}) }), 'dns');
  });
});

describe('nodeConnector', () => {
  it('connects to the pinned address while sending the original Host header', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`host=${req.headers.host}`);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    try {
      const ctl = new AbortController();
      const res = await nodeConnector({
        url: new URL(`http://shop.example:${port}/p`),
        address: '127.0.0.1',
        family: 4,
        headers: {},
        signal: ctl.signal
      });
      let text = '';
      for await (const c of res.body) text += new TextDecoder().decode(c);
      expect(res.status).toBe(200);
      expect(text).toBe(`host=shop.example:${port}`);
    } finally {
      server.close();
    }
  });
});
