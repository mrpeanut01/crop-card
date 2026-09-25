/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn() }));

import PlanningYearPicker from './PlanningYearPicker.svelte';
import type { PlanningYearView } from '$lib/season/planningYear';

const view: PlanningYearView = {
  activeYear: 2027,
  suggestedYear: 2027,
  suggestionReason: 'The 2026 planting window has mostly closed.',
  options: [2026, 2027],
  pastYears: [2025, 2024],
  chosen: false
};

describe('PlanningYearPicker', () => {
  it('offers this year and next, checks the active one, and tags the suggestion', () => {
    const { getByLabelText, getByText } = render(PlanningYearPicker, { view });
    expect((getByLabelText(/2027/) as HTMLInputElement).checked).toBe(true);
    expect((getByLabelText(/2026/) as HTMLInputElement).checked).toBe(false);
    expect(getByText('Suggested').closest('label')?.textContent).toContain('2027');
  });

  it('links past seasons as view-only', () => {
    const { getByRole } = render(PlanningYearPicker, { view });
    expect(getByRole('link', { name: '2025' }).getAttribute('href')).toBe(
      '/settings/season?year=2025'
    );
  });

  it('uses the given field name in form mode', () => {
    const { container } = render(PlanningYearPicker, { view, name: 'planningYear' });
    const radios = container.querySelectorAll('input[name="planningYear"]');
    expect(radios).toHaveLength(2);
  });
});
