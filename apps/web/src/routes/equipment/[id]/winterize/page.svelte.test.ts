/**
 * @vitest-environment jsdom
 *
 * Winterizing is owner only at the API; a helper walking the wizard is told
 * so up front and the final confirm stays off instead of failing with 403.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn() }));

import Page from './+page.svelte';

function data(canWinterize: boolean) {
  return {
    locale: 'en',
    equipment: { id: 's1', label: 'Boom sprayer', type: 'sprayer' },
    sprayer: { id: 's1', lastChemistryClass: null },
    protocol: {
      id: 'generic-ammonia',
      label: 'Ammonia decon',
      strict: false,
      steps: ['Drain.'],
      rationale: ''
    },
    canWinterize
  };
}

async function walkToLastStep(): Promise<HTMLElement> {
  for (let i = 0; i < 5; i++) {
    await fireEvent.click(screen.getByRole('button', { name: /next/i }));
  }
  return screen.getAllByRole('button').find((b) => b.classList.contains('primary'))!;
}

describe('/equipment/[id]/winterize', () => {
  it('tells a helper to ask the owner and keeps the final confirm off', async () => {
    render(Page, { props: { data: data(false) } as never });
    expect(screen.getByTestId('winterize-owner-only')).toBeTruthy();
    expect(await walkToLastStep()).toBeDisabled();
  });

  it('lets the owner confirm', async () => {
    render(Page, { props: { data: data(true) } as never });
    expect(screen.queryByTestId('winterize-owner-only')).toBeNull();
    expect(await walkToLastStep()).not.toBeDisabled();
  });
});
