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
            gallonsPerMinute: null,
            runningSince: null
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

  // #870 (FU870-1, FU870-2, FU870-4).
  const twoBeds = [
    {
      id: 'f1',
      name: 'Herb garden',
      beds: [
        { id: 'b1', name: 'Bed 1' },
        { id: 'b2', name: 'Bed 2' }
      ]
    }
  ];
  const gpm = { ...schedule, gallonsPerMinute: 2 };

  it('shows the size split tagged as an app estimate, and why a split is not known', async () => {
    const view = render(WatererEditor, {
      equipmentId: 'eq-1',
      schedule: gpm,
      defaultMethod: 'drip',
      targets: [
        { fieldId: 'f1', blockId: 'b1', sharePct: null, splitPct: 67 },
        { fieldId: 'f1', blockId: 'b2', sharePct: null, splitPct: 33 }
      ],
      areas: twoBeds,
      canEdit: false,
      split: { known: true, source: 'size' }
    });
    const split = screen.getByTestId('waterer-split');
    expect(split.textContent).toContain('Herb garden · Bed 1: 67% of the gallons, by size');
    expect(split.querySelector('[data-provenance="fallback"]')).toBeTruthy();
    await view.rerender({ split: { known: false, reason: 'no-size' } });
    expect(screen.getByTestId('waterer-split-unknown').textContent).toContain(
      'an Area or bed here has no size'
    );
    await view.rerender({ schedule: { ...gpm, inchesPerRun: 0.3 } });
    expect(screen.queryByTestId('waterer-split-unknown')).toBeNull();
    expect(screen.getByText(/Inches per run is set/)).toBeTruthy();
  });

  it('sends typed shares only as a full set that totals 100', async () => {
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
      schedule: gpm,
      defaultMethod: 'drip',
      targets: [
        { fieldId: 'f1', blockId: 'b1', sharePct: null },
        { fieldId: 'f1', blockId: 'b2', sharePct: null }
      ],
      areas: twoBeds,
      canEdit: true,
      split: { known: true, source: 'size' }
    });
    await fireEvent.click(screen.getByTestId('waterer-type-shares'));
    await fireEvent.input(screen.getByLabelText('Share for Herb garden · Bed 1 (%)'), {
      target: { value: '60' }
    });
    await fireEvent.input(screen.getByLabelText('Share for Herb garden · Bed 2 (%)'), {
      target: { value: '30' }
    });
    expect(screen.getByTestId('waterer-shares-total').textContent).toContain('Total: 90%');
    await fireEvent.click(screen.getByTestId('waterer-targets-save'));
    expect(screen.getByRole('alert').textContent).toBe('The shares must add up to 100%.');
    expect(calls).toHaveLength(0);
    await fireEvent.input(screen.getByLabelText('Share for Herb garden · Bed 2 (%)'), {
      target: { value: '40' }
    });
    await fireEvent.click(screen.getByTestId('waterer-targets-save'));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({
      areaIds: [],
      blockIds: ['b1', 'b2'],
      areaShares: {},
      blockShares: { b1: 60, b2: 40 }
    });
  });

  it('sends a running-since day and refuses one after today', async () => {
    const calls: Array<{ body: { spec: { schedule: Record<string, unknown> } } }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push({ body: JSON.parse(String(init.body)) });
        return new Response('{}', { status: 200 });
      })
    );
    render(WatererEditor, {
      equipmentId: 'eq-1',
      schedule,
      defaultMethod: 'drip',
      targets: [],
      areas,
      canEdit: true,
      todayYmd: '2026-10-20'
    });
    await fireEvent.click(screen.getByTestId('waterer-edit'));
    const since = screen.getByTestId('waterer-running-since-input');
    await fireEvent.input(since, { target: { value: '2026-10-21' } });
    await fireEvent.click(screen.getByTestId('waterer-save'));
    expect(screen.getByRole('alert').textContent).toBe('Pick a day no later than today.');
    await fireEvent.input(since, { target: { value: '2026-10-12' } });
    await fireEvent.click(screen.getByTestId('waterer-save'));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body.spec.schedule.runningSince).toBe('2026-10-12');
  });

  it('lists skipped runs with an Undo only where the viewer may undo', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, method: init.method ?? 'GET' });
        return new Response('{"ok":true}', { status: 200 });
      })
    );
    render(WatererEditor, {
      equipmentId: 'eq-1',
      label: 'Drip timer',
      schedule,
      defaultMethod: 'drip',
      targets: [],
      areas,
      canEdit: false,
      timeZone: 'UTC',
      skips: [
        { id: 's1', scheduledAt: Date.UTC(2026, 9, 14, 6), reason: 'did-not-run', canUndo: true },
        { id: 's2', scheduledAt: Date.UTC(2026, 9, 15, 6), reason: 'other', canUndo: false }
      ]
    });
    const rows = screen.getAllByTestId('waterer-skip');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Skipped Wed, Oct 14 at 6:00 AM (it didn't run)");
    expect(screen.getAllByTestId('waterer-skip-undo')).toHaveLength(1);
    await fireEvent.click(screen.getByTestId('waterer-skip-undo'));
    await waitFor(() =>
      expect(calls).toEqual([{ url: '/api/irrigation/skips/s1', method: 'DELETE' }])
    );
    await waitFor(() =>
      expect(screen.getByText('Skip undone. That run counts as water again.')).toBeTruthy()
    );
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
