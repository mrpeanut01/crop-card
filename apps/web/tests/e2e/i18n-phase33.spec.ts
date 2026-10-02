import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { en } from '../../src/lib/i18n/catalogs/en';
import { es } from '../../src/lib/i18n/catalogs/es';
import type { MessageKey } from '../../src/lib/i18n/catalogs/en';

// Phase 34B (#510): the Phase 33 surfaces in Spanish. Runs on the magic-link
// preview (E2E_PORT + 1), the one with CROPCARD_LOCALES=en,es and a vault.
const PORT = Number(process.env.E2E_PORT ?? 5173);
const MAGIC_BASE = `http://localhost:${Number(process.env.E2E_MAGIC_PORT ?? PORT + 1)}`;
const DAY = 86_400_000;
const PHONE = { width: 375, height: 800 };
const DISCOVER = process.env.I18N_DISCOVER === '1';

async function outboxLinks(request: APIRequestContext, to: string): Promise<string[]> {
  const res = await request.get(`${MAGIC_BASE}/_dev/outbox?to=${encodeURIComponent(to)}`);
  const { messages } = (await res.json()) as { messages: Array<{ body: string }> };
  return messages.map((m) => m.body);
}

async function signInByLink(page: Page, email: string): Promise<void> {
  const before = (await outboxLinks(page.request, email)).length;
  const res = await page.request.post('/api/auth/magic-link', { data: { email } });
  expect(res.status()).toBe(200);
  let token = '';
  await expect
    .poll(async () => {
      const bodies = await outboxLinks(page.request, email);
      if (bodies.length <= before) return '';
      const link = bodies.at(-1)?.match(/https?:\/\/\S+\/auth\/verify\?\S+/)?.[0];
      token = link ? (new URL(link).searchParams.get('token') ?? '') : '';
      return token;
    })
    .toBeTruthy();
  const confirm = await page.request.post('/auth/verify?/confirm', {
    form: { token },
    headers: { 'x-sveltekit-action': 'true', origin: MAGIC_BASE },
    maxRedirects: 0
  });
  expect(confirm.status()).toBe(200);
}

async function send<T>(page: Page, url: string, data: unknown, method = 'POST'): Promise<T> {
  const res = await page.request.fetch(url, {
    method,
    data,
    headers: { origin: MAGIC_BASE }
  });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

const ymd = (ms: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ms));

function pdf(marker: string): Buffer {
  return Buffer.from(
    `%PDF-1.4\n% ${marker}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`
  );
}

interface Farm {
  gardenId: string;
  bedId: string;
  orchardId: string;
  pastureBlockId: string;
  henId: string;
  groupId: string;
  seedId: string;
  batchId: string;
}

async function seedFarm(page: Page): Promise<Farm> {
  const headers = { 'x-sveltekit-action': 'true', origin: MAGIC_BASE };
  const farm = await page.request.post('/onboarding?/farm', {
    form: { farmName: `Granja ${Date.now()}`, lat: '39.137', lon: '-77.714' },
    headers,
    maxRedirects: 0
  });
  expect(farm.ok()).toBe(true);
  const form = new URLSearchParams();
  form.append('growing', 'garden');
  await page.request.post('/onboarding?/growing', {
    data: form.toString(),
    headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
    maxRedirects: 0
  });

  const { field: garden } = await send<{ field: { id: string } }>(page, '/api/fields', {
    name: 'Market Garden',
    kind: 'garden'
  });
  const { block: bed } = await send<{ block: { id: string } }>(page, '/api/blocks', {
    name: 'Bed 1',
    acres: 0.01,
    fieldId: garden.id
  });
  await send(page, '/api/organic/status', {
    subjectType: 'field',
    subjectId: garden.id,
    status: 'transitioning',
    effectiveOn: '2025-03-01',
    certifier: 'Valley Organic',
    note: null,
    documentId: null
  });
  await send(page, '/api/fertility/applications', {
    blockId: bed.id,
    source: 'urea-46-0-0',
    ratePerAcre: 100,
    rateUnit: 'lb',
    occurredAt: Date.now() - 2 * DAY
  });

  const { block: orchard } = await send<{ block: { id: string } }>(page, '/api/blocks', {
    name: 'Orchard row',
    fieldId: garden.id
  });
  await send(page, `/api/blocks/${orchard.id}/plantings`, {
    cropPluginId: 'apple-orchard',
    plantingDate: Date.now() - 400 * DAY
  });
  const { event } = await send<{ event: { id: string } }>(page, '/api/harvest/record', {
    blockId: orchard.id,
    cropPluginId: 'apple-orchard',
    quantity: '40 lb'
  });
  await send(page, `/api/harvest/${event.id}/dispositions`, {
    kind: 'sold',
    quantity: 10,
    unit: 'lb',
    soldAsOrganic: true,
    occurredAt: Date.now()
  });

  const flock = await send<{ group: { id: string }; members: { id: string }[] }>(
    page,
    '/api/animal-groups',
    { name: 'Laying hens', speciesId: 'chicken', headCount: 5, members: [{ name: 'Pearl' }] }
  );
  const henId = flock.members[0].id;
  await send(page, '/api/animals/health/record', {
    subjectType: 'animal',
    subjectId: henId,
    kind: 'deworm',
    productName: 'Farm store wormer',
    dose: 1,
    doseUnit: 'mL',
    route: 'oral',
    administeredAt: Date.now() - 2 * DAY,
    labelUse: 'label'
  });

  const { item } = await send<{ item: { id: string } }>(page, '/api/stock', {
    category: 'seed',
    displayName: 'Bush Bean Provider',
    defaultUnit: 'seeds',
    pluginId: 'bush-bean-provider'
  });
  await send(page, `/api/stock/${item.id}/set-quantity`, { quantity: 200 });

  const { field: pasture } = await send<{ field: { id: string } }>(page, '/api/fields', {
    name: 'Summer lot',
    kind: 'pasture'
  });
  const { block: lot } = await send<{ block: { id: string } }>(page, '/api/blocks', {
    name: 'Summer lot strip',
    fieldId: pasture.id
  });
  await send(page, `/api/blocks/${lot.id}/plantings`, {
    cropPluginId: 'sudangrass-piper',
    plantingDate: Date.now() - 20 * DAY
  });
  await send(page, '/api/forage/tests', {
    blockId: lot.id,
    sampledOn: ymd(Date.now() - DAY),
    lab: 'Dairy One',
    nitrateValue: 0.4,
    nitrateUnits: 'pct-nitrate',
    labRating: { nitrate: 'Low' }
  });

  const { batch } = await send<{ batch: { id: string } }>(page, '/api/amendments/batches', {
    kind: 'manure',
    name: 'Horse manure',
    origin: 'bought',
    supplier: 'Neighbour',
    supplierStatement: 'unknown',
    startedOn: ymd(Date.now())
  });
  const spread = (confirmCarryover?: string) =>
    page.request.post('/api/fertility/applications', {
      data: {
        blockId: bed.id,
        source: 'horse manure',
        ratePerAcre: 10,
        rateUnit: 'ton-per-acre',
        amendmentBatchId: batch.id,
        ...(confirmCarryover ? { confirmCarryover } : {})
      },
      headers: { origin: MAGIC_BASE }
    });
  const first = await spread();
  const { factsHash } = (await first.json()) as { factsHash: string };
  expect((await spread(factsHash)).status()).toBe(201);

  const upload = await page.request.post('/api/documents?kind=label&name=Wormer%20label.pdf', {
    data: pdf('E2E-ES'),
    headers: { origin: MAGIC_BASE, 'content-type': 'application/pdf' }
  });
  expect(upload.ok(), await upload.text()).toBe(true);

  await send(page, '/api/tasks', {
    kind: 'primary',
    title: 'Weed the beds',
    scheduledFor: Date.now()
  });

  return {
    gardenId: garden.id,
    bedId: bed.id,
    orchardId: orchard.id,
    pastureBlockId: lot.id,
    henId,
    groupId: flock.group.id,
    seedId: item.id,
    batchId: batch.id
  };
}

/** Text on the page that reads as English, outside the English-by-rule
 *  regions, code and data the owner typed. Same heuristic as
 *  scripts/i18n-crawl.mjs, kept small. */
async function englishLines(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = tw.nextNode())) {
      const el = n.parentElement;
      if (!el || el.closest('script,style,code,pre,svg,[data-i18n-skip],[data-english-only]'))
        continue;
      if (el.closest('[hidden],details:not([open]) > :not(summary)')) continue;
      const v = (n.nodeValue ?? '').replace(/\s+/g, ' ').trim();
      if (v) out.push(v);
    }
    for (const el of document.querySelectorAll('[aria-label],[title],[placeholder]')) {
      if (el.closest('[data-english-only]')) continue;
      for (const a of ['aria-label', 'title', 'placeholder']) {
        const v = el.getAttribute(a);
        if (v) out.push(v);
      }
    }
    return out;
  });
}

const EN_WORDS =
  /\b(the|and|your|you|with|this|that|for|from|will|have|has|are|is|was|not|when|what|which|there|on|at|by|or|an|of|to|in|into|here|how|add|save|cancel|delete|open|close|back|next|show|none|more|less|new|view|record|records|owner|file|files|status|date|organic|seed|harvest|sold|kept|lot|batch|test|weed|block|field|area)\b/gi;
const ES_HINT =
  /[áéíóúñ¿¡ü]|\b(el|la|los|las|del|que|para|con|por|una|tus|más|está|hoy|esta|este|sin|cuando|donde|qué|cómo|hay|nada|todo|tu|su|sus|se|al|lo|le|mi|y|en|es|un|de)\b/gi;

function looksEnglish(s: string): boolean {
  if (!/[A-Za-z]{2}/.test(s)) return false;
  const words = s.toLowerCase().match(/[a-z][a-z']*/g) ?? [];
  const en = (s.match(EN_WORDS) ?? []).length;
  if (en === 0) return false;
  const es = (s.match(ES_HINT) ?? []).length;
  if (words.length === 1) return es === 0;
  return en >= Math.max(1, Math.ceil(words.length * 0.25)) && en > es;
}

/** Names and values the test typed, which stay as typed. */
const DATA = [
  'Market Garden',
  'Bed 1',
  'Orchard row',
  'Laying hens',
  'Pearl',
  'Farm store wormer',
  'Bush Bean Provider',
  'Summer lot',
  'Horse manure',
  'Neighbour',
  'Valley Organic',
  'Wormer label',
  'Weed the beds',
  'Dairy One',
  'CropCard'
];

function stripData(s: string): string {
  let out = s;
  for (const d of DATA) out = out.split(d).join('');
  return out;
}

async function englishOn(page: Page, route: string): Promise<string[]> {
  const res = await page.goto(route);
  expect(res?.status(), route).toBeLessThan(500);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('html'), route).toHaveAttribute('lang', 'es');
  const lines = await englishLines(page);
  const hits = [...new Set(lines.filter((s) => looksEnglish(stripData(s))))];
  if (process.env.I18N_DUMP === '1') {
    const loose = [
      ...new Set(
        lines.filter((s) => {
          const t = stripData(s);
          return /[a-z]{3}/.test(t) && !(t.match(ES_HINT) ?? []).length;
        })
      )
    ];
    console.log(`\n## LOOSE ${route}\n${loose.map((h) => `  ~ ${h}`).join('\n')}`);
  }
  if (DISCOVER) console.log(`\n## ${route}\n${hits.map((h) => `  - ${h}`).join('\n')}`);
  return hits;
}

/** English sentences from the Phase 33 surfaces that must not show in
 *  Spanish (catalog keys, so the English cannot drift from the page). */
const KNOWN_ENGLISH: Array<[string, MessageKey]> = [
  ['/records', 'recui.year.covered.none'],
  ['/records', 'recui.year.covered.title'],
  ['/records/organic', 'organic.lede'],
  ['/records/organic', 'organic.add.help'],
  ['/settings/documents', 'docs.page.filesTitle'],
  ['carryover', 'carry.page.lede'],
  ['carryover', 'amend.bioassay.controls'],
  ['carryover', 'amend.bioassay.ratio-osu']
];

test.describe('Phase 33 surfaces in Spanish (#510)', () => {
  test.use({ baseURL: MAGIC_BASE });

  test('organic, harvest, documents, forage and carryover screens show Spanish chrome', async ({
    page
  }) => {
    test.setTimeout(240_000);
    const email = `i18n-p33-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.cropcard.local`;
    await signInByLink(page, email);
    const farm = await seedFarm(page);
    await send(page, '/api/me/locale', { locale: 'es' });
    await page.setViewportSize(PHONE);

    const carryover = `/plan/blocks/${farm.bedId}/carryover`;
    const routes = [
      '/records/organic',
      '/records',
      '/harvest',
      `/inventory/seed/${farm.seedId}`,
      '/settings/documents',
      '/forage',
      `/inventory/amendment/${farm.batchId}`,
      carryover,
      `/animals/${farm.henId}/health`,
      `/fertility?block=${farm.bedId}`,
      `/plan?setup=skip&area=${farm.gardenId}`
    ];
    const bodies: Record<string, string> = {};
    for (const route of routes) {
      await test.step(route, async () => {
        await englishOn(page, route);
        if (route === carryover)
          await page.getByTestId('bioassay-guide').locator('summary').click();
        bodies[route === carryover ? 'carryover' : route] = await page.locator('body').innerText();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect(overflow, `${route} scrolls sideways`).toBeLessThanOrEqual(0);
      });
    }
    if (DISCOVER) return;

    for (const [where, key] of KNOWN_ENGLISH) {
      expect(en[key], key).not.toBe(es[key]);
      expect(bodies[where], `${where} shows "${en[key]}"`).not.toContain(en[key]);
      if (where === 'carryover' || where === '/records') {
        expect(bodies[where], `${where} lacks "${es[key]}"`).toContain(es[key] as string);
      }
    }

    // The carryover line itself stays English as hazard wording, marked so.
    await page.goto(carryover);
    await page.waitForLoadState('networkidle');
    const line = page.getByTestId('carryover-line').locator('[data-english-only="safety"]');
    await expect(line).toHaveAttribute('lang', 'en');
    await expect(line).toContainText('Consider a pea or bean test before planting.');
  });

  test('a refused upload and a refused review answer in Spanish', async ({ page }) => {
    test.setTimeout(180_000);
    const email = `i18n-p33r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.cropcard.local`;
    await signInByLink(page, email);
    const headers = { 'x-sveltekit-action': 'true', origin: MAGIC_BASE };
    const farm = await page.request.post('/onboarding?/farm', {
      form: { farmName: `Granja ${Date.now()}`, lat: '39.137', lon: '-77.714' },
      headers,
      maxRedirects: 0
    });
    expect(farm.ok()).toBe(true);
    const flock = await send<{ group: { id: string } }>(page, '/api/animal-groups', {
      name: 'Laying hens',
      speciesId: 'chicken',
      headCount: 3
    });
    const { event } = await send<{ event: { id: string } }>(page, '/api/animals/health/record', {
      subjectType: 'group',
      subjectId: flock.group.id,
      kind: 'vaccination',
      productName: 'Marek vaccine',
      administeredAt: Date.now() - DAY,
      labelUse: 'label'
    });
    await send(page, '/api/me/locale', { locale: 'es' });

    const review = await page.request.post('/api/organic/treatment-reviews', {
      data: { healthEventId: event.id, outcome: 'not-affected', reason: 'The vet said so' },
      headers: { origin: MAGIC_BASE }
    });
    expect(review.status()).toBe(409);
    const body = (await review.json()) as { error: string; message: string };
    expect(body.error).toBe('REVIEW_NOT_NEEDED');
    expect(body.message).toBe(es['organic.api.notReached']);

    await page.setViewportSize(PHONE);
    await page.goto('/settings/documents');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('documents-upload-input').setInputFiles({
      name: 'picture.gif',
      mimeType: 'image/gif',
      buffer: Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'binary')
    });
    const alert = page.getByRole('alert');
    await expect(alert).toHaveText(es['docs.copy.unsupported'] as string, { timeout: 20_000 });
    await expect(alert).not.toContainText("can't be stored");
  });
});
