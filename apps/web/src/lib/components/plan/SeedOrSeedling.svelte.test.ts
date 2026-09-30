/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import SeedOrSeedling from './SeedOrSeedling.svelte';

describe('SeedOrSeedling sow date', () => {
  it('caps the sow date before the in-ground date and warns when it is after', async () => {
    render(SeedOrSeedling, {
      plugin: { plantingGuide: {}, cropFamily: null } as never,
      dated: true,
      inGroundOn: '2027-05-10'
    });
    const seedling = screen.getByRole('button', { name: 'Seedling' });
    if (seedling.getAttribute('aria-pressed') !== 'true') await fireEvent.click(seedling);
    const input = screen.getByLabelText('Sow indoors on') as HTMLInputElement;
    expect(input.max).toBe('2027-05-09');
    expect(screen.queryByTestId('sow-after-transplant')).toBeNull();
    await fireEvent.input(input, { target: { value: '2027-05-20' } });
    expect(screen.getByTestId('sow-after-transplant').textContent).toContain(
      'on or after the transplant date'
    );
    await fireEvent.input(input, { target: { value: '2027-04-01' } });
    expect(screen.queryByTestId('sow-after-transplant')).toBeNull();
  });
});
