/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import AddTaskModal from './AddTaskModal.svelte';

beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const PLANTINGS = [
  { id: 'p1', label: 'Bloody Butcher' },
  { id: 'p2', label: 'Cherokee Trail of Tears' }
];

describe('AddTaskModal (#122)', () => {
  it('POSTs a primary task for the block + preselected planting', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ task: { id: 'task-1' } })
    });
    vi.stubGlobal('fetch', fetchMock);
    const onCreated = vi.fn();
    render(AddTaskModal, {
      open: true,
      blockId: 'b1',
      blockName: 'Block A',
      plantings: PLANTINGS,
      defaultPlantingId: 'p2',
      onClose: vi.fn(),
      onCreated
    });
    await fireEvent.input(screen.getByLabelText(/Task/), { target: { value: 'Side-dress N' } });
    await fireEvent.input(screen.getByLabelText(/Date/), { target: { value: '2026-06-03' } });
    await fireEvent.submit(screen.getByRole('button', { name: 'Add task' }).closest('form')!);

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('task-1'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/tasks');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      title: 'Side-dress N',
      kind: 'primary',
      blockId: 'b1',
      cropId: 'p2',
      scheduledFor: Date.parse('2026-06-03T00:00:00')
    });
  });

  it('Cancel closes without writing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const onClose = vi.fn();
    render(AddTaskModal, {
      open: true,
      blockId: 'b1',
      blockName: 'Block A',
      onClose,
      onCreated: vi.fn()
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces server errors and keeps the form open', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'nope' }) })
    );
    const onCreated = vi.fn();
    render(AddTaskModal, {
      open: true,
      blockId: 'b1',
      blockName: 'Block A',
      onClose: vi.fn(),
      onCreated
    });
    await fireEvent.input(screen.getByLabelText(/Task/), { target: { value: 'Mow' } });
    await fireEvent.submit(screen.getByRole('button', { name: 'Add task' }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('nope');
    expect(onCreated).not.toHaveBeenCalled();
  });
});
