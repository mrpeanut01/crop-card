/**
 * Phase 33D (D-17): offline `/c/<key>` links. Online, the server redirects a
 * printed card's short link; with no signal the service worker sends it to
 * the /cards page that renders it from this device instead.
 *
 * Import-free on purpose: vite.config.ts compiles this file verbatim into a
 * classic script (`sw-card-links.js`) that the generated Workbox SW loads via
 * `importScripts` ahead of its own routes. The prefix and record-kind tables
 * repeat `CARD_KEY_PREFIX` and `CARD_RECORD_KINDS`; a drift test pins them.
 */

/** Card key prefix → card kind, for kinds that render under /cards offline. */
export const SW_CARD_KIND_BY_PREFIX: Readonly<Record<string, string>> = {
  pl: 'planting',
  ar: 'area',
  fm: 'farmMap',
  sp: 'spray',
  eq: 'equipment',
  cg: 'careGuide',
  dy: 'day',
  st: 'stock',
  tk: 'task',
  sc: 'scout',
  hv: 'harvest',
  so: 'soilTest',
  an: 'animal',
  fl: 'flock',
  ir: 'irrigation',
  wk: 'week',
  mo: 'month'
};

/** Prefixes the server redirects elsewhere (profit, digest): left alone. */
export const SW_SKIPPED_PREFIXES: readonly string[] = ['pf', 'dg'];

export const SW_RECORD_KINDS: readonly string[] = [
  'spray',
  'insecticide',
  'fungicide',
  'scout',
  'harvest',
  'hay',
  'fertility',
  'planting',
  'decon',
  'irrigation'
];

const SHORT_LINK = /^\/c\/([^/]+)\/?$/;
const RECORD_KEY = /^rc_([a-z]+)\.([\s\S]+)$/;

export function offlineCardLinkTarget(pathname: string): string | null {
  const m = SHORT_LINK.exec(pathname);
  if (!m) return null;
  let key: string;
  try {
    key = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  const record = RECORD_KEY.exec(key);
  if (record) {
    return SW_RECORD_KINDS.includes(record[1]) ? `/cards/record/${encodeURIComponent(key)}` : null;
  }
  const i = key.indexOf('_');
  if (i <= 0 || i === key.length - 1) return null;
  const kind = SW_CARD_KIND_BY_PREFIX[key.slice(0, i)];
  return kind ? `/cards/${kind}/${encodeURIComponent(key)}` : null;
}

interface FetchEventLike {
  request: { url: string; mode: string };
  respondWith(r: Promise<Response>): void;
  stopImmediatePropagation(): void;
}

interface SwCardLinksScopeLike {
  location: { origin: string };
  fetch(request: unknown): Promise<Response>;
  addEventListener(type: 'fetch', listener: (event: FetchEventLike) => void): void;
}

export function installSwCardLinks(scope: SwCardLinksScopeLike): void {
  scope.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.mode !== 'navigate') return;
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return;
    }
    if (url.origin !== scope.location.origin) return;
    const target = offlineCardLinkTarget(url.pathname);
    if (!target) return;
    const absolute = new URL(target, scope.location.origin).href;
    event.respondWith(scope.fetch(request).catch(() => Response.redirect(absolute, 302)));
    event.stopImmediatePropagation();
  });
}
