/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import UnitInput from './UnitInput.svelte';

const page = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock('$app/state', () => ({ page }));

afterEach(() => {
  page.data = {};
});

function inputs(container: HTMLElement) {
  return {
    shown: container.querySelector('input[type="number"]') as HTMLInputElement,
    hidden: container.querySelector('input[type="hidden"]') as HTMLInputElement
  };
}

describe('UnitInput', () => {
  it('renders with no value (undefined) without throwing', () => {
    const { container } = render(UnitInput, { quantity: 'distance', name: 'widthFt' });
    const { shown, hidden } = inputs(container);
    expect(shown.value).toBe('');
    expect(hidden.value).toBe('');
  });

  it('shows metric and submits the stored US value', async () => {
    page.data = { prefs: { timeZone: 'UTC', units: 'metric' } };
    const { container } = render(UnitInput, { quantity: 'area', name: 'acres', value: 10 });
    const { shown, hidden } = inputs(container);
    expect(Number(shown.value)).toBeCloseTo(4.0469, 3);
    await fireEvent.input(shown, { target: { value: '2' } });
    expect(Number(hidden.value)).toBeCloseTo(4.9421, 3);
    expect(container.textContent).toContain('ha');
  });

  it('passes US values straight through', async () => {
    const { container } = render(UnitInput, { quantity: 'area', name: 'acres', value: 10 });
    const { shown, hidden } = inputs(container);
    expect(shown.value).toBe('10');
    await fireEvent.input(shown, { target: { value: '12.5' } });
    expect(hidden.value).toBe('12.5');
  });
});
