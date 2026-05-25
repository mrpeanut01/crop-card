/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import SprayDecisionPage from './SprayDecisionPage.svelte';

const baseProps = {
  chemistry: 'insecticide' as const,
  blocks: [
    { id: 'b1', name: 'North field', acres: 1.5 },
    { id: 'b2', name: 'South field', acres: null }
  ],
  activeREI: [],
  blockId: 'b1',
  windMph: 5,
  tempF: 72,
  rainPct: 10,
  tankSize: 25,
  busy: false,
  result: null,
  error: null,
  violations: [],
  warnings: [],
  canSubmit: true,
  submitLabel: 'Record application',
  onSubmit: vi.fn(),
  productSection: createRawSnippet(() => ({
    render: () => '<div data-testid="product-slot">Product picker slot</div>'
  }))
};

describe('SprayDecisionPage', () => {
  it('renders the header with chemistry kicker', () => {
    render(SprayDecisionPage, { ...baseProps });
    expect(screen.getByRole('heading', { level: 1, name: 'Insecticides' })).toBeInTheDocument();
  });

  it('renders the productSection snippet inside the block card', () => {
    render(SprayDecisionPage, { ...baseProps });
    expect(screen.getByTestId('product-slot')).toBeInTheDocument();
  });

  it('renders block options with acres when present', () => {
    render(SprayDecisionPage, { ...baseProps });
    expect(screen.getByRole('option', { name: 'North field · 1.50 acres' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'South field' })).toBeInTheDocument();
  });

  it('renders conditions fields with required attribute', () => {
    render(SprayDecisionPage, { ...baseProps });
    const wind = screen.getByLabelText('Wind (mph)') as HTMLInputElement;
    const temp = screen.getByLabelText('Temperature (°F)') as HTMLInputElement;
    const rain = screen.getByLabelText('Rain forecast next 24h (%)') as HTMLInputElement;
    expect(wind).toHaveAttribute('required');
    expect(temp).toHaveAttribute('required');
    expect(rain).toHaveAttribute('required');
    expect(wind.value).toBe('5');
    expect(temp.value).toBe('72');
    expect(rain.value).toBe('10');
  });

  it('renders observation card heading when observation snippet provided', () => {
    render(SprayDecisionPage, {
      ...baseProps,
      observation: createRawSnippet(() => ({
        render: () => '<div data-testid="obs-slot">observation</div>'
      }))
    });
    expect(screen.getByRole('heading', { name: '2 · Observation (optional)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '3 · Conditions' })).toBeInTheDocument();
    expect(screen.getByTestId('obs-slot')).toBeInTheDocument();
  });

  it('uses 2 · Conditions heading when no observation snippet', () => {
    render(SprayDecisionPage, { ...baseProps });
    expect(screen.getByRole('heading', { name: '2 · Conditions' })).toBeInTheDocument();
  });

  it('disables submit when canSubmit is false', () => {
    render(SprayDecisionPage, { ...baseProps, canSubmit: false });
    const button = screen.getByRole('button', { name: 'Record application' });
    expect(button).toBeDisabled();
  });

  it('shows loading state when busy', () => {
    render(SprayDecisionPage, { ...baseProps, busy: true });
    expect(screen.getByRole('button', { name: 'Recording…' })).toBeInTheDocument();
  });

  it('renders success banner when result set', () => {
    render(SprayDecisionPage, { ...baseProps, result: 'Recorded — REI clear 5pm.' });
    expect(screen.getByText('Recorded — REI clear 5pm.')).toBeInTheDocument();
  });

  it('renders error banner with violation list', () => {
    render(SprayDecisionPage, {
      ...baseProps,
      error: 'failed',
      violations: [
        { code: 'WIND_TOO_HIGH', message: 'wind exceeds 10mph' },
        { code: 'PHI_VIOLATION', message: 'within PHI window' }
      ]
    });
    expect(screen.getByText(/failed/)).toBeInTheDocument();
    expect(screen.getByText(/wind exceeds 10mph/)).toBeInTheDocument();
    expect(screen.getByText(/within PHI window/)).toBeInTheDocument();
  });

  it('renders warnings banner when warnings present', () => {
    render(SprayDecisionPage, {
      ...baseProps,
      warnings: ['Low stock on Product X', 'No barcode on Product Y']
    });
    expect(screen.getByText(/Warnings/)).toBeInTheDocument();
    expect(screen.getByText(/Low stock on Product X/)).toBeInTheDocument();
  });

  it('renders recentEvents snippet when provided', () => {
    render(SprayDecisionPage, {
      ...baseProps,
      recentEvents: createRawSnippet(() => ({
        render: () => '<div data-testid="recent-slot">recent events</div>'
      }))
    });
    expect(screen.getByTestId('recent-slot')).toBeInTheDocument();
  });

  it('forwards activeREI to the header banner', () => {
    render(SprayDecisionPage, {
      ...baseProps,
      activeREI: [{ id: 'rei-1', blockId: 'b1', reEntryClearAt: Date.now() + 3_600_000 }]
    });
    expect(screen.getByText(/Active insecticide re-entry intervals/)).toBeInTheDocument();
  });

  it('fires onSubmit when form submitted', async () => {
    const onSubmit = vi.fn((ev: Event) => ev.preventDefault());
    render(SprayDecisionPage, { ...baseProps, onSubmit });
    const form = screen.getByRole('button', { name: 'Record application' }).closest('form')!;
    await fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  // ─── v2 addendum (#90) slot tests ─────────────────────────────────────

  it('accepts aiEnabled prop (defaults to false; render unaffected without slots)', () => {
    render(SprayDecisionPage, { ...baseProps, aiEnabled: true });
    // Without slots provided, aiEnabled is consumed by the page-level
    // snippets — shell still renders the standard form.
    expect(screen.getByRole('heading', { level: 1, name: 'Insecticides' })).toBeInTheDocument();
  });

  it('renders legendStrip slot above the form', () => {
    render(SprayDecisionPage, {
      ...baseProps,
      legendStrip: createRawSnippet(() => ({
        render: () => '<div data-testid="legend-slot">where this came from</div>'
      }))
    });
    expect(screen.getByTestId('legend-slot')).toBeInTheDocument();
  });

  it('renders tankMixProvenance slot inside the block+product card', () => {
    render(SprayDecisionPage, {
      ...baseProps,
      tankMixProvenance: createRawSnippet(() => ({
        render: () => '<span data-testid="tank-prov">prov</span>'
      }))
    });
    expect(screen.getByTestId('tank-prov')).toBeInTheDocument();
  });

  it('renders ipmGate slot as its own card when provided', () => {
    render(SprayDecisionPage, {
      ...baseProps,
      ipmGate: createRawSnippet(() => ({
        render: () => '<h2 data-testid="ipm-card">IPM threshold gate</h2>'
      }))
    });
    expect(screen.getByTestId('ipm-card')).toBeInTheDocument();
  });

  it('renders pollinatorGate slot as its own card when provided', () => {
    render(SprayDecisionPage, {
      ...baseProps,
      pollinatorGate: createRawSnippet(() => ({
        render: () => '<h2 data-testid="poll-card">Pollinator gate</h2>'
      }))
    });
    expect(screen.getByTestId('poll-card')).toBeInTheDocument();
  });

  it('omits all v2 slots when not provided (no empty cards)', () => {
    const { container } = render(SprayDecisionPage, { ...baseProps });
    // legend-strip + tank-mix-provenance + gate-card containers should be
    // absent when their snippets are unbound — confirms the shell
    // degrades cleanly for pre-#89 surfaces.
    expect(container.querySelector('.legend-strip')).toBeNull();
    expect(container.querySelector('.tank-mix-provenance')).toBeNull();
    expect(container.querySelector('.gate-card')).toBeNull();
  });
});
