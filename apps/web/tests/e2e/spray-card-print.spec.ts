import { expect, test } from './lib/test';

// #581: a printed Spray Card never fades or clips. Every shipped spray
// product, with every decon protocol in play, prints as numbered cards on
// 4x6, 3x5 and Letter 4-up, and no text or QR on any card ends outside it.
// The device sweep (playwright.devices.config.ts) runs this in WebKit and
// Firefox too.

const LAYOUTS = ['index-4x6', 'index-3x5', 'letter-4up'] as const;
const LAST_LOADS = ['', 'photosystem-i-diquat', 'glufosinate', 'fungicide-load', 'synthetic-auxin'];

for (const layout of LAYOUTS) {
  test(`every Spray Card prints whole on ${layout}`, async ({ page }) => {
    test.setTimeout(240_000);
    for (const last of LAST_LOADS) {
      await page.goto(`/_dev/spray-print?layout=${layout}&last=${last}`);
      await page.emulateMedia({ media: 'print' });
      await page.evaluate(() => document.fonts.ready);
      const result = await page.evaluate(() => {
        const cells = [...document.querySelectorAll<HTMLElement>('.print-cell')];
        const clipped: string[] = [];
        const sets = new Map<string, string[]>();
        for (const cell of cells) {
          const body = cell.querySelector<HTMLElement>('.body')!;
          const box = body.getBoundingClientRect();
          const title = cell.querySelector('h3')?.textContent ?? '';
          const part = cell.querySelector('[data-print-part]')?.getAttribute('data-print-part');
          const key = cell.querySelector('article')?.getAttribute('data-card-key') ?? title;
          sets.set(key, [...(sets.get(key) ?? []), part ?? 'none']);
          for (const el of body.querySelectorAll<HTMLElement | SVGElement>('*')) {
            const own = [...el.childNodes].some(
              (n) => n.nodeType === 3 && (n.textContent ?? '').trim()
            );
            if (!own && el.tagName !== 'svg') continue;
            const r = el.getBoundingClientRect();
            if (r.height === 0) continue;
            if (r.bottom > box.bottom + 0.5 || r.right > box.right + 0.5)
              clipped.push(`${title} ${part}: ${(el.textContent ?? '').trim().slice(0, 40)}`);
          }
        }
        const badSets = [...sets.entries()]
          .filter(([, parts]) => {
            const of = parts.length;
            return parts.some((p, i) => p !== `${i + 1}/${of}`);
          })
          .map(([k]) => k);
        return {
          cells: cells.length,
          cards: sets.size,
          clipped,
          badSets,
          faded: document.querySelectorAll('.card-print-sheet .more').length
        };
      });
      expect(result.cards, `${layout} ${last}`).toBeGreaterThan(100);
      expect(result.clipped, `${layout} ${last}`).toEqual([]);
      expect(result.badSets, `${layout} ${last}`).toEqual([]);
      expect(result.faded, `${layout} ${last}`).toBe(0);
    }
  });
}
