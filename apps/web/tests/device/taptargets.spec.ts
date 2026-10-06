import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from '../e2e/lib/test';

// Device sweep (#572): every visible tap target on the field screens at
// 375 px, measured against the 48 dp rule. Inline links inside running text
// are listed apart (WCAG 2.5.8 exempts them).
const OUT = process.env.PRINT_OUT ?? '/tmp/cropcard-print';
const ROUTES = [
  '/today',
  '/spray',
  '/spray/insecticide',
  '/spray/fungicide',
  '/scout',
  '/harvest',
  '/hay',
  '/fertility',
  '/cards',
  '/animals',
  '/inventory',
  '/equipment',
  '/records',
  '/plan',
  '/calibrate'
];

test.use({ viewport: { width: 375, height: 812 } });

test('tap targets on field screens', async ({ page }, info) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await page.getByTestId('demo-start').click();
  await page.waitForURL('**/today');
  mkdirSync(OUT, { recursive: true });
  const report: Record<string, unknown> = {};
  for (const route of ROUTES) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    report[route] = await page.evaluate(() => {
      const sel =
        'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link]';
      const small: string[] = [];
      const inline: string[] = [];
      let total = 0;
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        if (el.closest('[aria-hidden=true], .visually-hidden, .sr-only, .skip-link')) continue;
        if (el.closest('[popover]:not(:popover-open)')) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
        if (el instanceof HTMLInputElement && ['checkbox', 'radio', 'file'].includes(el.type)) {
          const lab =
            el.closest('label') ?? (el.id && document.querySelector(`label[for="${el.id}"]`));
          if (lab && (lab as HTMLElement).getBoundingClientRect().height >= 48) continue;
        }
        total++;
        if (Math.round(r.height) >= 48 && Math.round(r.width) >= 48) continue;
        const name = (
          el.getAttribute('aria-label') ??
          el.textContent ??
          el.getAttribute('name') ??
          ''
        )
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 40);
        const ctx = el.parentElement?.closest('[class]')?.className.toString().split(' ')[0] ?? '';
        const desc = `${ctx} > ${el.tagName.toLowerCase()}${el.getAttribute('type') ? '[' + el.getAttribute('type') + ']' : ''} "${name}" ${Math.round(r.width)}x${Math.round(r.height)}`;
        const parent = el.parentElement;
        const inText =
          el.tagName === 'A' &&
          cs.display === 'inline' &&
          !!parent &&
          ['P', 'LI', 'SPAN', 'SMALL', 'DD', 'TD'].includes(parent.tagName) &&
          (parent.textContent ?? '').trim().length > (el.textContent ?? '').trim().length + 10;
        (inText ? inline : small).push(desc);
      }
      return { total, small, inline };
    });
  }
  writeFileSync(`${OUT}/${info.project.name}-taptargets.json`, JSON.stringify(report, null, 2));
  console.log('RESULT ' + JSON.stringify(report));
});
