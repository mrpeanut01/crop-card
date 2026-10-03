/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import EditConflictChoice from './EditConflictChoice.svelte';
import type { EditConflictBody } from '$lib/edits/conflict';

const page = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock('$app/state', () => ({ page }));

afterEach(() => {
  page.data = {};
});

const conflict: EditConflictBody = {
  error: 'Someone else changed this while you were editing. Nothing was saved.',
  code: 'EDIT_CONFLICT',
  target: 'planting',
  id: 'crop_1',
  action: 'set-schedule',
  fields: [
    {
      field: 'plantingDate',
      base: Date.UTC(2026, 3, 1),
      mine: Date.UTC(2026, 3, 10),
      theirs: Date.UTC(2026, 3, 20)
    },
    { field: 'blockId', base: 'blk_0', mine: 'blk_1', theirs: 'blk_2' }
  ],
  current: { plantingDate: Date.UTC(2026, 3, 20), blockId: 'blk_2' }
};

describe('EditConflictChoice (U-05, U-06)', () => {
  it('shows both values in plain words with block names', () => {
    render(EditConflictChoice, {
      conflict,
      label: 'Cherokee Purple',
      names: { blockNames: { blk_1: 'Bed 1', blk_2: 'Bed 2' } },
      onResolve: vi.fn()
    });
    expect(screen.getByText('Your change to Cherokee Purple was not saved')).toBeTruthy();
    expect(
      screen.getByText('Someone else changed this planting after your phone last saw it.')
    ).toBeTruthy();
    expect(screen.getByText('Planting date')).toBeTruthy();
    expect(screen.getByText('Bed or block')).toBeTruthy();
    expect(screen.getByText('Bed 1')).toBeTruthy();
    expect(screen.getByText('Bed 2')).toBeTruthy();
    expect(screen.getAllByText('Yours')).toHaveLength(2);
    expect(screen.getAllByText('Now on the farm')).toHaveLength(2);
  });

  it('Keep mine and Keep theirs resolve straight away', async () => {
    const onResolve = vi.fn();
    render(EditConflictChoice, { conflict, label: 'x', onResolve });
    await fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Keep theirs' }));
    expect(onResolve.mock.calls).toEqual([['mine'], ['theirs']]);
  });

  it('Choose for each needs a pick for every field before Save', async () => {
    const onResolve = vi.fn();
    const { container } = render(EditConflictChoice, { conflict, label: 'x', onResolve });
    await fireEvent.click(screen.getByRole('button', { name: 'Choose for each' }));
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    const radios = container.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    expect(radios).toHaveLength(4);
    await fireEvent.click(radios[1]);
    expect(save.disabled).toBe(true);
    await fireEvent.click(radios[2]);
    expect(save.disabled).toBe(false);
    await fireEvent.click(save);
    expect(onResolve).toHaveBeenCalledWith({
      merge: { plantingDate: 'theirs', blockId: 'mine' }
    });
  });

  it('speaks Spanish', () => {
    page.data = { locale: 'es' };
    render(EditConflictChoice, {
      conflict: {
        ...conflict,
        target: 'task',
        fields: [{ field: 'title', base: 'a', mine: 'b', theirs: 'c' }]
      },
      label: 'Estacar',
      onResolve: vi.fn()
    });
    expect(screen.getByText('Tu cambio en Estacar no se guardó')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Quedarme con lo mío' })).toBeTruthy();
    expect(screen.getByText('Título')).toBeTruthy();
  });
});
