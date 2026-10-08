/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import SprayPageHeader from './SprayPageHeader.svelte';

describe('SprayPageHeader', () => {
  it('renders default title + lede for herbicide', () => {
    render(SprayPageHeader, { chemistry: 'herbicide' });
    expect(screen.getByRole('heading', { level: 1, name: 'Plan a spray' })).toBeInTheDocument();
    expect(screen.getByText(/STOP card/)).toBeInTheDocument();
  });

  it('renders default title + lede for insecticide', () => {
    render(SprayPageHeader, { chemistry: 'insecticide' });
    expect(screen.getByRole('heading', { level: 1, name: 'Insecticides' })).toBeInTheDocument();
  });

  it('renders default title + lede for fungicide', () => {
    render(SprayPageHeader, { chemistry: 'fungicide' });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Fungicide application' })
    ).toBeInTheDocument();
  });

  it('respects title + lede overrides', () => {
    render(SprayPageHeader, {
      chemistry: 'herbicide',
      title: 'Custom title',
      lede: 'Custom lede.'
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Custom title' })).toBeInTheDocument();
    expect(screen.getByText('Custom lede.')).toBeInTheDocument();
  });

  it('renders the default gate pills for fungicide, with no roadmap text (#674)', () => {
    const { container } = render(SprayPageHeader, { chemistry: 'fungicide' });
    expect(screen.getByText(/FRAC rotation/)).toBeInTheDocument();
    expect(screen.getByText(/Rain\/dew/)).toBeInTheDocument();
    expect(screen.queryByText(/Disease forecast/)).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Phase \d/);
  });

  it('renders the default gate pills for herbicide (2 pills)', () => {
    render(SprayPageHeader, { chemistry: 'herbicide' });
    expect(screen.getByText(/IPM threshold/)).toBeInTheDocument();
    expect(screen.getByText(/Pollinator-bloom/)).toBeInTheDocument();
  });

  it('renders activeREI banner when intervals provided', () => {
    render(SprayPageHeader, {
      chemistry: 'insecticide',
      activeREI: [{ id: 'rei-1', blockId: 'block-abc', reEntryClearAt: Date.now() + 3_600_000 }]
    });
    expect(screen.getByText(/Active insecticide re-entry intervals/)).toBeInTheDocument();
    expect(screen.getByText(/Removed block — re-entry clear/)).toBeInTheDocument();
    expect(screen.queryByText(/block-abc/)).not.toBeInTheDocument();
  });

  it('names the block in the re-entry banner, never its id (#673)', () => {
    render(SprayPageHeader, {
      chemistry: 'fungicide',
      activeREI: [{ id: 'rei-1', blockId: 'f6034532-uuid', reEntryClearAt: Date.now() }],
      blockNames: { 'f6034532-uuid': 'Bed 1' }
    });
    expect(screen.getByText(/Bed 1 — re-entry clear/)).toBeInTheDocument();
    expect(screen.queryByText(/f6034532/)).not.toBeInTheDocument();
  });

  it('renders the re-entry clear time in the user zone', () => {
    render(SprayPageHeader, {
      chemistry: 'insecticide',
      activeREI: [{ id: 'rei-1', blockId: 'b1', reEntryClearAt: Date.UTC(2026, 8, 26, 2, 30) }]
    });
    expect(screen.getByText(/re-entry clear Sep 25, 2026, 10:30 PM/)).toBeInTheDocument();
  });

  it('lists an active herbicide re-entry interval (#640)', () => {
    render(SprayPageHeader, {
      chemistry: 'herbicide',
      activeREI: [
        { id: 'h-1', blockId: 'b1', reEntryClearAt: Date.now() + 3_600_000, complete: true }
      ],
      blockNames: { b1: 'North field' }
    });
    expect(screen.getByText(/Active herbicide re-entry intervals/)).toBeInTheDocument();
    expect(screen.getByText(/North field — re-entry clear/)).toBeInTheDocument();
    expect(screen.queryByText(/no earlier than/)).not.toBeInTheDocument();
  });

  it('says a partly known tank clears no earlier than its known REI (#640)', () => {
    render(SprayPageHeader, {
      chemistry: 'herbicide',
      activeREI: [
        { id: 'h-1', blockId: 'b1', reEntryClearAt: Date.now() + 3_600_000, complete: false }
      ],
      blockNames: { b1: 'North field' }
    });
    expect(screen.getByText(/re-entry clear no earlier than/)).toBeInTheDocument();
    expect(screen.getByText(/has no REI on file\. Check the label\./)).toBeInTheDocument();
  });

  it('omits activeREI banner when none active', () => {
    render(SprayPageHeader, { chemistry: 'herbicide' });
    expect(screen.queryByText(/Active.*re-entry intervals/)).not.toBeInTheDocument();
  });
});
