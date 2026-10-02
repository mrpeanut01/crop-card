#!/usr/bin/env node
/**
 * Spanish coverage crawl. Signs in as the seeded demo owner on a running
 * server with CROPCARD_LOCALES=en,es and AUTH_MODE=direct, switches to
 * Spanish, walks every page it can reach (two per route pattern) and lists
 * text that still looks English, per page and overall. Data (farm, block,
 * product and plugin names) and safety text that stays English by rule will
 * show up too; read the report, do not chase it to zero.
 *
 * Usage: BASE=http://localhost:5300 [SEED=1] [MAX=500] [OUT=report.json] \
 *          node scripts/i18n-crawl.mjs
 */
import { chromium } from '@playwright/test';
import { readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const BASE = process.env.BASE ?? 'http://127.0.0.1:5300';
const MAX = Number(process.env.MAX ?? 400);
const OUT = process.env.OUT ?? 'i18n-crawl-report.json';
const ROLE = process.env.ROLE ?? 'owner';
const EN = new Set(
  `the and your you with this that for from will have has are is was be been can not when what which there their its on at by or an of to in into here how add set put first edit save cancel delete open close back next done skip show hide all none more less new view search filter export print today week month season crop crops block blocks field fields area areas seed seeds harvest spray records record settings sign out up owner helper farm equipment inventory stock lots lot planting plantings task tasks due late planned weather frost notes name date type status yes ready upcoming map draw invite turn use change remove learn about help details per each last days day hours ago since until before after start end mark overdue unknown missing optional required try again loading saving saved failed nothing yet don't doesn't isn't won't it's we our us they them my me get got make made see now only also just more most some any every other than then too very well good bad off over under between without within while where why who whose how much many few left right top bottom wait waiting sync synced offline online animals animal pets flock group groups treatment health log move moved product products sprayer sprayers calibrate calibration rate rates tank mix water feed bed beds garden designer card cards labels label quantity unit units weight acres feet inches gallons pounds ounces cost price sale sales money income expense expenses profit hour minutes minute account billing plan's plans free grower help started getting tour finish later continue confirm apply remove reset undo redo update updated create created edit edited delete deleted pending queued sent send receive received copy paste upload download file files photo photos camera scan barcode manual entry method methods choose pick select selected`.split(
    /\s+/
  )
);
const ES_HINT =
  /[áéíóúñ¿¡ü]|\b(el|la|los|las|del|que|para|con|por|una|tus|más|aún|está|están|hoy|esta|este|sin|cuando|donde|qué|cómo|hay|nada|todo|todos|tu|su|sus|se|al|lo|le|les|mi|o|y|en|es|un|de)\b/i;
function looksEnglish(s) {
  const t = s.replace(/\s+/g, ' ').trim();
  if (!/[A-Za-z]{2}/.test(t)) return false;
  if (/^(https?:|\/|[\w.-]+@)/.test(t)) return false;
  const words = t.toLowerCase().match(/[a-z][a-z']*/g) ?? [];
  if (!words.length) return false;
  const en = words.filter((w) => EN.has(w)).length;
  if (en === 0) return false;
  const es = (t.match(new RegExp(ES_HINT.source, 'gi')) ?? []).length;
  if (words.length === 1) return es === 0;
  return en >= Math.max(1, Math.ceil(words.length * 0.25)) && en > es;
}
function routeSeeds() {
  const root = 'src/routes';
  const out = [];
  const walk = (dir, rel) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) {
        if (f.startsWith('(') || f === 'api' || f === '_dev' || f === 'admin') continue;
        walk(p, rel + '/' + f);
      } else if (f === '+page.svelte' && !rel.includes('[')) out.push(rel || '/');
    }
  };
  walk(root, '');
  return out;
}
const norm = (p) =>
  p
    .split('/')
    .map((s) => (/^[0-9a-f-]{8,}$|\d/.test(s) && s.length > 6 ? ':id' : s))
    .join('/');
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH });
const ctx = await browser.newContext({
  baseURL: BASE,
  locale: 'es-MX',
  viewport: { width: 1280, height: 900 }
});
const page = await ctx.newPage();
const r = await page.request.post('/?/demo', {
  form: { role: ROLE },
  headers: { 'x-sveltekit-action': 'true', origin: BASE },
  maxRedirects: 0
});
if (!r.ok()) throw new Error('signin ' + r.status());
const lr = await page.request.post('/api/me/locale', {
  data: { locale: 'es' },
  headers: { origin: BASE }
});
if (!lr.ok()) throw new Error('locale ' + lr.status());
const post = (url, data) =>
  page.request.post(url, { data, headers: { origin: BASE } }).then(async (r) => {
    if (!r.ok()) console.error('seed', url, r.status(), (await r.text()).slice(0, 200));
    return r.ok() ? r.json() : null;
  });
if (process.env.SEED === '1') {
  const seed = await post('/api/stock', {
    category: 'seed',
    displayName: 'Cherokee Purple tomato',
    defaultUnit: 'seeds',
    pluginId: 'tomato-cherokee-purple'
  });
  if (seed?.item)
    await post(`/api/stock/${seed.item.id}/lots`, { receivedQuantity: 50, unit: 'seeds' });
  await post('/api/stock', {
    category: 'fertilizer',
    displayName: 'Composted manure',
    defaultUnit: 'lb'
  });
  await post('/api/stock', {
    category: 'herbicide',
    displayName: 'Roundup PowerMax',
    defaultUnit: 'fl-oz'
  });
  await post('/api/animals', { speciesId: 'dog', name: 'Biscuit', purpose: 'pet' });
  await post('/api/animal-groups', { name: 'Hens', speciesId: 'chicken', headCount: 4 });
  const d = new Date();
  const ymd = d.toISOString().slice(0, 10);
  await post('/api/tasks', { kind: 'primary', title: 'Weed the beds', scheduledFor: Date.now() });
}
const queue = [...routeSeeds(), ...(process.env.EXTRA ?? '').split(',').filter(Boolean)];
const seen = new Set();
const patterns = new Map();
const report = {};
const global = new Map();
while (queue.length && seen.size < MAX) {
  const path = queue.shift();
  if (seen.has(path)) continue;
  const pat = norm(path);
  if ((patterns.get(pat) ?? 0) >= 2) continue;
  seen.add(path);
  patterns.set(pat, (patterns.get(pat) ?? 0) + 1);
  let res;
  try {
    res = await page.goto(path, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(1200);
  } catch (e) {
    console.error('nav', path, String(e).slice(0, 120));
    continue;
  }
  const finalPath = new URL(page.url()).pathname + new URL(page.url()).search;
  const data = await page.evaluate(() => {
    const out = [];
    const skip = new Set([
      'SCRIPT',
      'STYLE',
      'NOSCRIPT',
      'CODE',
      'PRE',
      'KBD',
      'SAMP',
      'svg',
      'SVG'
    ]);
    const skipped = 'code,pre,kbd,samp,svg,[data-i18n-skip],[lang="en"][data-english-only]';
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) {
      const el = n.parentElement;
      if (!el || skip.has(el.tagName) || el.closest(skipped)) continue;
      const v = n.nodeValue.replace(/\s+/g, ' ').trim();
      if (v) out.push(v);
    }
    for (const el of document.querySelectorAll('[aria-label],[title],[placeholder],[alt]')) {
      if (el.closest('[lang="en"][data-english-only]')) continue;
      for (const a of ['aria-label', 'title', 'placeholder', 'alt']) {
        const v = el.getAttribute(a);
        if (v) out.push('@' + a + ': ' + v);
      }
    }
    const t = document.title;
    if (t) out.push('@title-tag: ' + t);
    const links = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
    return { out, links };
  });
  const hits = [...new Set(data.out.filter((s) => looksEnglish(s.replace(/^@[\w-]+: /, ''))))];
  report[finalPath] = { status: res?.status(), hits };
  for (const h of hits) {
    const g = global.get(h) ?? [];
    g.push(finalPath);
    global.set(h, g);
  }
  for (const href of data.links) {
    if (
      !href ||
      !href.startsWith('/') ||
      href.startsWith('//') ||
      href.startsWith('/api/') ||
      href.includes('.csv') ||
      href.includes('.pdf') ||
      href.includes('.zip') ||
      href.startsWith('/signout') ||
      href.startsWith('/admin')
    )
      continue;
    const p = href.split('#')[0];
    if (!seen.has(p)) queue.push(p);
  }
}
const globalArr = [...global.entries()]
  .map(([s, pages]) => ({ s, n: pages.length, pages: [...new Set(pages)].slice(0, 4) }))
  .sort((a, b) => b.n - a.n);
writeFileSync(OUT, JSON.stringify({ pages: report, strings: globalArr }, null, 1));
console.log('pages', seen.size, 'unique english strings', globalArr.length);
await browser.close();
