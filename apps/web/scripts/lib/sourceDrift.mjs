/**
 * Pure logic behind scripts/check-source-drift.mjs: collects every cited URL
 * from the *-sources.json files and plugin EPA numbers, and turns recorded
 * responses from PPLS, OMRI, eCFR and plain pages into drift findings. It never
 * fetches and never writes data; the CLI does the network and the issue.
 *
 * A finding id names the new state it saw ("ppls:100-497:label:2024-07-08"),
 * so an acknowledgement in source-fingerprints.json silences exactly that
 * state and a later change shows up again.
 */

import { createHash } from 'node:crypto';

export const ISSUE_TITLE = 'Label and source drift';
export const ISSUE_LABEL = 'needs-research';
export const OMRI_WARN_DAYS = 60;
export const PPLS_LABEL_BASE = 'https://www3.epa.gov/pesticides/chem_search/ppls/';
export const PPLS_API_BASE = 'https://ordspub.epa.gov/ords/pesticides/cswu/ppls/';
export const OMRI_API = 'https://www.omri.org/api/search';
export const ECFR_VERSIONS_BASE = 'https://www.ecfr.gov/api/versioner/v1/versions/';

const URL_KEY = /url$/i;

/**
 * @typedef {{ file: string, path: string, pluginId?: string | null, field?: string, url?: string | null, date?: string | null }} RefLine
 * @typedef {RefLine & { quote?: string | null, regNo?: string | null }} Ref
 * @typedef {{ id: string, kind: string, title: string, refs: RefLine[], links: string[], oldDate?: string | null, newDate?: string | null, detail?: string }} Finding
 * @typedef {{ kind: string, target: string, error: string }} Unreachable
 * @typedef {{ findings: Finding[], unreachable: Unreachable[], noBaseline?: string[] }} Result
 * @typedef {{ ok: false, error: string }} Failed
 * @typedef {{ status: number, lastModified: string | null, etag: string | null, hash: string | null, volatile?: boolean, checkedOn?: string, offPage?: string[] }} Fingerprint
 * @typedef {{ status: number, headers?: Record<string, string>, body: Buffer, contentType?: string }} FetchedPage
 * @typedef {{ generatedOn: string, findings: Finding[], unreachable: Unreachable[], noBaseline?: string[], quoteBaselineCount?: number }} Report
 * @typedef {{ product: string | null, code: string, status: string | null, expires: string }} OmriQuote
 * @typedef {{ ref: Ref, listing: OmriQuote }} OmriTarget
 * @typedef {{ title: string, status: string | null, expires: string | null }} OmriListing
 * @typedef {{ flat: string, positions: Map<string, number[]> }} PreparedDoc
 * @typedef {{ kind: 'ppls', regNo: string, labelDate: string | null } | { kind: 'omri', query: string | null } | { kind: 'ecfr', title: string, part: string, section: string | null } | { kind: 'page' } | { kind: 'other' }} UrlKind
 */

/**
 * YYYYMMDD or a looser date string to YYYY-MM-DD (a bare year-month gets day 01).
 * @param {unknown} value
 * @returns {string | null}
 */
export function isoDate(value) {
  if (typeof value !== 'string') return null;
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(value);
  if (m) return `${m[1]}-${m[2]}-${m[3] ?? '01'}`;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function normRegNo(value) {
  if (typeof value !== 'string') return null;
  const parts = value.trim().split('-');
  if (parts.length < 2 || parts.length > 3 || !parts.every((p) => /^\d+$/.test(p))) return null;
  return parts.map((p) => String(Number(p))).join('-');
}

/**
 * @param {string} url
 * @returns {UrlKind}
 */
export function classifyUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { kind: 'other' };
  }
  const host = u.hostname.toLowerCase();
  const ppls = /\/ppls\/(\d{6})-(\d{5})(?:-(\d{5}))?-(\d{8})\.pdf$/i.exec(u.pathname);
  if (host.endsWith('epa.gov') && ppls) {
    const regNo = [ppls[1], ppls[2], ppls[3]]
      .filter(Boolean)
      .map((p) => String(Number(p)))
      .join('-');
    return { kind: 'ppls', regNo, labelDate: isoDate(ppls[4]) };
  }
  if (host.endsWith('omri.org')) return { kind: 'omri', query: u.searchParams.get('query') };
  if (host.endsWith('ecfr.gov')) {
    const title = /\/title-(\d+)/.exec(u.pathname)?.[1];
    const section = /\/section-([\d.]+)/.exec(u.pathname)?.[1];
    const part = /\/part-(\d+)/.exec(u.pathname)?.[1] ?? section?.split('.')[0];
    if (title && part) return { kind: 'ecfr', title, part, section: section ?? null };
  }
  if (host.endsWith('law.cornell.edu')) {
    const m = /\/cfr\/text\/(\d+)\/(\d+)(?:\.([\d]+))?/.exec(u.pathname);
    if (m) {
      return {
        kind: 'ecfr',
        title: m[1],
        part: m[2],
        section: m[3] ? `${m[2]}.${m[3]}` : null
      };
    }
  }
  if (/(^|\.)[a-z0-9-]+\.(edu|gov)$/.test(host)) return { kind: 'page' };
  return { kind: 'other' };
}

/**
 * Every object holding a URL becomes one ref per URL key. pluginId is the
 * object's own pluginId, else the nearest path segment that names a plugin.
 */
/**
 * @param {{ name: string, json: any }[]} files
 * @param {Set<string>} [pluginIds]
 * @returns {Ref[]}
 */
export function collectRefs(files, pluginIds = new Set()) {
  /** @type {Ref[]} */
  const refs = [];
  for (const { name, json } of files) {
    const inherited = isoDate(json?.ecfrAsOf ?? json?.fetchedOn ?? null);
    /** @type {(node: any, path: string[]) => void} */
    const walk = (node, path) => {
      if (Array.isArray(node)) {
        node.forEach((v, i) => walk(v, [...path, String(i)]));
        return;
      }
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        if (URL_KEY.test(key) && typeof value === 'string' && /^https?:\/\//.test(value)) {
          const pluginId =
            (typeof node.pluginId === 'string' && node.pluginId) ||
            [...path].reverse().find((p) => pluginIds.has(p)) ||
            null;
          const field = path.filter((p) => p !== pluginId).join('.') || key;
          const kind = classifyUrl(value);
          refs.push({
            file: name,
            path: [...path, key].join('.'),
            pluginId,
            field,
            url: value.replace(/#.*$/, ''),
            date:
              kind.kind === 'ppls'
                ? kind.labelDate
                : (isoDate(node.docDate ?? node.date ?? null) ?? inherited),
            quote: typeof node.quote === 'string' ? node.quote : null,
            regNo: normRegNo(node.epaRegistrationNumber ?? null)
          });
        }
      }
      for (const [key, value] of Object.entries(node)) {
        if (value && typeof value === 'object') walk(value, [...path, key]);
      }
    };
    walk(json, []);
  }
  return refs;
}

/**
 * Plugin files' own epaRegistrationNumber, as refs with no URL.
 * @param {{ file: string, json: any }[]} plugins
 * @returns {Ref[]}
 */
export function pluginRegRefs(plugins) {
  /** @type {Ref[]} */
  const refs = [];
  for (const { file, json } of plugins) {
    const regNo = normRegNo(json?.epaRegistrationNumber ?? null);
    if (!regNo) continue;
    refs.push({
      file,
      path: 'epaRegistrationNumber',
      pluginId: json.id ?? json.pluginId ?? null,
      field: 'epaRegistrationNumber',
      url: null,
      date: null,
      quote: null,
      regNo
    });
  }
  return refs;
}

/**
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string | null | undefined} keyOf
 * @returns {Map<string, T[]>}
 */
export function groupBy(items, keyOf) {
  /** @type {Map<string, T[]>} */
  const map = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (key == null) continue;
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return map;
}

/**
 * A distributor number (company-product-distributor) is listed under its base registration.
 * @param {string} regNo
 */
export const pplsLookupNumber = (regNo) => regNo.split('-').slice(0, 2).join('-');

/**
 * PPLS refs keyed by registration number: label URLs plus plugin numbers.
 * @param {Ref[]} refs
 */
export function pplsTargets(refs) {
  return groupBy(refs, (r) => {
    if (r.url) {
      const c = classifyUrl(r.url);
      return c.kind === 'ppls' ? c.regNo : null;
    }
    return r.regNo;
  });
}

/** @type {(r: Ref) => RefLine} */
const refLine = (r) => ({
  file: r.file,
  path: r.path,
  pluginId: r.pluginId,
  field: r.field,
  url: r.url,
  date: r.date
});

/**
 * response: the items of the PPLS product API, or a failure.
 * @param {string} regNo
 * @param {Ref[]} refs
 * @param {{ ok: true, items: any[] } | Failed} response
 * @returns {Result}
 */
export function evaluatePpls(regNo, refs, response) {
  if (!response.ok) {
    return { findings: [], unreachable: [{ kind: 'ppls', target: regNo, error: response.error }] };
  }
  const apiUrl = PPLS_API_BASE + pplsLookupNumber(regNo);
  const item = response.items?.[0];
  if (!item) {
    return {
      findings: [
        {
          id: `ppls:${regNo}:not-found`,
          kind: 'ppls',
          title: `EPA Reg. No. ${regNo}: PPLS has no product with this number`,
          refs: refs.map(refLine),
          links: [apiUrl]
        }
      ],
      unreachable: []
    };
  }
  /** @type {Finding[]} */
  const findings = [];
  const base = pplsLookupNumber(regNo);
  const current = normRegNo(item.eparegno);
  const status = item.product_status ?? 'unknown';
  if (item.cancel_flag === 'Yes' || status !== 'Active') {
    findings.push({
      id: `ppls:${regNo}:status:${status}`,
      kind: 'ppls',
      title: `EPA Reg. No. ${regNo} (${item.productname}): PPLS status is ${status}${
        item.cancellationreason ? ` (${item.cancellationreason})` : ''
      }${item.product_status_date ? ` since ${isoDate(item.product_status_date)}` : ''}`,
      refs: refs.map(refLine),
      newDate: isoDate(item.product_status_date ?? null),
      links: [apiUrl]
    });
  }
  if (current && current !== base) {
    const t = (item.transfer_history ?? []).find(
      (/** @type {any} */ h) => normRegNo(h.previous_eparegno) === base
    );
    findings.push({
      id: `ppls:${regNo}:transfer:${current}`,
      kind: 'ppls',
      title: `EPA Reg. No. ${regNo}: transferred to ${current} (${item.productname})${
        t?.transferred_date ? ` on ${isoDate(t.transferred_date)}` : ''
      }`,
      refs: refs.map(refLine),
      newDate: isoDate(t?.transferred_date ?? null),
      links: [apiUrl, PPLS_API_BASE + current]
    });
  }
  /** @type {{ file: string, date: string }[]} */
  const labels = [];
  for (const p of item.pdffiles ?? []) {
    const date = isoDate(/-(\d{8})\.pdf$/i.exec(p.pdffile ?? '')?.[1] ?? '');
    if (date) labels.push({ file: p.pdffile, date });
  }
  labels.sort((a, b) => b.date.localeCompare(a.date));
  const newest = labels[0];
  const dated = refs.filter((r) => r.url && classifyUrl(r.url).kind === 'ppls');
  const stale = newest ? dated.filter((r) => (r.date ?? '0000') < newest.date) : [];
  if (newest && stale.length) {
    const quoted = stale.map((r) => r.date ?? '').sort();
    findings.push({
      id: `ppls:${regNo}:label:${newest.date}`,
      kind: 'ppls',
      title: `EPA Reg. No. ${regNo} (${item.productname}): newer stamped label ${newest.date}`,
      refs: stale.map(refLine),
      oldDate: quoted[0],
      newDate: newest.date,
      links: [PPLS_LABEL_BASE + newest.file, ...new Set(stale.map((r) => r.url ?? ''))]
    });
  }
  return { findings, unreachable: [] };
}

/**
 * "<product> | <company> | <code> | NOP | <status> | expires <date>", leniently.
 * @param {unknown} quote
 * @returns {OmriQuote | null}
 */
export function parseOmriQuote(quote) {
  if (typeof quote !== 'string') return null;
  const expires = /expires (\d{4}-\d{2}-\d{2})/i.exec(quote)?.[1];
  const parts = quote.split(' | ').map((p) => p.trim());
  const before = quote.slice(0, quote.search(/expires \d/i));
  const code = (
    parts.length >= 6 ? parts[2] : [...before.matchAll(/\b([a-z]{2,5}-\d{2,6})\b/gi)].at(-1)?.[1]
  )?.toLowerCase();
  if (!code || !expires || !/^[a-z]{2,5}-\d{2,6}$/.test(code)) return null;
  const status = parts.length >= 6 ? parts[4] : null;
  return { product: parts.length >= 6 ? parts[0] : null, code, status, expires };
}

/**
 * @param {Ref[]} refs
 * @returns {OmriTarget[]}
 */
export function omriTargets(refs) {
  /** @type {OmriTarget[]} */
  const out = [];
  for (const ref of refs) {
    if (!ref.url || classifyUrl(ref.url).kind !== 'omri') continue;
    const listing = parseOmriQuote(ref.quote);
    if (listing) out.push({ ref, listing });
  }
  return out;
}

/**
 * The NOP product with this code in an OMRI /api/search response, or null.
 * @param {any} searchJson
 * @param {string} code
 * @returns {OmriListing | null}
 */
export function findOmriListing(searchJson, code) {
  for (const v of searchJson?.value ?? []) {
    if (v.ContentType !== 'product' || v.RulingBody !== 'NOP' || typeof v.Blob !== 'string')
      continue;
    let blob;
    try {
      blob = JSON.parse(v.Blob);
    } catch {
      continue;
    }
    if (String(blob.FullCode ?? '').toLowerCase() === code) {
      return {
        title: v.EnglishContentTitle ?? v.ContentTitle,
        status: blob.Status ?? null,
        expires: isoDate(blob.Expiration ?? null)
      };
    }
  }
  return null;
}

/** @type {(from: string, to: string) => number} */
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/**
 * response: the listing from findOmriListing (null when the search had no such
 * product), or a failure.
 * @param {OmriTarget} target
 * @param {{ ok: true, listing: OmriListing | null } | Failed} response
 * @param {string} today
 * @returns {Result}
 */
export function evaluateOmri(target, response, today) {
  const { ref, listing: quoted } = target;
  const code = quoted.code;
  const base = { kind: 'omri', refs: [refLine(ref)], oldDate: quoted.expires };
  const searchLink = `https://www.omri.org/omri-search?query=${encodeURIComponent(code)}`;
  /** @type {Finding[]} */
  const findings = [];
  /** @type {Unreachable[]} */
  const unreachable = [];
  let expires = quoted.expires;
  if (!response.ok) {
    unreachable.push({ kind: 'omri', target: code, error: response.error });
  } else if (!response.listing) {
    findings.push({
      ...base,
      id: `omri:${code}:missing`,
      title: `OMRI ${code}: no NOP listing with this code in OMRI search`,
      links: [searchLink, ref.url ?? searchLink]
    });
  } else {
    const live = response.listing;
    if (quoted.status && live.status && live.status !== quoted.status) {
      findings.push({
        ...base,
        id: `omri:${code}:status:${live.status}`,
        title: `OMRI ${code}: status is now "${live.status}" (quoted "${quoted.status}")`,
        links: [searchLink]
      });
    }
    if (live.expires && live.expires !== quoted.expires) {
      findings.push({
        ...base,
        id: `omri:${code}:expiry:${live.expires}`,
        title: `OMRI ${code}: listing now expires ${live.expires} (quoted ${quoted.expires})`,
        newDate: live.expires,
        links: [searchLink]
      });
      expires = live.expires;
    }
  }
  const left = daysBetween(today, expires);
  if (left < 0) {
    findings.push({
      ...base,
      id: `omri:${code}:expired:${expires}`,
      title: `OMRI ${code}: listing expired ${expires}`,
      newDate: expires,
      links: [searchLink]
    });
  } else if (left <= OMRI_WARN_DAYS) {
    findings.push({
      ...base,
      id: `omri:${code}:expiring:${expires}`,
      title: `OMRI ${code}: listing expires ${expires} (${left} days)`,
      newDate: expires,
      links: [searchLink]
    });
  }
  return { findings, unreachable };
}

/**
 * eCFR refs keyed "title:part:section" (section empty for a whole part).
 * @param {Ref[]} refs
 */
export function ecfrTargets(refs) {
  return groupBy(refs, (r) => {
    if (!r.url) return null;
    const c = classifyUrl(r.url);
    return c.kind === 'ecfr' ? `${c.title}:${c.part}:${c.section ?? ''}` : null;
  });
}

/**
 * response.json: the eCFR versioner response for title-T.json?part=P.
 * @param {string} key
 * @param {Ref[]} refs
 * @param {{ ok: true, json: any } | Failed} response
 * @returns {Result}
 */
export function evaluateEcfr(key, refs, response) {
  const [title, part, section] = key.split(':');
  const cite = `${title} CFR ${section || `part ${part}`}`;
  if (!response.ok) {
    return { findings: [], unreachable: [{ kind: 'ecfr', target: cite, error: response.error }] };
  }
  /** @type {{ identifier: string, part: string, date: string, removed?: boolean, substantive?: boolean }[]} */
  const versions = (response.json?.content_versions ?? []).filter((/** @type {any} */ v) =>
    section ? v.identifier === section : v.part === part
  );
  const link = `https://www.ecfr.gov/current/title-${title}/${
    section ? `section-${section}` : `part-${part}`
  }`;
  if (!versions.length) {
    return {
      findings: [
        {
          id: `ecfr:${title}:${section || part}:not-found`,
          kind: 'ecfr',
          title: `${cite}: not in the eCFR versions list`,
          refs: refs.map(refLine),
          links: [link]
        }
      ],
      unreachable: []
    };
  }
  const latest = versions.reduce((a, b) => (b.date > a.date ? b : a));
  const stale = refs.filter((r) => (r.date ?? '0000') < latest.date);
  /** @type {Finding[]} */
  const findings = [];
  if (stale.length) {
    const quoted = stale.map((r) => r.date ?? '').sort();
    findings.push({
      id: `ecfr:${title}:${section || part}:${latest.date}`,
      kind: 'ecfr',
      title: `${cite}: amended ${latest.date}${latest.removed ? ' (removed)' : ''}${
        latest.substantive === false ? ' (marked non-substantive)' : ''
      }, after the quote's date`,
      refs: stale.map(refLine),
      oldDate: quoted[0],
      newDate: latest.date,
      links: [
        link,
        `https://www.ecfr.gov/compare/${latest.date}/to/${quoted[0] ?? latest.date}/title-${title}/${
          section ? `section-${section}` : `part-${part}`
        }`
      ]
    });
  }
  return { findings, unreachable: [] };
}

/** @param {Ref[]} refs */
export function pageTargets(refs) {
  return groupBy(refs, (r) => (r.url && classifyUrl(r.url).kind === 'page' ? r.url : null));
}

/** @type {Record<string, string>} */
const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  deg: '°',
  frac12: '½',
  frac14: '¼',
  frac34: '¾'
};

const BLOCK_TAG =
  /<\/?(?:p|div|li|ul|ol|h[1-6]|tr|td|th|table|section|blockquote|dd|dt|dl|br|hr|figure|figcaption)\b[^>]*>/gi;

/**
 * The main content of an HTML page as text blocks, in page order: main or
 * article when present, else body, without scripts, navigation and footers.
 * @param {string} html
 * @returns {string[]}
 */
export function extractHtmlBlocks(html) {
  let s = String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, ' ');
  /** @type {(tag: string) => string | undefined} */
  const pick = (tag) => new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*)</${tag}>`, 'i').exec(s)?.[1];
  s = pick('main') ?? pick('article') ?? pick('body') ?? s;
  return s
    .replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(BLOCK_TAG, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * Visible text of an HTML page's main content.
 * @param {string} html
 */
export function extractHtmlText(html) {
  return extractHtmlBlocks(html).join(' ');
}

/** @type {(data: string | Buffer) => string} */
export const sha256 = (data) => 'sha256:' + createHash('sha256').update(data).digest('hex');

/**
 * Fingerprint of a fetched page: { status, lastModified, etag, hash }. PDFs
 * and other binaries hash their bytes. HTML hashes its main-content text
 * blocks sorted, so a changed header, or sidebar widgets that swap places
 * between requests, leave it alone.
 * @param {FetchedPage} page
 * @returns {Fingerprint}
 */
export function fingerprint({ status, headers, body, contentType }) {
  const type = (contentType ?? headers?.['content-type'] ?? '').toLowerCase();
  const isHtml = type.includes('html') || (!type && /<html/i.test(String(body).slice(0, 2000)));
  return {
    status,
    lastModified: headers?.['last-modified'] ?? null,
    etag: headers?.etag ?? null,
    hash:
      status >= 200 && status < 300
        ? sha256(isHtml ? extractHtmlBlocks(body.toString('utf8')).sort().join('\n') : body)
        : null
  };
}

const CHALLENGE =
  /incapsula incident|request unsuccessful|just a moment\.\.\.|checking your browser|cf-browser-verification|attention required|access denied|enable javascript and cookies/i;

/**
 * Why a response is a bot wall or refusal rather than the page, or null.
 * @param {FetchedPage} page
 * @returns {string | null}
 */
export function pageBlocked({ status, headers, body }) {
  if (status === 401 || status === 403 || status === 406) return `HTTP ${status} (blocked)`;
  const type = (headers?.['content-type'] ?? '').toLowerCase();
  if (!type.includes('html')) return null;
  const text = extractHtmlText(body.toString('utf8'));
  return text.length < 2000 && CHALLENGE.test(text) ? 'bot protection page' : null;
}

/**
 * Of up to three fingerprints of one URL, the hash that repeats; none repeating is volatile.
 * @param {Fingerprint[]} fps
 * @returns {Fingerprint}
 */
export function settleFingerprints(fps) {
  if (fps.length === 1) return fps[0];
  for (let i = 0; i < fps.length; i++) {
    for (let j = i + 1; j < fps.length; j++) {
      if (fps[i].status === fps[j].status && fps[i].hash === fps[j].hash) return fps[j];
    }
  }
  return { ...fps[fps.length - 1], volatile: true };
}

/**
 * Paths of the refs whose quote is not on the page itself (a landing page for
 * a PDF, say). Stored with the baseline so they never count as drift.
 * @param {Ref[]} refs
 * @param {string | string[]} text
 * @returns {string[]}
 */
export function quotesOffPage(refs, text) {
  const docs = (Array.isArray(text) ? text : [text]).map(prepareDoc);
  return refs.filter((r) => r.quote && !quoteFound(docs, r.quote).ok).map((r) => r.path);
}

/**
 * A changed text hash is reported only when a stored quote that was on the
 * page at baseline (not in `offPage`) is no longer in it, or when the page has
 * no such quotes and its text changed; a page whose quotes all still read the
 * same is left alone. A page whose quotes are all elsewhere counts only status.
 * @param {string} url
 * @param {Ref[]} refs
 * @param {Fingerprint | undefined} stored
 * @param {{ ok: true, fingerprint: Fingerprint, text?: string | string[] | null } | Failed} response
 * @returns {Result & { noBaseline: string[] }}
 */
export function evaluatePage(url, refs, stored, response) {
  if (!response.ok) {
    return {
      findings: [],
      unreachable: [{ kind: 'page', target: url, error: response.error }],
      noBaseline: []
    };
  }
  const now = response.fingerprint;
  if (!stored) return { findings: [], unreachable: [], noBaseline: [url] };
  /** @type {string[]} */
  const changes = [];
  if (stored.status !== now.status) changes.push(`HTTP ${stored.status} → ${now.status}`);
  else if (
    !stored.volatile &&
    !now.volatile &&
    stored.hash &&
    now.hash &&
    stored.hash !== now.hash
  ) {
    changes.push('text changed');
    if (now.lastModified && now.lastModified !== stored.lastModified)
      changes.push(`Last-Modified ${now.lastModified}`);
  }
  if (!changes.length) return { findings: [], unreachable: [], noBaseline: [] };
  /** @type {string | undefined} */
  let detail;
  const off = new Set(stored.offPage ?? []);
  const anyQuotes = refs.some((r) => r.quote);
  const quoted = refs.filter((r) => r.quote && !off.has(r.path));
  if (stored.status === now.status && anyQuotes && !quoted.length) {
    return { findings: [], unreachable: [], noBaseline: [] };
  }
  if (stored.status === now.status && quoted.length && response.text) {
    const texts = Array.isArray(response.text) ? response.text : [response.text];
    const docs = texts.map(prepareDoc);
    const missing = quoted.filter((r) => !quoteFound(docs, r.quote ?? '').ok);
    if (!missing.length) return { findings: [], unreachable: [], noBaseline: [] };
    detail = `${missing.length} of ${quoted.length} stored quote(s) no longer found, first at \`${missing[0].path}\``;
  }
  const dates = refs
    .map((r) => r.date ?? '')
    .filter(Boolean)
    .sort();
  return {
    findings: [
      {
        id: `page:${url}:${now.status}:${(now.hash ?? 'none').slice(7, 19)}`,
        kind: 'page',
        title: `${url}: ${changes.join(', ')} since ${stored.checkedOn ?? 'the stored fingerprint'}`,
        refs: refs.map(refLine),
        oldDate: dates[0] ?? null,
        newDate: isoDate(now.lastModified ?? null),
        ...(detail ? { detail } : {}),
        links: [url]
      }
    ],
    unreachable: [],
    noBaseline: []
  };
}

/**
 * Compares letters and digits only, so line breaks, quotes and dashes drop out.
 * @param {string} text
 */
export function normalizeForMatch(text) {
  return String(text)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\u00ad/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** @type {(text: string) => string[]} */
const wordsOf = (text) =>
  String(text)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\u00ad/g, '')
    .match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * The pieces of a quote to look for. A quote written as a label and the words
 * in quotation marks ('Alfalfa, Fertilizer: "At seeding: ..."') is checked on
 * the quoted words; ellipses and " / " join separate pieces.
 * @param {string} quote
 * @returns {string[]}
 */
export function quotePieces(quote) {
  const q = String(quote);
  const inner = [...q.matchAll(/["“]([^"“”]{20,})["”]/g)].map((m) => m[1]);
  return (inner.length ? inner.join(' ... ') : q)
    .replace(/\((?:p|pp|page|pdf page)\.?\s*[\d–-]+\)/gi, ' ... ')
    .replace(/\[[^\]]*\]/g, ' ... ')
    .split(/\s*(?:\.\.\.|…|\s[/|]\s)\s*/)
    .map((p) => p.trim())
    .filter((p) => normalizeForMatch(p).length >= 4 && !/^\(.*\)$/.test(p));
}

/**
 * One extracted text, indexed for exact and table-tolerant matching.
 * @param {string} text
 * @returns {PreparedDoc}
 */
export function prepareDoc(text) {
  const words = wordsOf(text);
  /** @type {Map<string, number[]>} */
  const positions = new Map();
  words.forEach((w, i) => {
    const list = positions.get(w) ?? [];
    list.push(i);
    positions.set(w, list);
  });
  return { flat: normalizeForMatch(text), positions };
}

/** Words a table cell may be separated by when its column is read across the page. */
export const TABLE_GAP_WORDS = 80;

/**
 * @param {number[]} list
 * @param {number} pos
 * @returns {number | undefined}
 */
function firstAfter(list, pos) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] > pos) hi = mid;
    else lo = mid + 1;
  }
  return list[lo];
}

/**
 * A piece is found when it appears letter for letter, or, for a table cell or
 * column that the PDF text layer interleaves with other columns, when all its
 * words (numbers included) appear in order with at most TABLE_GAP_WORDS
 * between neighbours.
 * @param {string} piece
 * @param {PreparedDoc} doc
 */
function pieceFound(piece, doc) {
  if (doc.flat.includes(normalizeForMatch(piece))) return true;
  const words = wordsOf(piece);
  if (words.length < 2) return false;
  /** @type {number[][]} */
  const lists = [];
  for (const w of words) {
    const l = doc.positions.get(w);
    if (!l) return false;
    lists.push(l);
  }
  for (const start of lists[0]) {
    let pos = start;
    let ok = true;
    for (let i = 1; i < lists.length; i++) {
      const next = firstAfter(lists[i], pos);
      if (next === undefined || next - pos > TABLE_GAP_WORDS) {
        ok = false;
        break;
      }
      pos = next;
    }
    if (ok) return true;
  }
  return false;
}

/**
 * texts: one or more extractions of the same document (reading order, layout).
 * @param {string | (string | PreparedDoc)[]} texts
 * @param {string} quote
 */
export function quoteFound(texts, quote) {
  const docs = (Array.isArray(texts) ? texts : [texts]).map((t) =>
    typeof t === 'string' ? prepareDoc(t) : t
  );
  const missing = quotePieces(quote).filter((p) => !docs.some((d) => pieceFound(p, d)));
  return { ok: missing.length === 0, missing };
}

/**
 * quote refs on PDFs, keyed by URL, for --verify-quotes.
 * @param {Ref[]} refs
 */
export function quoteTargets(refs) {
  return groupBy(
    refs.filter((r) => r.quote && r.url && /\.pdf($|\?)/i.test(r.url)),
    (r) => r.url
  );
}

/**
 * @param {string} url
 * @param {Ref[]} refs
 * @param {{ ok: true, text: string | string[] } | Failed} response
 * @returns {Result}
 */
export function evaluateQuotes(url, refs, response) {
  if (!response.ok) {
    return { findings: [], unreachable: [{ kind: 'quote', target: url, error: response.error }] };
  }
  /** @type {Finding[]} */
  const findings = [];
  const docs = (Array.isArray(response.text) ? response.text : [response.text]).map(prepareDoc);
  for (const r of refs) {
    if (!r.quote) continue;
    const { ok, missing } = quoteFound(docs, r.quote);
    if (ok) continue;
    const digest = sha256(r.quote).slice(7, 19);
    findings.push({
      id: `quote:${r.file}:${r.path}:${digest}`,
      kind: 'quote',
      title: `${r.pluginId ?? r.file} ${r.field}: quote not found word for word in the PDF`,
      refs: [refLine(r)],
      oldDate: r.date,
      detail: `Missing: “${missing[0].slice(0, 160)}${missing[0].length > 160 ? '…' : ''}”${
        missing.length > 1 ? ` and ${missing.length - 1} more piece(s)` : ''
      }`,
      links: [url]
    });
  }
  return { findings, unreachable: [] };
}

/**
 * @param {Finding[]} findings
 * @param {Record<string, unknown>} [acknowledged]
 */
export function dropAcknowledged(findings, acknowledged = {}) {
  return findings.filter((f) => !Object.hasOwn(acknowledged, f.id));
}

/** @type {Record<string, string>} */
const KIND_HEADINGS = {
  ppls: 'EPA labels (PPLS)',
  omri: 'OMRI listings',
  ecfr: 'eCFR sections',
  page: 'Extension and government pages',
  quote: 'Quotes not found in their PDF'
};

/** @type {Record<string, string>} */
const SECTION_FOR = {
  ppls: 'weekly',
  omri: 'weekly',
  ecfr: 'weekly',
  page: 'weekly',
  quote: 'quotes'
};

/** @type {(repo: string | undefined, file: string) => string} */
const fileLink = (repo, file) =>
  repo
    ? `[${file}](https://github.com/${repo}/blob/main/${file.startsWith('plugins/') ? '' : 'apps/web/scripts/'}${file})`
    : file;

/**
 * @param {Finding} f
 * @param {boolean} checked
 * @param {string | undefined} repo
 * @param {number} maxRefs
 */
function renderFinding(f, checked, repo, maxRefs) {
  const lines = [`- [${checked ? 'x' : ' '}] **${f.title}** <!-- drift:${f.id} -->`];
  const shown = f.refs.slice(0, maxRefs);
  for (const r of shown) {
    lines.push(
      `  - ${r.pluginId ? `\`${r.pluginId}\` ` : ''}${fileLink(repo, r.file)} \`${r.path}\`${
        r.date ? ` (quoted ${r.date})` : ''
      }`
    );
  }
  if (f.refs.length > shown.length)
    lines.push(`  - and ${f.refs.length - shown.length} more reference(s)`);
  if (f.oldDate || f.newDate)
    lines.push(`  - Old date ${f.oldDate ?? 'unknown'} → new date ${f.newDate ?? 'unknown'}`);
  if (f.detail) lines.push(`  - ${f.detail}`);
  if (f.links?.length) lines.push(`  - ${[...new Set(f.links)].map((l) => `<${l}>`).join(' · ')}`);
  return lines.join('\n');
}

/**
 * Ids already ticked in an earlier body, so a re-run keeps the reviewer's ticks.
 * @param {string | null | undefined} body
 */
export function checkedIds(body) {
  /** @type {Set<string>} */
  const ids = new Set();
  for (const m of String(body ?? '').matchAll(/^- \[x\] .*<!-- drift:(.+?) -->$/gim)) ids.add(m[1]);
  return ids;
}

/** GitHub refuses issue bodies over 65,536 characters; two sections share one body. */
export const SECTION_BUDGET = 30_000;

/**
 * @param {'weekly' | 'quotes'} section
 * @param {Report} report
 * @param {string | null | undefined} previousBody
 * @param {string} [repo]
 * @param {number} [budget]
 */
export function renderSection(section, report, previousBody, repo, budget = SECTION_BUDGET) {
  for (const maxRefs of [12, 3, 1, 0]) {
    const text = renderSectionWith(section, report, previousBody, repo, maxRefs, Infinity);
    if (text.length <= budget) return text;
  }
  let lo = 0;
  let hi = report.findings.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (renderSectionWith(section, report, previousBody, repo, 0, mid).length <= budget) lo = mid;
    else hi = mid - 1;
  }
  return renderSectionWith(section, report, previousBody, repo, 0, lo);
}

/**
 * @param {'weekly' | 'quotes'} section
 * @param {Report} report
 * @param {string | null | undefined} previousBody
 * @param {string | undefined} repo
 * @param {number} maxRefs
 * @param {number} maxItems
 */
function renderSectionWith(section, report, previousBody, repo, maxRefs, maxItems) {
  const ticked = checkedIds(previousBody);
  const findings = report.findings.filter((f) => SECTION_FOR[f.kind] === section);
  const out = [`<!-- section:${section} -->`];
  const heading = section === 'quotes' ? 'Monthly quote check' : 'Weekly drift check';
  out.push(`## ${heading} (${report.generatedOn})`, '');
  if (!findings.length) out.push('Nothing changed.', '');
  let left = maxItems;
  for (const kind of Object.keys(KIND_HEADINGS)) {
    const list = findings.filter((f) => f.kind === kind);
    if (!list.length) continue;
    out.push(`### ${KIND_HEADINGS[kind]} (${list.length})`, '');
    for (const f of list.slice(0, Math.max(0, left)))
      out.push(renderFinding(f, ticked.has(f.id), repo, maxRefs));
    left -= list.length;
    out.push('');
  }
  if (left < 0) {
    out.push(
      `${-left} more finding(s) did not fit in the issue. They are in the workflow run's report artifact and come back here as items are cleared.`,
      ''
    );
  }
  const unreachable = report.unreachable.filter(
    (u) => (section === 'quotes') === (u.kind === 'quote')
  );
  if (unreachable.length) {
    out.push(
      '<details><summary>Could not check ' +
        unreachable.length +
        ' source(s): not the same as "no change"</summary>',
      '',
      ...unreachable.slice(0, 200).map((u) => `- ${u.kind} \`${u.target}\`: ${u.error}`),
      '',
      '</details>',
      ''
    );
  }
  if (section === 'quotes' && report.quoteBaselineCount) {
    out.push(
      `${report.quoteBaselineCount} stored quote(s) did not match their PDF word for word when the baseline was taken (\`quoteBaseline\` in \`apps/web/scripts/source-fingerprints.json\`); only quotes that stop matching after that are listed here.`,
      ''
    );
  }
  if (section === 'weekly' && report.noBaseline?.length) {
    out.push(
      `<details><summary>${report.noBaseline.length} page(s) have no stored fingerprint yet</summary>`,
      '',
      'Run `node apps/web/scripts/check-source-drift.mjs --only pages --update-fingerprints` and commit `source-fingerprints.json`.',
      '',
      ...report.noBaseline.slice(0, 200).map((u) => `- <${u}>`),
      '',
      '</details>',
      ''
    );
  }
  out.push(`<!-- /section:${section} -->`);
  return out.join('\n');
}

const INTRO = `Opened by \`.github/workflows/source-drift.yml\` (\`apps/web/scripts/check-source-drift.mjs\`). The check never changes data. Work the list with \`docs/research/source-refresh-prompt.md\`: re-read the new source, update the value and quote in a reviewed PR, or acknowledge a finding that needs no change in \`apps/web/scripts/source-fingerprints.json\`. Safety-kernel effects go in their own PR with a \`RULES_VERSION\` bump.`;

/**
 * Replaces one generated section of the rolling issue body and keeps the other.
 * @param {string | null | undefined} previousBody
 * @param {'weekly' | 'quotes'} section
 * @param {string} sectionText
 */
export function mergeIssueBody(previousBody, section, sectionText) {
  const re = new RegExp(`<!-- section:${section} -->[\\s\\S]*?<!-- /section:${section} -->`);
  if (previousBody && re.test(previousBody)) return previousBody.replace(re, () => sectionText);
  const base = previousBody && previousBody.includes('<!-- section:') ? previousBody : INTRO;
  if (section === 'weekly' && base.includes('<!-- section:quotes -->')) {
    return base.replace(
      '<!-- section:quotes -->',
      () => `${sectionText}\n\n<!-- section:quotes -->`
    );
  }
  return `${base}\n\n${sectionText}`;
}

/**
 * True when the body still lists an unticked finding.
 * @param {string | null | undefined} body
 */
export function hasOpenItems(body) {
  return /^- \[ \] .*<!-- drift:/m.test(String(body ?? ''));
}
