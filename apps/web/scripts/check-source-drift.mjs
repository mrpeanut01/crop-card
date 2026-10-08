#!/usr/bin/env node
/**
 * Flags label and source drift for human review. Never changes plugin or
 * source data. Reads every apps/web/scripts/*-sources.json file and the
 * plugins' EPA numbers, then checks:
 *
 *   ppls   each EPA registration number in PPLS: a newer stamped label than
 *          the one quoted, a cancelled or inactive registration, a transfer
 *   omri   each quoted OMRI listing: expired or expiring within 60 days, a
 *          changed status or expiry, gone from the OMRI search API
 *   ecfr   each cited CFR section (7 CFR 205, 21 CFR 530, 9 CFR): amended
 *          after the quote's date, from the eCFR versions API
 *   pages  every other .edu and .gov URL against its stored fingerprint in
 *          source-fingerprints.json (status, Last-Modified, ETag, text hash)
 *
 * A source that does not answer after retries is reported as "could not
 * check", never as "no change".
 *
 * Usage (from the repo root):
 *   node apps/web/scripts/check-source-drift.mjs [--only ppls,omri,ecfr,pages]
 *   node apps/web/scripts/check-source-drift.mjs --verify-quotes
 *       re-downloads every quoted PDF, extracts its text with pdftotext and
 *       checks each quote is still in it word for word (monthly)
 *   node apps/web/scripts/check-source-drift.mjs --only pages --update-fingerprints [--url <url>]
 *       stores the current fingerprints (after a reviewer confirmed the quotes)
 *   node apps/web/scripts/check-source-drift.mjs --verify-quotes --update-fingerprints
 *       stores the quotes that do not match word for word today as quoteBaseline,
 *       so the monthly run flags only quotes that stop matching after that
 *   --cache <dir>    keep downloaded PDFs between local --verify-quotes runs
 *   --json <file>    write the full report
 *   --publish        open, update or close the rolling GitHub issue with gh
 *   --repo owner/name  (default $GITHUB_REPOSITORY, else mrpeanut01/crop-card)
 *   --today YYYY-MM-DD
 */

import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ECFR_VERSIONS_BASE,
  ISSUE_LABEL,
  ISSUE_TITLE,
  OMRI_API,
  PPLS_API_BASE,
  classifyUrl,
  collectRefs,
  dropAcknowledged,
  ecfrTargets,
  evaluateEcfr,
  evaluateOmri,
  evaluatePage,
  evaluatePpls,
  evaluateQuotes,
  extractHtmlText,
  findOmriListing,
  fingerprint,
  hasOpenItems,
  mergeIssueBody,
  omriTargets,
  pageBlocked,
  pageTargets,
  quotesOffPage,
  settleFingerprints,
  sha256,
  pluginRegRefs,
  pplsLookupNumber,
  pplsTargets,
  quoteTargets,
  renderSection
} from './lib/sourceDrift.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const FINGERPRINTS = path.join(here, 'source-fingerprints.json');
const USER_AGENT = 'CropCard source drift check (+https://github.com/mrpeanut01/crop-card)';

function parseArgs(argv) {
  const args = {
    only: null,
    verifyQuotes: false,
    update: false,
    publish: false,
    json: null,
    url: null
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--only') args.only = next().split(',');
    else if (a === '--verify-quotes') args.verifyQuotes = true;
    else if (a === '--update-fingerprints') args.update = true;
    else if (a === '--publish') args.publish = true;
    else if (a === '--json') args.json = next();
    else if (a === '--url') args.url = next();
    else if (a === '--repo') args.repo = next();
    else if (a === '--today') args.today = next();
    else if (a === '--cache') args.cache = next();
    else throw new Error(`unknown argument ${a}`);
  }
  args.repo ??= process.env.GITHUB_REPOSITORY || 'mrpeanut01/crop-card';
  args.today ??= new Date().toISOString().slice(0, 10);
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET or POST with retries on network errors, 429 and 5xx. */
async function fetchRetry(url, init = {}, attempts = 4) {
  let last = 'no attempt';
  for (let i = 0; i < attempts; i++) {
    if (i) await sleep(2000 * 3 ** (i - 1));
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        ...init,
        headers: { 'user-agent': USER_AGENT, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(90_000)
      });
      const body = Buffer.from(await res.arrayBuffer());
      if (res.status === 429 || res.status >= 500) {
        last = `HTTP ${res.status}`;
        continue;
      }
      return { ok: true, status: res.status, headers: Object.fromEntries(res.headers), body };
    } catch (err) {
      last = err?.cause?.code ?? err?.name ?? String(err);
    }
  }
  return { ok: false, error: `${last} after ${attempts} attempts` };
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

function loadSources() {
  return readdirSync(here)
    .filter((f) => f.endsWith('-sources.json'))
    .sort()
    .map((name) => ({ name, json: JSON.parse(readFileSync(path.join(here, name), 'utf8')) }));
}

function loadPlugins() {
  const root = path.join(repoRoot, 'plugins');
  const out = [];
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory() || dir.name.startsWith('_')) continue;
    for (const f of readdirSync(path.join(root, dir.name))) {
      if (!f.endsWith('.json')) continue;
      try {
        const json = JSON.parse(readFileSync(path.join(root, dir.name, f), 'utf8'));
        out.push({
          file: `plugins/${dir.name}/${f}`,
          json,
          id: json.id ?? f.replace(/\.json$/, '')
        });
      } catch {
        // not a plugin
      }
    }
  }
  return out;
}

function loadFingerprints() {
  try {
    return JSON.parse(readFileSync(FINGERPRINTS, 'utf8'));
  } catch {
    return { pages: {}, acknowledged: {} };
  }
}

const jsonOf = (res) => {
  if (!res.ok) return res;
  if (res.status === 404) return { ok: true, json: null };
  if (res.status >= 400) return { ok: false, error: `HTTP ${res.status}` };
  try {
    return { ok: true, json: JSON.parse(res.body.toString('utf8')) };
  } catch {
    return { ok: false, error: `HTTP ${res.status}, not JSON` };
  }
};

async function checkPpls(refs) {
  const targets = [...pplsTargets(refs)];
  const results = await pool(targets, 4, async ([regNo, list]) => {
    const res = jsonOf(await fetchRetry(PPLS_API_BASE + pplsLookupNumber(regNo)));
    return evaluatePpls(regNo, list, res.ok ? { ok: true, items: res.json?.items ?? [] } : res);
  });
  return { checked: targets.length, results };
}

async function omriSearch(query) {
  return jsonOf(
    await fetchRetry(OMRI_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ language: 'en', page: 1, query, exactMatchFilter: false })
    })
  );
}

async function checkOmri(refs, today) {
  const targets = omriTargets(refs);
  const cache = new Map();
  const lookup = async (t) => {
    const code = t.listing.code;
    if (!cache.has(code)) {
      cache.set(
        code,
        (async () => {
          let res = await omriSearch(code);
          if (!res.ok) return res;
          let listing = findOmriListing(res.json, code);
          const fallback = classifyUrl(t.ref.url).query;
          if (!listing && fallback) {
            res = await omriSearch(fallback);
            if (!res.ok) return res;
            listing = findOmriListing(res.json, code);
          }
          return { ok: true, listing };
        })()
      );
    }
    return cache.get(code);
  };
  const results = await pool(targets, 3, async (t) => evaluateOmri(t, await lookup(t), today));
  return { checked: new Set(targets.map((t) => t.listing.code)).size, results };
}

async function checkEcfr(refs) {
  const targets = [...ecfrTargets(refs)];
  const parts = new Map();
  const versions = (title, part) => {
    const key = `${title}:${part}`;
    if (!parts.has(key)) {
      parts.set(
        key,
        fetchRetry(`${ECFR_VERSIONS_BASE}title-${title}.json?part=${part}`).then(jsonOf)
      );
    }
    return parts.get(key);
  };
  const results = await pool(targets, 2, async ([key, list]) => {
    const [title, part] = key.split(':');
    return evaluateEcfr(key, list, await versions(title, part));
  });
  return { checked: targets.length, results };
}

async function checkPages(refs, stored, filterUrl, update) {
  const targets = [...pageTargets(refs)].filter(([url]) => !filterUrl || url === filterUrl);
  const current = {};
  const results = await pool(targets, 6, async ([url, list]) => {
    const fps = [];
    const bodies = [];
    const was = stored[url];
    for (let i = 0; i < 3; i++) {
      const res = await fetchRetry(url);
      if (!res.ok) return evaluatePage(url, list, was, res);
      const blocked = pageBlocked(res);
      if (blocked) return evaluatePage(url, list, was, { ok: false, error: blocked });
      const fp = fingerprint(res);
      if (!update && was && fp.status === was.status && fp.hash === was.hash) {
        fps.splice(0, fps.length, fp);
        bodies.splice(0, bodies.length, res);
        break;
      }
      fps.push(fp);
      bodies.push(res);
      if (fps.length > 1 && !settleFingerprints(fps).volatile) break;
    }
    const fp = settleFingerprints(fps);
    current[url] = fp;
    if (!update && (!was || was.hash === fp.hash)) {
      return evaluatePage(url, list, was, { ok: true, fingerprint: fp });
    }
    const res = bodies[fps.indexOf(fp)] ?? bodies[bodies.length - 1];
    const type = String(res.headers['content-type'] ?? '').toLowerCase();
    let text = null;
    if (type.includes('html')) text = extractHtmlText(res.body.toString('utf8'));
    else if (type.includes('pdf') && hasPdftotext()) text = pdfText(res.body);
    if (update && text) {
      const off = quotesOffPage(list, text);
      if (off.length) current[url] = { ...fp, offPage: off };
    }
    return evaluatePage(url, list, was, { ok: true, fingerprint: fp, text });
  });
  return { checked: targets.length, results, current };
}

/** The PDF's text in reading order and in layout order (tables keep their rows). */
function pdfText(buffer) {
  const dir = mkdtempSync(path.join(tmpdir(), 'drift-'));
  try {
    const file = path.join(dir, 'doc.pdf');
    writeFileSync(file, buffer);
    const run = (extra) =>
      execFileSync('pdftotext', [...extra, '-enc', 'UTF-8', file, '-'], {
        maxBuffer: 256 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore']
      }).toString('utf8');
    return [run([]), run(['-layout'])];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** --cache <dir> keeps downloaded PDFs between local runs. */
async function cachedFetch(url, cacheDir) {
  if (!cacheDir) return fetchRetry(url);
  const file = path.join(cacheDir, sha256(url).slice(7, 39) + '.bin');
  if (existsSync(file)) return { ok: true, status: 200, headers: {}, body: readFileSync(file) };
  const res = await fetchRetry(url);
  if (res.ok && res.status === 200) {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(file, res.body);
  }
  return res;
}

let pdftotextFound;
function hasPdftotext() {
  if (pdftotextFound === undefined) {
    try {
      execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
      pdftotextFound = true;
    } catch {
      pdftotextFound = false;
    }
  }
  return pdftotextFound;
}

async function verifyQuotes(refs, cacheDir) {
  if (!hasPdftotext()) throw new Error('pdftotext is not installed (poppler-utils)');
  const targets = [...quoteTargets(refs)];
  const results = await pool(targets, 4, async ([url, list]) => {
    const res = await cachedFetch(url, cacheDir);
    if (!res.ok) return evaluateQuotes(url, list, res);
    if (res.status >= 400)
      return evaluateQuotes(url, list, { ok: false, error: `HTTP ${res.status}` });
    try {
      return evaluateQuotes(url, list, { ok: true, text: pdfText(res.body) });
    } catch (err) {
      return evaluateQuotes(url, list, {
        ok: false,
        error: `pdftotext failed: ${err.message.split('\n')[0]}`
      });
    }
  });
  return { checked: targets.length, results };
}

function gh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'inherit'] });
}

function publish(report, section, repo) {
  const open = JSON.parse(
    gh([
      'issue',
      'list',
      '--repo',
      repo,
      '--state',
      'open',
      '--search',
      `"${ISSUE_TITLE}" in:title`,
      '--json',
      'number,title,body'
    ])
  ).find((i) => i.title === ISSUE_TITLE);
  const text = renderSection(section, report, open?.body, repo);
  const body = mergeIssueBody(open?.body, section, text);
  const sectionHasItems = /^- \[[ x]\] .*<!-- drift:/m.test(text);
  if (!open) {
    if (!sectionHasItems) {
      console.log('Nothing to report; no issue opened.');
      return;
    }
    try {
      gh(['label', 'create', ISSUE_LABEL, '--repo', repo, '--color', 'fbca04']);
    } catch {
      // already exists
    }
    const url = gh(
      [
        'issue',
        'create',
        '--repo',
        repo,
        '--title',
        ISSUE_TITLE,
        '--label',
        ISSUE_LABEL,
        '--body-file',
        '-'
      ],
      body
    );
    console.log(`Opened ${url.trim()}`);
    return;
  }
  gh(['issue', 'edit', String(open.number), '--repo', repo, '--body-file', '-'], body);
  console.log(`Updated #${open.number}`);
  const blind = report.services.filter((s) => s.checked > 0 && s.unreachable >= s.checked);
  if (!hasOpenItems(body) && !blind.length) {
    gh([
      'issue',
      'close',
      String(open.number),
      '--repo',
      repo,
      '--comment',
      `Every item is ticked or cleared as of ${report.generatedOn}.`
    ]);
    console.log(`Closed #${open.number}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const plugins = loadPlugins();
  const pluginIds = new Set(plugins.map((p) => p.id));
  const refs = [...collectRefs(loadSources(), pluginIds), ...pluginRegRefs(plugins)];
  const stored = loadFingerprints();
  stored.pages ??= {};
  stored.acknowledged ??= {};
  stored.quoteBaseline ??= {};

  const kinds = args.verifyQuotes ? ['quote'] : (args.only ?? ['ppls', 'omri', 'ecfr', 'pages']);
  const services = [];
  const findings = [];
  const unreachable = [];
  const noBaseline = [];
  const add = (name, { checked, results }) => {
    let down = 0;
    for (const r of results) {
      findings.push(...r.findings);
      unreachable.push(...r.unreachable);
      noBaseline.push(...(r.noBaseline ?? []));
      if (r.unreachable.length) down++;
    }
    services.push({ name, checked, unreachable: down });
    console.log(
      `${name}: checked ${checked}, findings ${results.reduce((n, r) => n + r.findings.length, 0)}, could not check ${down}`
    );
  };

  if (kinds.includes('ppls')) add('ppls', await checkPpls(refs));
  if (kinds.includes('omri')) add('omri', await checkOmri(refs, args.today));
  if (kinds.includes('ecfr')) add('ecfr', await checkEcfr(refs));
  if (kinds.includes('pages')) {
    const pages = await checkPages(refs, stored.pages, args.url, args.update);
    add('pages', pages);
    if (args.update) {
      const cited = new Set(pageTargets(refs).keys());
      for (const [url, fp] of Object.entries(pages.current))
        stored.pages[url] = { ...fp, checkedOn: args.today };
      for (const u of pages.results.flatMap((r) => r.unreachable)) delete stored.pages[u.target];
      if (!args.url)
        for (const url of Object.keys(stored.pages)) if (!cited.has(url)) delete stored.pages[url];
      stored.pages = Object.fromEntries(
        Object.entries(stored.pages).sort(([a], [b]) => a.localeCompare(b))
      );
      writeFileSync(FINGERPRINTS, JSON.stringify(stored, null, 2) + '\n');
      console.log(
        `Stored ${Object.keys(pages.current).length} fingerprint(s) in source-fingerprints.json`
      );
    }
  }
  if (kinds.includes('quote')) {
    const quotes = await verifyQuotes(refs, args.cache);
    add('quotes', quotes);
    if (args.update) {
      const down = new Set(quotes.results.flatMap((r) => r.unreachable.map((u) => u.target)));
      const next = Object.fromEntries(
        Object.entries(stored.quoteBaseline).filter(([, v]) => down.has(v.url))
      );
      for (const f of quotes.results.flatMap((r) => r.findings)) {
        next[f.id] = stored.quoteBaseline[f.id] ?? { url: f.links[0], on: args.today };
      }
      stored.quoteBaseline = Object.fromEntries(
        Object.entries(next).sort(([a], [b]) => a.localeCompare(b))
      );
      writeFileSync(FINGERPRINTS, JSON.stringify(stored, null, 2) + '\n');
      console.log(
        `Stored ${Object.keys(next).length} quote(s) that do not match word for word as the baseline`
      );
    }
  }

  const report = {
    generatedOn: args.today,
    services,
    findings: args.update
      ? []
      : dropAcknowledged(findings, { ...stored.quoteBaseline, ...stored.acknowledged }),
    quoteBaselineCount: Object.keys(stored.quoteBaseline).length,
    unreachable,
    noBaseline: args.update ? [] : noBaseline
  };
  for (const s of services) {
    if (s.checked && s.unreachable >= s.checked)
      console.log(`::warning::${s.name}: no source answered; nothing was checked`);
  }
  if (args.json) writeFileSync(args.json, JSON.stringify(report, null, 2) + '\n');
  const section = args.verifyQuotes ? 'quotes' : 'weekly';
  const md = renderSection(section, report, '', args.repo);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  if (args.publish && !args.update) publish(report, section, args.repo);
  else if (!args.update) console.log(`\n${md}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
