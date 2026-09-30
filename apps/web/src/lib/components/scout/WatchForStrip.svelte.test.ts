/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(async () => {}) }));

import WatchForStrip from './WatchForStrip.svelte';
import { SPRAY_WORDS } from '$lib/plugins/schemas';
import type { DegreeDayModelResult, DegreeDaysResult } from '$lib/ipm/degreeDayResult';
import { watchForView } from '$lib/ipm/watchFor';

function model(over: Partial<DegreeDayModelResult> = {}): DegreeDayModelResult {
  return {
    modelId: 'test-e2e-trap-borer',
    displayName: 'Test trap borer model',
    pest: { commonName: 'Test trap borer', scientificName: null },
    hostCropFamilies: ['cucurbit'],
    method: 'simple-average',
    baseTempF: 50,
    upperCutoffF: null,
    biofix: {
      kind: 'first-trap-catch',
      date: '2026-06-20',
      provenance: 'manual',
      recordedBy: 'u',
      acceptsManual: true
    },
    totalLowerBound: 180,
    missingDays: 2,
    throughYmd: '2026-06-30',
    status: {
      state: 'counting',
      stage: {
        key: 'eggs',
        label: 'Eggs on stems',
        gddFrom: 100,
        gddTo: 400,
        action: 'scout',
        message: 'Check stems near the soil line for eggs.'
      },
      inWindow: true,
      reached: true,
      next: null
    },
    lines: [
      'At least 180 degree days since Jun 20, 2 days missing, through Jun 30.',
      'Eggs on stems: Check stems near the soil line for eggs.'
    ],
    applicable: true,
    showOnScout: true,
    showOnToday: true,
    ...over
  };
}

function result(over: Partial<DegreeDaysResult> = {}): DegreeDaysResult {
  return {
    year: 2026,
    location: 'ok',
    message: null,
    station: {
      ghcnId: 'USW00093738',
      icao: 'KIAD',
      label: 'Washington Dulles Intl AP (KIAD)',
      distanceMiles: 6.2
    },
    dataError: null,
    models: [model()],
    ...over
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('watchForView', () => {
  it('hides when nothing is planted that a model watches', () => {
    expect(watchForView(result({ models: [model({ applicable: false })] })).show).toBe(false);
    expect(watchForView(null).show).toBe(false);
  });

  it('shows the station, method and biofix source', () => {
    const v = watchForView(result());
    expect(v.models[0]).toMatchObject({
      station: 'Washington Dulles Intl AP (KIAD), 6 mi',
      method: 'Base 50°F, simple average method.',
      biofix: { source: 'manual', text: 'Counting from your first trap catch on Jun 20.' },
      catchDate: '2026-06-20',
      stageLabel: 'Eggs on stems'
    });
    const cutoff = watchForView(
      result({ models: [model({ upperCutoffF: 86, method: 'single-sine' })] })
    );
    expect(cutoff.models[0].method).toBe('Base 50°F, upper cutoff 86°F, single sine method.');
  });

  it('never uses spray words', () => {
    const variants = [
      result(),
      result({
        location: 'no-station',
        station: null,
        message: 'Degree days need a weather station within 30 miles. None found.'
      }),
      result({
        models: [
          model({
            biofix: {
              kind: 'first-trap-catch',
              date: '2026-05-15',
              provenance: 'fallback',
              recordedBy: null,
              acceptsManual: true
            }
          })
        ]
      })
    ];
    for (const r of variants) {
      const v = watchForView(r);
      const strings = [
        v.message ?? '',
        ...v.models.flatMap((m) => [
          m.title,
          m.method,
          m.station ?? '',
          m.biofix?.text ?? '',
          ...m.lines
        ])
      ];
      for (const s of strings) expect(s).not.toMatch(SPRAY_WORDS);
    }
  });
});

describe('WatchForStrip', () => {
  it('renders the model and lets a helper save a catch', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ biofix: {} }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
    render(WatchForStrip, { result: result(), canRecordCatch: true, todayYmd: '2026-07-01' });
    expect(screen.getByRole('heading', { name: 'Watch for' })).toBeInTheDocument();
    expect(
      screen.getByText('Eggs on stems: Check stems near the soil line for eggs.')
    ).toBeInTheDocument();
    const input = screen.getByLabelText('First trap catch') as HTMLInputElement;
    expect(input.value).toBe('2026-06-20');
    await fireEvent.input(input, { target: { value: '2026-06-22' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save first catch' }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/pest-models/test-e2e-trap-borer/biofix',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ year: 2026, date: '2026-06-22' })
      })
    );
    expect(document.body.textContent ?? '').not.toMatch(SPRAY_WORDS);
  });

  it('hides the catch form from read-only members', () => {
    render(WatchForStrip, { result: result(), canRecordCatch: false, todayYmd: '2026-07-01' });
    expect(screen.queryByLabelText('First trap catch')).toBeNull();
  });

  it('shows the no-station line', () => {
    render(WatchForStrip, {
      result: result({
        location: 'no-station',
        station: null,
        message: 'Degree days need a weather station within 30 miles. None found.',
        models: [model({ lines: [], showOnScout: true })]
      }),
      canRecordCatch: true,
      todayYmd: '2026-07-01'
    });
    expect(
      screen.getByText('Degree days need a weather station within 30 miles. None found.')
    ).toBeInTheDocument();
  });
});
