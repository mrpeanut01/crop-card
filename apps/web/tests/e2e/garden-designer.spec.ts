import type { Browser, Locator, Page } from '@playwright/test';
import { test, expect } from './lib/test';
import { provisionWizardTenant } from './lib/wizardTenant';

// Phase 30E garden designer, GARDEN_DESIGNER.md §23. No Anthropic key in e2e,
// so everything here runs the no-key path.

const PHONE = { width: 375, height: 800 };
const DESKTOP = { width: 1280, height: 900 };

function origin(page: Page): string {
  return (
    (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL ??
    'http://localhost:5173'
  );
}

async function newArea(
  page: Page,
  body: {
    name: string;
    kind: 'garden' | 'greenhouse';
    widthFt: number;
    lengthFt: number;
    details?: unknown;
  }
): Promise<string> {
  await provisionWizardTenant(page, { blocks: [], seeds: [] });
  const res = await page.request.post('/api/fields', {
    data: body,
    headers: { origin: origin(page) }
  });
  expect(res.ok(), await res.text()).toBe(true);
  const json = (await res.json()) as { field?: { id: string }; id?: string };
  return json.field?.id ?? json.id!;
}

async function openDesigner(page: Page, areaId: string, query = ''): Promise<number> {
  await page.goto(`/plan/areas/${areaId}/design${query}`);
  const root = page.getByTestId('garden-designer');
  await expect(root).toHaveAttribute('data-ready', 'true');
  return Number(await root.getAttribute('data-season-year'));
}

/** Taps the canvas at a point in the Area's feet, scrolled to mid-screen so
 *  the sticky scrubber never sits on top of it. */
async function clickFt(page: Page, x: number, y: number, widthFt: number, lengthFt: number) {
  const ground = page.getByTestId('designer-ground');
  let box = (await ground.boundingBox())!;
  const offsetY = ((y + 0.1) / lengthFt) * box.height;
  await page.evaluate(
    (dy) => window.scrollBy(0, dy),
    box.y + offsetY - page.viewportSize()!.height / 2
  );
  box = (await ground.boundingBox())!;
  await page.mouse.click(
    box.x + ((x + 0.1) / widthFt) * box.width,
    box.y + ((y + 0.1) / lengthFt) * box.height
  );
}

function bed(page: Page, name: string): Locator {
  return page.locator(`[data-testid="bed"][data-bed-name="${name}"]`);
}

async function scrubTo(page: Page, year: number, month: number, day: number) {
  await page.getByRole('slider').fill(String(Date.UTC(year, month - 1, day)));
}

async function status(page: Page): Promise<Locator> {
  return page.getByTestId('designer-status');
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function addCropToSelected(page: Page, search: string, rowName: RegExp) {
  const panel = page.getByTestId('crop-panel');
  await expect(panel).toBeVisible();
  await panel.getByLabel('Search crops').fill(search);
  await panel.getByRole('button', { name: rowName }).first().click();
}

async function setPlantingSize(page: Page, cropName: RegExp, wFt: number, lFt: number) {
  const sheet = page.getByTestId('bed-sheet').last();
  const row = sheet.getByTestId('planting-row').filter({ hasText: cropName });
  await row.getByLabel(/width in feet/).fill(String(wFt));
  await row.getByLabel(/length in feet/).fill(String(lFt));
  await row.getByRole('button', { name: 'Set size' }).click();
  return row;
}

for (const viewport of [PHONE, DESKTOP]) {
  test.describe(`household gardener at ${viewport.width}px`, () => {
    test.describe.configure({ timeout: 120_000 });
    test.use({ viewport });

    test('canvas: beds, overlap refusal, tomatoes and lettuce, and the July 15 view', async ({
      page
    }) => {
      const areaId = await newArea(page, {
        name: 'Kitchen Garden',
        kind: 'garden',
        widthFt: 20,
        lengthFt: 30
      });
      const year = await openDesigner(page, areaId, '?view=canvas');
      await expect(page.getByRole('note').filter({ hasText: 'Pick a bed size' })).toBeVisible();
      await expect(
        page.getByRole('group', { name: 'Kitchen Garden layout, 20 by 30 feet' })
      ).toBeVisible();

      await page.getByRole('button', { name: '4×8 raised' }).click();
      await clickFt(page, 2, 3, 20, 30);
      await expect(await status(page)).toHaveText(
        'Bed 1 added at 2 feet from west, 3 feet from north.'
      );
      await page.getByRole('button', { name: 'Done' }).click();
      await page.getByRole('button', { name: '4×8 raised' }).click();
      await clickFt(page, 8, 3, 20, 30);
      await expect(await status(page)).toHaveText(
        'Bed 2 added at 8 feet from west, 3 feet from north.'
      );

      await page.getByTestId('bed-toolbar').getByRole('button', { name: 'Move' }).click();
      await clickFt(page, 3, 4, 20, 30);
      await expect(page.getByTestId('designer-alert')).toHaveText("Beds can't overlap");
      await expect(bed(page, 'Bed 2')).toHaveAttribute(
        'aria-label',
        /8 feet from west, 3 feet from north/
      );

      await scrubTo(page, year, 5, 1);
      await bed(page, 'Bed 1').click();
      await page.getByTestId('bed-toolbar').getByRole('button', { name: 'Add crop' }).click();
      await addCropToSelected(page, 'Celebrity', /Tomato Celebrity F1/);
      const tomato = await setPlantingSize(page, /Tomato Celebrity/, 4, 8);
      await expect(tomato.getByTestId('plant-count')).toContainText('3 plants');
      await expect(tomato.locator('[data-provenance="data"]')).toBeVisible();

      await scrubTo(page, year, 4, 1);
      await bed(page, 'Bed 2').click();
      await page.getByTestId('bed-toolbar').getByRole('button', { name: 'Add crop' }).click();
      await addCropToSelected(page, 'Buttercrunch', /Buttercrunch/);
      const lettuce = await setPlantingSize(page, /Buttercrunch/, 4, 4);
      await expect(lettuce.getByTestId('plant-count')).toContainText('16 plants');
      await expect(lettuce.locator('[data-provenance="fallback"]')).toBeVisible();

      await scrubTo(page, year, 7, 15);
      await expect(await status(page)).toHaveText(
        'July 15. Bed 1: Tomato Celebrity F1 (AAS Winner), harvesting. Bed 2: open from July 1.'
      );
      await expect(bed(page, 'Bed 1').getByTestId('footprint')).toHaveAttribute(
        'aria-label',
        /3 plants, harvesting/
      );
      await expect(bed(page, 'Bed 2')).toHaveAttribute(
        'aria-label',
        /On July 15: open from July 1\./
      );
      await expect(bed(page, 'Bed 2').locator('.open-chip')).toHaveText(/^Open (from )?Jul 1$/);
      if (viewport.width === PHONE.width) await noHorizontalOverflow(page);
    });

    test('list view: the same beds, crops and dates without the canvas', async ({ page }) => {
      const areaId = await newArea(page, {
        name: 'Kitchen Garden',
        kind: 'garden',
        widthFt: 20,
        lengthFt: 30
      });
      const year = await openDesigner(page, areaId, '?view=list');
      const list = page.getByTestId('designer-list');
      await expect(list).toBeVisible();

      for (const [name, x] of [
        ['Bed 1', 2],
        ['Bed 2', 8]
      ] as const) {
        await list.getByRole('button', { name: 'Add bed' }).click();
        await list.getByRole('button', { name: '4×8 raised bed' }).click();
        const row = list.locator(`[data-testid="list-bed"][data-bed-name="${name}"]`);
        await expect(row).toBeVisible();
        const sheet = row.getByTestId('bed-sheet');
        await sheet.getByLabel('From west').fill(String(x));
        await sheet.getByLabel('From west').press('Tab');
        await sheet.getByLabel('From north').fill('3');
        await sheet.getByLabel('From north').press('Tab');
        await expect(row).toContainText(`${x} ft from west, 3 ft from north`);
      }

      const bed2 = list.locator('[data-testid="list-bed"][data-bed-name="Bed 2"]');
      await bed2.getByLabel('From west').fill('3');
      await bed2.getByLabel('From west').press('Tab');
      await expect(page.getByTestId('designer-alert')).toHaveText("Beds can't overlap");
      await expect(bed2).toContainText('8 ft from west, 3 ft from north');

      await scrubTo(page, year, 5, 1);
      const bed1 = list.locator('[data-testid="list-bed"][data-bed-name="Bed 1"]');
      await bed1.getByRole('button', { name: /^Bed 1/ }).click();
      await bed1.getByTestId('bed-sheet').getByRole('button', { name: 'Add crop' }).click();
      await addCropToSelected(page, 'Celebrity', /Tomato Celebrity F1/);
      await bed1.getByRole('tab', { name: 'Plantings' }).click();
      const tomato = await setPlantingSize(page, /Tomato Celebrity/, 4, 8);
      await expect(tomato.getByTestId('plant-count')).toContainText('3 plants');

      await scrubTo(page, year, 4, 1);
      await bed2.getByRole('button', { name: /^Bed 2/ }).click();
      await bed2.getByTestId('bed-sheet').getByRole('button', { name: 'Add crop' }).click();
      await addCropToSelected(page, 'Buttercrunch', /Buttercrunch/);
      await bed2.getByRole('tab', { name: 'Plantings' }).click();
      const lettuce = await setPlantingSize(page, /Buttercrunch/, 4, 4);
      await expect(lettuce.getByTestId('plant-count')).toContainText('16 plants');
      await expect(lettuce.locator('[data-provenance="fallback"]')).toBeVisible();

      await scrubTo(page, year, 7, 15);
      await expect(bed1.getByTestId('list-in-it')).toHaveText(
        'In it: Tomato Celebrity F1 (AAS Winner) (harvesting)'
      );
      await expect(bed2.getByTestId('list-open')).toHaveText('Open from Jul 1');
      if (viewport.width === PHONE.width) await noHorizontalOverflow(page);
    });
  });

  test.describe(`market farmer high tunnel at ${viewport.width}px`, () => {
    test.describe.configure({ timeout: 120_000 });
    test.use({ viewport });

    test('four long beds, Salanova counts by pattern and a succession preview', async ({
      page
    }) => {
      const areaId = await newArea(page, {
        name: 'Tunnel 1',
        kind: 'greenhouse',
        widthFt: 30,
        lengthFt: 96,
        details: { structure: 'high-tunnel' }
      });
      const year = await openDesigner(page, areaId, '?view=list');
      const list = page.getByTestId('designer-list');
      for (const [i, x] of [2, 9.5, 17, 24.5].entries()) {
        await list.getByRole('button', { name: 'Add bed' }).click();
        await list.getByRole('button', { name: 'Custom size' }).click();
        const form = page.getByRole('form', { name: 'Custom bed size' });
        await form.getByLabel('Width (ft)').fill('3');
        await form.getByLabel('Length (ft)').fill('90');
        await form.getByRole('button', { name: 'Add bed' }).click();
        const row = list.locator(`[data-testid="list-bed"][data-bed-name="Bed ${i + 1}"]`);
        await expect(row).toContainText('3×90 ft');
        const sheet = row.getByTestId('bed-sheet');
        await sheet.getByLabel('From west').fill(String(x));
        await sheet.getByLabel('From west').press('Tab');
        await sheet.getByLabel('From north').fill('3');
        await sheet.getByLabel('From north').press('Tab');
        await expect(row).toContainText(`${x} ft from west, 3 ft from north`);
      }

      const bed1 = list.locator('[data-testid="list-bed"][data-bed-name="Bed 1"]');
      await bed1.getByRole('button', { name: /^Bed 1/ }).click();
      await bed1.getByRole('spinbutton', { name: 'Length' }).fill('100');
      await bed1.getByRole('spinbutton', { name: 'Length' }).press('Tab');
      await expect(page.getByTestId('designer-alert')).toHaveText(
        "Bed 1 can't be that big in this garden."
      );
      await expect(bed1.getByRole('spinbutton', { name: 'Length' })).toHaveValue('90');

      await scrubTo(page, year, 3, 1);
      await bed1.getByTestId('bed-sheet').getByRole('button', { name: 'Add crop' }).click();
      await addCropToSelected(page, 'Salanova', /Salanova/);
      await bed1.getByRole('tab', { name: 'Plantings' }).click();
      const row = await setPlantingSize(page, /Salanova/, 3, 15);
      await expect(row.getByTestId('plant-count')).toContainText('60 plants');
      await expect(row.locator('[data-provenance="data"]')).toBeVisible();
      await row.getByLabel(/spacing pattern/).selectOption('offset');
      await expect(row.getByTestId('plant-count')).toContainText('78 plants');

      await row.getByRole('button', { name: 'Add succession' }).click();
      const succ = row.getByTestId('succession-sheet');
      await expect(succ.getByLabel('Days between sowings')).toHaveValue('14');
      await succ.getByLabel('How many more sowings').selectOption('5');
      for (const d of ['Mar 15', 'Mar 29', 'Apr 12', 'Apr 26', 'May 10']) {
        await expect(succ).toContainText(d);
      }
      await expect(succ.getByRole('button', { name: 'Add 5 sowings' })).toBeEnabled();
      await succ.getByRole('button', { name: 'Add 5 sowings' }).click();
      await expect(page.getByTestId('designer-status')).toHaveText('5 sowings added.');
      await expect(succ).toBeHidden();

      await page.getByRole('button', { name: 'Canvas', exact: true }).click();
      await expect(page.getByTestId('bed')).toHaveCount(4);
      if (viewport.width === PHONE.width) await noHorizontalOverflow(page);
    });
  });
}

test.describe('keyboard only', () => {
  test.describe.configure({ timeout: 90_000 });

  test('places, moves and turns a bed without a pointer', async ({ page }) => {
    const areaId = await newArea(page, {
      name: 'Kitchen Garden',
      kind: 'garden',
      widthFt: 20,
      lengthFt: 30
    });
    await openDesigner(page, areaId, '?view=canvas');
    const preset = page.getByRole('button', { name: '4×8 raised' });
    await preset.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(await status(page)).toHaveText(
      'Bed 1 added at 1 foot from west, 1 foot from north.'
    );

    const b1 = bed(page, 'Bed 1');
    await b1.focus();
    await expect(b1).toBeFocused();
    await expect(b1).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Enter');
    await expect(await status(page)).toHaveText(
      'Bed 1 picked up. Use arrow keys to move, Enter to drop.'
    );
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await expect(await status(page)).toHaveText(
      'Bed 1 moved to 3 feet from west, 4 feet from north.'
    );
    await page.keyboard.press('r');
    await expect(await status(page)).toHaveText('Bed 1 turned to 90 degrees.');
    await expect(b1).toHaveAttribute('aria-label', /Bed 1, 4 by 8 foot raised bed/);

    await page.reload();
    await expect(bed(page, 'Bed 1')).toHaveAttribute(
      'aria-label',
      /1 foot from west, 6 feet from north/
    );
  });

  test('carries a bed past its neighbours without losing focus', async ({ page }) => {
    const areaId = await newArea(page, {
      name: 'Kitchen Garden',
      kind: 'garden',
      widthFt: 20,
      lengthFt: 30
    });
    for (const [i, x] of [1, 6, 11, 16].entries()) {
      const res = await page.request.post('/api/blocks', {
        data: {
          name: `Bed ${i + 1}`,
          fieldId: areaId,
          kind: 'bed',
          bedStyle: 'raised',
          widthFt: 3,
          lengthFt: 8,
          xFt: x,
          yFt: 3,
          rotationDeg: 0
        },
        headers: { origin: origin(page) }
      });
      expect(res.status()).toBe(201);
    }
    await openDesigner(page, areaId, '?view=canvas');
    const b1 = bed(page, 'Bed 1');
    await expect(async () => {
      await b1.focus();
      await page.keyboard.press('Enter');
      await expect(b1).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 });
    }).toPass();
    await page.keyboard.press('Enter');
    await expect(await status(page)).toHaveText(
      'Bed 1 picked up. Use arrow keys to move, Enter to drop.'
    );
    await page.keyboard.press('Shift+ArrowDown');
    await expect(b1).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(await status(page)).toHaveText(
      'Bed 1 moved to 1.5 feet from west, 8 feet from north.'
    );
    await expect(b1).toBeFocused();
  });
});

async function inviteHelper(page: Page, browser: Browser): Promise<Page> {
  const email = `helper-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@e2e.cropcard.local`;
  const res = await page.request.post('/api/invites', {
    data: { email, role: 'helper' },
    headers: { origin: origin(page) }
  });
  expect(res.ok(), await res.text()).toBe(true);
  const { acceptUrl } = (await res.json()) as { acceptUrl: string };
  const token = acceptUrl.split('/invite/')[1];
  const ctx = await browser.newContext({ baseURL: origin(page) });
  const helper = await ctx.newPage();
  const signin = await helper.request.post('/?/signin', {
    form: { email, invite: token },
    headers: { 'x-sveltekit-action': 'true', origin: origin(page) },
    maxRedirects: 0
  });
  expect(((await signin.json()) as { location?: string }).location).toBe(`/invite/${token}`);
  const accept = await helper.request.post(`/invite/${token}?/accept`, {
    form: {},
    headers: { 'x-sveltekit-action': 'true', origin: origin(page) },
    maxRedirects: 0
  });
  expect(((await accept.json()) as { location?: string }).location).toBe('/today');
  return helper;
}

test.describe('helper', () => {
  test.describe.configure({ timeout: 90_000 });

  test('sees the designer read-only and the server refuses layout writes', async ({
    page,
    browser
  }) => {
    const areaId = await newArea(page, {
      name: 'Kitchen Garden',
      kind: 'garden',
      widthFt: 20,
      lengthFt: 30
    });
    const created = await page.request.post('/api/blocks', {
      data: {
        name: 'Bed 1',
        fieldId: areaId,
        kind: 'bed',
        bedStyle: 'raised',
        widthFt: 4,
        lengthFt: 8,
        xFt: 2,
        yFt: 3,
        rotationDeg: 0
      },
      headers: { origin: origin(page) }
    });
    expect(created.status()).toBe(201);
    const { block } = (await created.json()) as { block: { id: string } };

    const helper = await inviteHelper(page, browser);
    for (const view of ['canvas', 'list'] as const) {
      await helper.goto(`/plan/areas/${areaId}/design?view=${view}`);
      await expect(helper.getByTestId('readonly-banner')).toHaveText(
        'View only. The farm owner changes the layout.'
      );
      await expect(helper.getByTestId('preset-bar')).toHaveCount(0);
      await expect(helper.getByRole('button', { name: 'Add bed' })).toHaveCount(0);
      await expect(helper.getByRole('slider')).toBeVisible();
    }
    await helper.getByRole('button', { name: /^Bed 1/ }).click();
    await expect(helper.getByTestId('bed-sheet').getByLabel('Name')).toBeDisabled();
    await expect(helper.getByRole('button', { name: 'Delete' })).toHaveCount(0);

    const patch = await helper.request.patch(`/api/blocks/${block.id}`, {
      data: { xFt: 10 },
      headers: { origin: origin(page) }
    });
    expect(patch.status()).toBe(403);
    const del = await helper.request.delete(`/api/blocks/${block.id}?ifEmpty=1`, {
      headers: { origin: origin(page) }
    });
    expect(del.status()).toBe(403);
    await helper.context().close();
  });
});

test('a field is not designable', async ({ page }) => {
  await provisionWizardTenant(page, { blocks: [], seeds: [] });
  const res = await page.request.post('/api/fields', {
    data: { name: 'Back Forty', kind: 'field', widthFt: 400, lengthFt: 300 },
    headers: { origin: origin(page) }
  });
  const json = (await res.json()) as { field?: { id: string }; id?: string };
  const id = json.field?.id ?? json.id!;
  const resp = await page.goto(`/plan/areas/${id}/design`);
  expect(resp?.status()).toBe(404);
});
