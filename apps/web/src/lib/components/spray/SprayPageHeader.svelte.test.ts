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

  it('renders the default gate pills for fungicide (3 pills)', () => {
    render(SprayPageHeader, { chemistry: 'fungicide' });
    expect(screen.getByText(/FRAC rotation/)).toBeInTheDocument();
    expect(screen.getByText(/Disease forecast/)).toBeInTheDocument();
    expect(screen.getByText(/Rain\/dew/)).toBeInTheDocument();
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
    expect(screen.getByText(/Block block-abc/)).toBeInTheDocument();
  });

  it('omits activeREI banner when none active', () => {
    render(SprayPageHeader, { chemistry: 'herbicide' });
    expect(screen.queryByText(/Active.*re-entry intervals/)).not.toBeInTheDocument();
  });
});
