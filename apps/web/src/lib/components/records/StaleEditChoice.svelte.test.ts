/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import StaleEditChoice from './StaleEditChoice.svelte';
import type { EditConflictBody } from '$lib/edits/conflict';

const page = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock('$app/state', () => ({ page }));

afterEach(() => {
  page.data = {};
});

const conflict: EditConflictBody = {
  error: 'Someone else changed this while you were editing. Nothing was saved.',
  code: 'EDIT_CONFLICT',
  target: 'stock',
  id: 's1',
  action: 'set-quantity',
  fields: [{ field: 'onHand', base: 10, mine: 7, theirs: 4 }],
  current: { onHand: 4 }
};

describe('StaleEditChoice', () => {
  it('says what is on the farm now and offers keep or reload', async () => {
    const onKeepMine = vi.fn();
    const onReload = vi.fn();
    render(StaleEditChoice, { conflict, onKeepMine, onReload });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Changed on another device')).toBeTruthy();
    expect(screen.getByText('On hand')).toBeTruthy();
    expect(screen.getByText(/Now on the farm: 4/)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Keep my change' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onKeepMine).toHaveBeenCalledOnce();
    expect(onReload).toHaveBeenCalledOnce();
  });

  it('follows the locale', () => {
    page.data = { locale: 'es' };
    render(StaleEditChoice, {
      conflict: {
        ...conflict,
        target: 'planting',
        action: 'mark-harvested',
        fields: [{ field: 'status', base: 'active', mine: 'harvested', theirs: 'failed' }],
        current: { status: 'failed' }
      },
      onKeepMine: vi.fn(),
      onReload: vi.fn()
    });
    expect(screen.getByText('Cambió en otro dispositivo')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Guardar mi cambio' })).toBeTruthy();
    expect(screen.getByText('Estado')).toBeTruthy();
  });
});
