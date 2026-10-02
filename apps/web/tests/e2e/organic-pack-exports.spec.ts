import { readFileSync } from 'node:fs';
import type { Browser, Page } from '@playwright/test';
import { expect, test } from './lib/test';
import { provisionEmptyFarm, provisionHelper } from './lib/freshFarm';
import { originOf } from './lib/newOwner';

// Phase 33B (cluster B4): the certifier pack, the animal treatment log and
// the animal section of the year in review.

const PHONE = { width: 375, height: 800 };
const DAY = 86_400_000;
const PREAMBLE = 'Prepared from records kept in CropCard. This is not a certification.';

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: { origin: originOf(page) } });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.cropcard.local`;
}

/** Invites an inspector to the owner's farm and signs them in. */
async function provisionInspector(ownerPage: Page, browser: Browser): Promise<Page> {
  const email = uniqueEmail('inspector');
  const origin = originOf(ownerPage);
  const invite = await ownerPage.request.post('/api/invites', {
    data: { email, role: 'inspector' },
    headers: { origin }
  });
  expect(invite.ok(), await invite.text()).toBe(true);
  const { acceptUrl } = (await invite.json()) as { acceptUrl: string };
  const token = acceptUrl.split('/invite/')[1];
  const context = await browser.newContext({
    baseURL: origin,
    serviceWorkers: 'block',
    acceptDownloads: true
  });
  const inspector = await context.newPage();
  await inspector.route(
    (url) => url.origin !== new URL(origin).origin && url.protocol.startsWith('http'),
    (route) => route.fulfill({ status: 204, body: '' })
  );
  const signin = await inspector.request.post('/?/signin', {
    form: { email },
    headers: { 'x-sveltekit-action': 'true', origin },
    maxRedirects: 0
  });
  expect(signin.ok()).toBe(true);
  const accept = await inspector.request.post(`/invite/${token}?/accept`, {
    form: {},
    headers: { 'x-sveltekit-action': 'true', origin },
    maxRedirects: 0
  });
  expect(accept.ok(), await accept.text()).toBe(true);
  return inspector;
}

/** Store-only ZIP reader: entry name → bytes. */
function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let at = 0;
  while (at + 4 <= buf.length && buf.readUInt32LE(at) === 0x04034b50) {
    const size = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26);
    const extraLen = buf.readUInt16LE(at + 28);
    const name = buf.subarray(at + 30, at + 30 + nameLen).toString('utf8');
    const start = at + 30 + nameLen + extraLen;
    out.set(name, buf.subarray(start, start + size));
    at = start + size;
  }
  return out;
}

async function seedHensAndBed(page: Page) {
  const { field } = await post<{ field: { id: string } }>(page, '/api/fields', {
    name: 'Market Garden',
    kind: 'garden'
  });
  await post(page, '/api/blocks', { name: 'Bed 1', fieldId: field.id });
  await post(page, '/api/organic/status', {
    subjectType: 'field',
    subjectId: field.id,
    status: 'transitioning',
    effectiveOn: '2025-03-01',
    certifier: 'Valley Organic',
    note: null,
    documentId: null
  });
  const flock = await post<{ group: { id: string }; members: { id: string }[] }>(
    page,
    '/api/animal-groups',
    { name: 'Laying hens', speciesId: 'chicken', headCount: 5, members: [{ name: 'Pearl' }] }
  );
  const henId = flock.members[0].id;
  await post(page, '/api/animals/health/record', {
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
  await post(page, '/api/animals/health/record', {
    subjectType: 'group',
    subjectId: flock.group.id,
    kind: 'vaccination',
    productName: 'Marek vaccine',
    administeredAt: Date.now() - DAY,
    labelUse: 'label'
  });
  return { fieldId: field.id, henId, groupId: flock.group.id };
}

test.describe('certifier pack and treatment log (33B, B4)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('an inspector downloads the pack and the treatment log; a helper cannot', async ({
    page,
    browser
  }) => {
    await provisionEmptyFarm(page);
    await seedHensAndBed(page);
    const year = new Date().getFullYear();

    const inspector = await provisionInspector(page, browser);
    await inspector.setViewportSize(PHONE);
    await open(inspector, '/records/organic');
    await expect(inspector.getByRole('heading', { name: 'Pack for your inspector' })).toBeVisible();
    await noHorizontalOverflow(inspector);
    await inspector.getByTestId('pack-from').fill(`${year - 1}-01-01`);
    await inspector.getByTestId('pack-to').fill(`${year}-12-31`);

    const [pack] = await Promise.all([
      inspector.waitForEvent('download'),
      inspector.getByTestId('pack-download').click()
    ]);
    expect(pack.suggestedFilename()).toMatch(/^cropcard-organic-pack-.*\.zip$/);
    const files = unzip(readFileSync(await pack.path()));
    expect([...files.keys()]).toEqual([
      'README.txt',
      'summary.pdf',
      '01-statuses.csv',
      '02-activity.csv',
      '03-inputs.csv',
      '04-seed-sourcing.csv',
      '05-animal-treatments.csv',
      '06-harvests.csv',
      '07-documents.csv'
    ]);
    for (const [name, bytes] of files) {
      if (name.endsWith('.csv'))
        expect(bytes.toString('utf8').split('\r\n')[0], name).toBe(PREAMBLE);
    }
    const statuses = files.get('01-statuses.csv')!.toString('utf8');
    expect(statuses).toContain('Transitioning');
    expect(statuses).toContain('Valley Organic');
    expect(files.get('05-animal-treatments.csv')!.toString('utf8')).toContain('Farm store wormer');
    expect(files.get('06-harvests.csv')!.toString('utf8')).toContain('Sale recorded');
    const allText = [...files.entries()]
      .filter(([n]) => n.endsWith('.csv') || n.endsWith('.txt'))
      .map(([, b]) => b.toString('utf8'))
      .join('\n');
    expect(allText).not.toMatch(/\bcertified\b|\beligible\b|\bcompliant\b/i);

    const [log] = await Promise.all([
      inspector.waitForEvent('download'),
      inspector.getByTestId('pack-log-csv').click()
    ]);
    const lines = readFileSync(await log.path(), 'utf8')
      .trimEnd()
      .split('\r\n');
    expect(lines[0].startsWith('Date given,Course end,Animal or group,Species,Product')).toBe(true);
    expect(lines).toHaveLength(3);
    expect(lines.join('\n')).toContain('Pearl');
    expect(lines.join('\n')).toContain('Laying hens');

    const pdf = await inspector.request.get(
      `/api/animals/treatments.pdf?from=${year - 1}-01-01&to=${year}-12-31`
    );
    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');

    const helper = await provisionHelper(page, browser);
    const refused = await helper.request.get(
      `/api/organic/pack.zip?from=${year}-01-01&to=${year}-12-31`
    );
    expect(refused.status()).toBe(403);
    const refusedLog = await helper.request.get(
      `/api/animals/treatments.csv?from=${year}-01-01&to=${year}-12-31`
    );
    expect(refusedLog.status()).toBe(403);
    await open(helper, '/records/organic');
    await expect(helper.getByRole('heading', { name: 'Pack for your inspector' })).toHaveCount(0);
  });

  test('the year in review shows the animal section with treatment log links', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await provisionEmptyFarm(page);
    await seedHensAndBed(page);
    await open(page, '/records');
    const section = page.getByRole('region', { name: 'Animals' });
    await expect(section).toBeVisible();
    await expect(section.getByText('From records on file.')).toBeVisible();
    await expect(section.getByRole('cell', { name: 'Farm store wormer' })).toBeVisible();
    await expect(section.getByRole('cell', { name: 'Chicken' }).first()).toBeVisible();
    await expect(section.getByTestId('treatment-log-csv')).toBeVisible();
    await noHorizontalOverflow(page);

    const year = new Date().getFullYear();
    const summary = await page.request.get(`/api/records/year-summary.pdf?year=${year}`);
    expect(summary.status()).toBe(200);
  });

  test('a garden household with no animals sees no animal section', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await provisionEmptyFarm(page);
    await open(page, '/records');
    await expect(page.getByRole('heading', { name: /season summary/ })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Animals' })).toHaveCount(0);
    await noHorizontalOverflow(page);
  });
});
