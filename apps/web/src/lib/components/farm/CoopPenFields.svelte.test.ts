/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import CoopPenFields from './CoopPenFields.svelte';
import { COOP_CONTEXT_KEY, type CoopContext } from '$lib/farm/coopContext';

const ctx: CoopContext = {
  options: [
    {
      id: 'chicken',
      name: 'Chicken',
      plural: 'chickens',
      indoorSqFt: 3.5,
      outdoorSqFt: 10,
      sourceName: 'eXtension Small and Backyard Poultry'
    },
    {
      id: 'dog',
      name: 'Dog',
      plural: 'dogs',
      indoorSqFt: null,
      outdoorSqFt: null,
      sourceName: null
    }
  ],
  farmDefault: 'chicken',
  housedByArea: { coop2: ['dog'] }
};

function mount(props: Record<string, unknown>) {
  return render(CoopPenFields, {
    props: { draft: {}, idPrefix: 't', ...props },
    context: new Map([[COOP_CONTEXT_KEY, () => ctx]])
  });
}

describe('CoopPenFields (#477)', () => {
  it('prefills the species, suggests a number with its source and lets the owner override', async () => {
    mount({ areaSqFt: 40 });
    const species = screen.getByLabelText('Animal type') as HTMLSelectElement;
    expect(species.value).toBe('chicken');
    await fireEvent.change(screen.getByLabelText('Is it indoors, a run, or both?'), {
      target: { value: 'indoor' }
    });
    const cap = screen.getByLabelText('Holds up to') as HTMLInputElement;
    expect(cap.value).toBe('11');
    expect(screen.getByTestId('coop-suggestion').textContent).toContain(
      'eXtension Small and Backyard Poultry'
    );
    await fireEvent.input(cap, { target: { value: '8' } });
    expect(cap.value).toBe('8');
    await fireEvent.click(screen.getByRole('button', { name: 'Use 11 instead' }));
    expect(cap.value).toBe('11');
  });

  it('groups thousands in a large suggestion (review)', async () => {
    mount({ areaSqFt: 236480 });
    await fireEvent.change(screen.getByLabelText('Is it indoors, a run, or both?'), {
      target: { value: 'indoor' }
    });
    const text = screen.getByTestId('coop-suggestion').textContent ?? '';
    expect(text).toContain('67,565');
    expect(text).toContain('236,480 sq ft');
    expect(text).not.toMatch(/67565/);
  });

  it('starts on who already lives there and gives no number without a source', async () => {
    mount({ areaSqFt: 400, areaId: 'coop2' });
    expect((screen.getByLabelText('Animal type') as HTMLSelectElement).value).toBe('dog');
    await fireEvent.change(screen.getByLabelText('Is it indoors, a run, or both?'), {
      target: { value: 'indoor' }
    });
    expect(screen.getByTestId('coop-suggestion').textContent).toMatch(/no sourced space figure/);
    expect((screen.getByLabelText('Holds up to') as HTMLInputElement).value).toBe('');
  });

  it('asks for shelter and run sizes when the pen has both', async () => {
    mount({ areaSqFt: null });
    await fireEvent.change(screen.getByLabelText('Is it indoors, a run, or both?'), {
      target: { value: 'both' }
    });
    await fireEvent.input(screen.getByLabelText('Shelter floor'), { target: { value: '35' } });
    await fireEvent.input(screen.getByLabelText('Run'), { target: { value: '60' } });
    expect((screen.getByLabelText('Holds up to') as HTMLInputElement).value).toBe('6');
  });

  it('falls back to a plain number when no species list is loaded', () => {
    render(CoopPenFields, { props: { draft: {}, idPrefix: 'x' } });
    expect(screen.queryByLabelText('Animal type')).toBeNull();
    expect(screen.getByLabelText('Holds up to')).toBeTruthy();
  });
});
