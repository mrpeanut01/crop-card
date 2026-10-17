/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(async () => {}) }));

import WatererEditor from './WatererEditor.svelte';

const areas = [{ id: 'f1', name: 'Herb garden', beds: [{ id: 'b1', name: 'Bed 1' }] }];
const schedule = {
  days: [1, 3, 5],
  start: '06:00',
  minutes: 20,
  method: 'drip' as const,
  inchesPerRun: null,
  gallonsPerMinute: null,
  activeFrom: 0
};

afterEach(() => vi.unstubAllGlobals());

describe('WatererEditor', () => {
  it('shows the schedule and pushes for inches per run', () => {
    render(WatererEditor, {
      equipmentId: 'eq-1',
      schedule,
      defaultMethod: 'drip',
      targets: [{ fieldId: 'f1', blockId: null }],
      areas,
      canEdit: false
    });
    expect(screen.getByTestId('waterer-summary').textContent).toContain(
      'Mon, Wed, Fri 6:00 for 20 min'
    );
    expect(screen.getByText('Inches per run not set')).toBeTruthy();
    expect(screen.getByTestId('waterer-targets').textContent).toContain('All of Herb garden');
    expect(screen.getByText('Ask the owner to change the schedule.')).toBeTruthy();
    expect(screen.queryByTestId('waterer-edit')).toBeNull();
  });

  it('saves a schedule with the typed inches, and the targets', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, method: init.method ?? 'GET', body: JSON.parse(String(init.body)) });
        return new Response('{}', { status: 200 });
      })
    );
    render(WatererEditor, {
      equipmentId: 'eq-1',
      schedule: null,
      defaultMethod: 'soaker',
      targets: [],
      areas,
      canEdit: true
    });
    await fireEvent.click(screen.getByTestId('waterer-edit'));
    await fireEvent.click(screen.getByRole('button', { name: 'Monday' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Tuesday' }));
    await fireEvent.input(screen.getByTestId('waterer-inches'), { target: { value: '0.4' } });
    await fireEvent.click(screen.getByTestId('waterer-save'));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      url: '/api/equipment/eq-1',
      method: 'PATCH',
      body: {
        spec: {
          schedule: {
            days: [2, 3, 5],
            start: '06:00',
            minutes: 20,
            method: 'soaker',
            inchesPerRun: 0.4,
            gallonsPerMinute: null
          }
        }
      }
    });
    await fireEvent.click(screen.getByLabelText('Bed 1'));
    await fireEvent.click(screen.getByTestId('waterer-targets-save'));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toEqual({
      url: '/api/equipment/eq-1/water-targets',
      method: 'PUT',
      body: { areaIds: [], blockIds: ['b1'] }
    });
  });

  it('refuses a schedule with no day', async () => {
    render(WatererEditor, {
      equipmentId: 'eq-1',
      schedule: null,
      defaultMethod: 'drip',
      targets: [],
      areas,
      canEdit: true
    });
    await fireEvent.click(screen.getByTestId('waterer-edit'));
    for (const day of ['Monday', 'Wednesday', 'Friday']) {
      await fireEvent.click(screen.getByRole('button', { name: day }));
    }
    await fireEvent.click(screen.getByTestId('waterer-save'));
    expect(screen.getByRole('alert').textContent).toBe('Pick at least one day.');
  });
});
