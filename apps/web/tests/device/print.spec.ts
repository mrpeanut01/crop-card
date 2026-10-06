import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from '../e2e/lib/test';

// Device sweep (#572): print the cards people print, in print media, and look
// for content cut off by a sheet page or print cell (both are overflow:hidden).
const OUT = process.env.PRINT_OUT ?? '/tmp/cropcard-print';

type Clip = { page: number; tag: string; text: string; overBy: number };

async function clipped(page: Page): Promise<{ pages: number; clips: Clip[] }> {
  return page.evaluate(() => {
    const sheets = [...document.querySelectorAll('.card-print-sheet .sheet-page')];
    const clips: { page: number; tag: string; text: string; overBy: number }[] = [];
    sheets.forEach((sheet, i) => {
      const boxes = [sheet, ...sheet.querySelectorAll('.print-cell')];
      for (const box of boxes) {
        const r = box.getBoundingClientRect();
        for (const el of box.querySelectorAll('*')) {
          const e = el as HTMLElement;
          if (!e.offsetParent && e.tagName !== 'svg') continue;
          const own = [...e.childNodes].some(
            (n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 0
          );
          const media = ['IMG', 'svg', 'CANVAS'].includes(e.tagName);
          if (!own && !media) continue;
          const b = e.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) continue;
          const over = Math.max(b.bottom - r.bottom, b.right - r.right, r.left - b.left);
          if (over > 1.5) {
            clips.push({
              page: i + 1,
              tag: e.tagName.toLowerCase(),
              text: (e.textContent ?? '').trim().slice(0, 60),
              overBy: Math.round(over)
            });
          }
        }
      }
    });
    const seen = new Set<string>();
    return {
      pages: sheets.length,
      clips: clips.filter((c) => {
        const k = `${c.page}|${c.text}|${c.tag}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
    };
  });
}

function ymd(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(ms));
}

test('printed cards fit their paper', async ({ page, browserName }, info) => {
  test.setTimeout(300_000);
  mkdirSync(OUT, { recursive: true });
  await page.goto('/');
  await page.getByTestId('demo-start').click();
  await page.waitForURL('**/today');

  await page.goto('/cards');
  await page.getByRole('button', { name: 'Save for offline' }).click();
  await expect(page.getByText('Saved. These cards now open on this device')).toBeVisible();
  const hrefOf = async (kind: string, filter: string) => {
    await page.getByRole('button', { name: filter, exact: true }).click();
    const links = page.locator(`[data-card-kind="${kind}"] h3 a`);
    await expect(links.first()).toBeVisible();
    return links.evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).getAttribute('href')!)
    );
  };
  const spray = (await hrefOf('spray', 'Spray'))[0];
  const areas = await hrefOf('area', 'Areas');

  const now = Date.now();
  const targets: { name: string; url: string; layouts: (string | null)[] }[] = [
    { name: 'spray', url: spray, layouts: ['index-4x6', 'index-3x5', 'letter-4up'] },
    { name: 'week', url: `/cards/week/wk_${ymd(now)}`, layouts: [null] },
    { name: 'month', url: `/cards/month/mo_${ymd(now).slice(0, 7)}`, layouts: [null] },
    { name: 'farm-map', url: '/plan/farm-map', layouts: [null] },
    ...areas.map((url, i) => ({ name: `area-${i + 1}`, url, layouts: [null] }))
  ];

  const report: Record<string, unknown> = { project: info.project.name };
  for (const t of targets) {
    for (const layout of t.layouts) {
      const label = `${t.name}${layout ? '-' + layout : ''}`;
      await page.emulateMedia({ media: 'screen' });
      await page.goto(t.url);
      await page.waitForLoadState('networkidle');
      if (layout) await page.locator(`input[name="layout"][value="${layout}"]`).check();
      await page.emulateMedia({ media: 'print' });
      await page.evaluate(() => document.fonts.ready);
      const result = await clipped(page);
      const entry: Record<string, unknown> = { ...result };
      await page.screenshot({
        path: `${OUT}/${info.project.name}-${label}.png`,
        fullPage: true
      });
      if (browserName === 'chromium') {
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        writeFileSync(`${OUT}/${label}.pdf`, pdf);
        const s = pdf.toString('latin1');
        entry.pdfPages = (s.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
        const box = /\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/.exec(s);
        entry.pdfMediaBoxIn = box
          ? `${(+box[1] / 72).toFixed(2)}x${(+box[2] / 72).toFixed(2)}`
          : null;
      }
      report[label] = entry;
    }
  }
  writeFileSync(`${OUT}/${info.project.name}-report.json`, JSON.stringify(report, null, 2));
  console.log('RESULT ' + JSON.stringify(report));
});
