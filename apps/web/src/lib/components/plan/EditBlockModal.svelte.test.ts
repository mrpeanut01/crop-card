/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import EditBlockModal from './EditBlockModal.svelte';

const page = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock('$app/state', () => ({ page }));

afterEach(() => {
  vi.unstubAllGlobals();
});

const base = {
  open: true,
  legacyEditorHref: '/plan/farm',
  onClose: vi.fn(),
  onSaved: vi.fn(),
  canEditCovers: false
};

describe('EditBlockModal', () => {
  it('keeps what was typed when the parent hands a fresh copy of the same block', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      })
    );
    const { rerender } = render(EditBlockModal, {
      props: { ...base, block: { id: 'b1', name: 'North bed' } }
    });
    await fireEvent.input(document.getElementById('edit-block-name')!, {
      target: { value: 'North bed renamed' }
    });
    await rerender({ ...base, block: { id: 'b1', name: 'North bed' } });
    expect((screen.getByDisplayValue('North bed renamed') as HTMLInputElement).id).toBe(
      'edit-block-name'
    );
  });

  it('seeds again for another block or after closing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      })
    );
    const { rerender } = render(EditBlockModal, {
      props: { ...base, block: { id: 'b1', name: 'North bed' } }
    });
    await fireEvent.input(document.getElementById('edit-block-name')!, {
      target: { value: 'typed' }
    });
    await rerender({ ...base, block: { id: 'b2', name: 'South bed' } });
    expect((document.getElementById('edit-block-name') as HTMLInputElement).value).toBe(
      'South bed'
    );
    await rerender({ ...base, open: false, block: { id: 'b2', name: 'South bed' } });
    await rerender({ ...base, open: true, block: { id: 'b2', name: 'South bed' } });
    expect((document.getElementById('edit-block-name') as HTMLInputElement).value).toBe(
      'South bed'
    );
  });
});
