import { describe, expect, it, vi } from 'vitest';
import {
  SW_CARD_KIND_BY_PREFIX,
  SW_RECORD_KINDS,
  SW_SKIPPED_PREFIXES,
  installSwCardLinks,
  offlineCardLinkTarget
} from './swCardLinks';
import { CARD_KEY_PREFIX, CARD_KINDS } from '$lib/cards/model';
import { CARD_RECORD_KINDS } from '$lib/db/recordKinds';

describe('offlineCardLinkTarget', () => {
  it('sends a record key to its saved copy', () => {
    expect(offlineCardLinkTarget('/c/rc_spray.abc-123')).toBe('/cards/record/rc_spray.abc-123');
    expect(offlineCardLinkTarget('/c/rc_irrigation.x')).toBe('/cards/record/rc_irrigation.x');
    expect(offlineCardLinkTarget('/c/rc_bogus.x')).toBeNull();
  });

  it('sends a snapshot card key to its card page', () => {
    expect(offlineCardLinkTarget('/c/pl_p1')).toBe('/cards/planting/pl_p1');
    expect(offlineCardLinkTarget('/c/tk_9/')).toBe('/cards/task/tk_9');
    expect(offlineCardLinkTarget('/c/so_1')).toBe('/cards/soilTest/so_1');
  });

  it('leaves profit, digest, unknown and malformed paths to the network', () => {
    for (const p of [
      '/c/pf_2026',
      '/c/dg_1',
      '/c/zz_1',
      '/c/pl_',
      '/c/_x',
      '/c/',
      '/cards/pl_1',
      '/c/pl_1/extra',
      '/c/%E0%A4%A'
    ]) {
      expect(offlineCardLinkTarget(p)).toBeNull();
    }
  });

  it('encodes the key into the target', () => {
    expect(offlineCardLinkTarget('/c/rc_spray.a%2Fb')).toBe('/cards/record/rc_spray.a%2Fb');
  });
});

describe('drift against the card model', () => {
  it('knows every card key prefix', () => {
    for (const kind of CARD_KINDS) {
      const prefix = CARD_KEY_PREFIX[kind];
      if (kind === 'profit' || kind === 'digest') {
        expect(SW_SKIPPED_PREFIXES).toContain(prefix);
        expect(SW_CARD_KIND_BY_PREFIX[prefix]).toBeUndefined();
      } else {
        expect(SW_CARD_KIND_BY_PREFIX[prefix]).toBe(kind);
      }
    }
    expect(Object.keys(SW_CARD_KIND_BY_PREFIX).length + SW_SKIPPED_PREFIXES.length).toBe(
      CARD_KINDS.length
    );
  });

  it('knows every record kind', () => {
    expect([...SW_RECORD_KINDS].sort()).toEqual([...CARD_RECORD_KINDS].sort());
  });
});

describe('installSwCardLinks', () => {
  type Listener = (event: {
    request: { url: string; mode: string };
    respondWith: (r: Promise<Response>) => void;
    stopImmediatePropagation: () => void;
  }) => void;

  function setup(fetchImpl: () => Promise<Response>) {
    let listener: Listener | undefined;
    const scope = {
      location: { origin: 'https://app.cropcard.io' },
      fetch: vi.fn(fetchImpl),
      addEventListener: (_type: 'fetch', l: Listener) => {
        listener = l;
      }
    };
    installSwCardLinks(scope);
    const dispatch = (url: string, mode = 'navigate') => {
      const respondWith = vi.fn();
      const stop = vi.fn();
      listener!({ request: { url, mode }, respondWith, stopImmediatePropagation: stop });
      return { respondWith, stop };
    };
    return { scope, dispatch };
  }

  it('passes online responses through untouched', async () => {
    const online = new Response('ok', { status: 200 });
    const { dispatch } = setup(async () => online);
    const { respondWith, stop } = dispatch('https://app.cropcard.io/c/rc_spray.1');
    expect(stop).toHaveBeenCalled();
    expect(await respondWith.mock.calls[0][0]).toBe(online);
  });

  it('redirects to the saved copy when the network fails', async () => {
    const { dispatch } = setup(async () => {
      throw new TypeError('offline');
    });
    const { respondWith } = dispatch('https://app.cropcard.io/c/rc_spray.1');
    const res: Response = await respondWith.mock.calls[0][0];
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://app.cropcard.io/cards/record/rc_spray.1');
  });

  it('ignores other origins, non-navigations, profit links and other paths', () => {
    const { dispatch, scope } = setup(async () => new Response('x'));
    for (const [url, mode] of [
      ['https://evil.example/c/rc_spray.1', 'navigate'],
      ['https://app.cropcard.io/c/rc_spray.1', 'cors'],
      ['https://app.cropcard.io/c/pf_2026', 'navigate'],
      ['https://app.cropcard.io/records', 'navigate']
    ] as const) {
      const { respondWith, stop } = dispatch(url, mode);
      expect(respondWith).not.toHaveBeenCalled();
      expect(stop).not.toHaveBeenCalled();
    }
    expect(scope.fetch).not.toHaveBeenCalled();
  });
});
