/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import YearAnimalSection from './YearAnimalSection.svelte';
import type { YearAnimalSection as Section } from '$lib/records/yearSummaryAnimals';

const page = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock('$app/state', () => ({ page }));

afterEach(() => {
  page.data = {};
});

const AT = Date.parse('2026-06-01T12:00:00Z');

function section(): Section {
  return {
    speciesNames: { chicken: 'Chicken' },
    headCounts: [],
    movements: [],
    treatments: [],
    production: [],
    covered: [
      {
        atMs: AT,
        subject: 'Hens',
        what: 'eggs',
        use: 'For the table',
        useCode: 'food',
        basis: 'known',
        basisText: 'Inside a hold'
      },
      {
        atMs: AT + 1,
        subject: 'Nanny',
        what: 'milk',
        use: 'For sale',
        useCode: 'sale',
        basis: 'known',
        basisText: 'Inside a hold'
      },
      {
        atMs: AT + 2,
        subject: 'Billy',
        what: 'meat',
        use: 'Slaughtered',
        useCode: 'slaughtered',
        basis: 'known',
        basisText: 'Inside a hold'
      }
    ]
  };
}

function coveredCells(container: HTMLElement): string[] {
  const tables = [...container.querySelectorAll('table')];
  const table = tables[tables.length - 1];
  return [...table.querySelectorAll('tbody tr')].map(
    (tr) => tr.querySelectorAll('td')[2].textContent?.trim() ?? ''
  );
}

describe('YearAnimalSection covered rows', () => {
  it('translates the use in Spanish instead of showing the English label', () => {
    page.data = { locale: 'es' };
    const { container } = render(YearAnimalSection, {
      props: { section: section(), year: 2026, canExportLog: false }
    });
    const cells = coveredCells(container);
    expect(cells).toEqual(['Huevos, para la mesa', 'Leche, para la venta', 'Carne, sacrificados']);
    for (const c of cells) expect(c).not.toMatch(/for the table|for sale|slaughtered/i);
  });

  it('keeps English wording without a locale', () => {
    const { container } = render(YearAnimalSection, {
      props: { section: section(), year: 2026, canExportLog: false }
    });
    const cells = coveredCells(container);
    expect(cells[0].toLowerCase()).toContain('for the table');
    expect(cells[2].toLowerCase()).toContain('slaughtered');
  });
});
