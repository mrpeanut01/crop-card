/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { checkFracRotation } from '$lib/safety/fracRotation';
import type { RainfastCheck } from '$lib/weather/leafWet';
import DryWindowGate from './DryWindowGate.svelte';
import FracRotationTile from './FracRotationTile.svelte';
import LeafWetDial from './LeafWetDial.svelte';
import RainSparkline from './RainSparkline.svelte';

const T = Date.UTC(2026, 8, 25, 16);

function rainfast(over: Partial<RainfastCheck> = {}): RainfastCheck {
  return {
    status: 'clear',
    rainfastHours: 4,
    firstRiskMs: null,
    maxPopPct: 10,
    totalPrecipMm: 0,
    coveredHours: 4,
    ...over
  };
}

describe('LeafWetDial', () => {
  it('renders wet hours with an accessible label and data provenance', () => {
    render(LeafWetDial, {
      past: { wetHours: 5, coveredHours: 8 },
      next: { wetHours: 9, coveredHours: 24 },
      threshold: 6,
      provenance: 'data'
    });
    expect(screen.getByTestId('leaf-wet-svg')).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/9 of the next 24.*infection-favorable/)
    );
    expect(screen.getByText('Infection-favorable wetness ahead')).toBeInTheDocument();
    expect(screen.getByText(/8 h of data/)).toBeInTheDocument();
    expect(document.querySelector('[data-provenance="data"]')).not.toBeNull();
  });

  it('says weather is unavailable on fallback', () => {
    render(LeafWetDial, {
      past: { wetHours: 0, coveredHours: 0 },
      next: { wetHours: 0, coveredHours: 0 },
      threshold: 6,
      provenance: 'fallback'
    });
    expect(screen.getByText(/Weather unavailable — check conditions yourself/)).toBeInTheDocument();
    expect(document.querySelector('[data-provenance="fallback"]')).not.toBeNull();
  });
});

describe('RainSparkline', () => {
  it('renders one bar per day with an aria summary', () => {
    const { container } = render(RainSparkline, {
      rain: [
        { date: '2026-09-25', value: 0, coveredHours: 16 },
        { date: '2026-09-26', value: 7.2, coveredHours: 24 },
        { date: '2026-09-27', value: 3.6, coveredHours: 24 }
      ],
      leafWet: [{ date: '2026-09-26', value: 11, coveredHours: 24 }],
      provenance: 'data'
    });
    expect(container.querySelectorAll('rect')).toHaveLength(3);
    expect(screen.getByRole('img', { name: /Sat 7.2 mm/ })).toBeInTheDocument();
    expect(screen.getByText('10.8 mm total')).toBeInTheDocument();
    expect(screen.getByText(/11h wet/)).toBeInTheDocument();
  });

  it('shows the unavailable message with no data', () => {
    render(RainSparkline, { rain: [], provenance: 'fallback' });
    expect(screen.getByText(/Weather unavailable/)).toBeInTheDocument();
  });
});

describe('DryWindowGate', () => {
  it('clear state has no acknowledge checkbox', () => {
    render(DryWindowGate, {
      rainfast: rainfast(),
      dryWindow: { startMs: T, endMs: T + 4 * 3600_000, hours: 4 },
      provenance: 'data',
      rainfastFromLabel: false,
      acknowledged: false
    });
    expect(screen.getByTestId('dry-window-gate')).toHaveAttribute('data-state', 'clear');
    expect(screen.getByText('Dry window OK')).toBeInTheDocument();
    expect(screen.getByText(/label rainfast interval not on file/)).toBeInTheDocument();
    expect(screen.queryByTestId('dry-window-ack')).toBeNull();
  });

  it('rain-risk state requires an explicit acknowledgement', async () => {
    render(DryWindowGate, {
      rainfast: rainfast({
        status: 'rain-risk',
        firstRiskMs: T + 3600_000,
        maxPopPct: 70,
        totalPrecipMm: 2.4
      }),
      dryWindow: null,
      provenance: 'data',
      rainfastFromLabel: true,
      acknowledged: false
    });
    expect(screen.getByTestId('dry-window-gate')).toHaveAttribute('data-state', 'rain-risk');
    expect(screen.getByRole('alert')).toHaveTextContent(/max PoP 70%/);
    const box = screen.getByTestId('dry-window-ack') as HTMLInputElement;
    expect(box.checked).toBe(false);
    await fireEvent.click(box);
    expect(box.checked).toBe(true);
    expect(screen.getByText(/No 4-hour dry window/)).toBeInTheDocument();
  });

  it('fallback provenance is honest and never asks for acknowledgement', () => {
    render(DryWindowGate, {
      rainfast: rainfast({ status: 'rain-risk' }),
      dryWindow: null,
      provenance: 'fallback',
      rainfastFromLabel: false,
      acknowledged: false
    });
    expect(screen.getByTestId('dry-window-gate')).toHaveAttribute('data-state', 'unknown');
    expect(screen.getByText(/Weather unavailable — check conditions yourself/)).toBeInTheDocument();
    expect(screen.queryByTestId('dry-window-ack')).toBeNull();
  });
});

describe('FracRotationTile', () => {
  const prior = {
    pluginId: 'captan',
    displayName: 'Captan 80 WDG',
    fracCodes: ['M04'],
    occurredAt: T - 7 * 86_400_000
  };

  it('block state renders the shared FRAC group from the evaluator', () => {
    const violations = checkFracRotation([{ pluginId: 'captan-2', fracCodes: ['M04'] }], [prior]);
    render(FracRotationTile, { violations, prior, proposedFracCodes: ['M04'] });
    expect(screen.getByTestId('frac-rotation-tile')).toHaveAttribute('data-state', 'block');
    expect(screen.getByRole('alert')).toHaveTextContent(/FRAC M04 was used/);
    expect(screen.getByText('Same group as last spray')).toBeInTheDocument();
  });

  it('pass state when groups differ', () => {
    const violations = checkFracRotation([{ pluginId: 'x', fracCodes: ['3'] }], [prior]);
    render(FracRotationTile, { violations, prior, proposedFracCodes: ['3'] });
    expect(screen.getByTestId('frac-rotation-tile')).toHaveAttribute('data-state', 'pass');
    expect(screen.getByText(/No FRAC group overlaps/)).toBeInTheDocument();
  });

  it('pass state with no history', () => {
    render(FracRotationTile, { violations: [], prior: null, proposedFracCodes: ['7'] });
    expect(screen.getByText(/No prior fungicide recorded/)).toBeInTheDocument();
  });

  it('warn state for a same-FRAC pair inside the tank', () => {
    render(FracRotationTile, {
      violations: [],
      prior: null,
      proposedFracCodes: ['3'],
      tankOverlapCode: '3'
    });
    expect(screen.getByTestId('frac-rotation-tile')).toHaveAttribute('data-state', 'warn');
  });

  it('idle state without products', () => {
    render(FracRotationTile, { violations: [], prior: null, proposedFracCodes: [] });
    expect(screen.getByText('Pick a product')).toBeInTheDocument();
  });
});
