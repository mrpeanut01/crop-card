/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ProvenancePanel, { type RevisionEntry } from './ProvenancePanel.svelte';

const NOW = Date.now();

describe('ProvenancePanel', () => {
  it('renders the empty state when no revisions exist', () => {
    render(ProvenancePanel, { revisions: [] });
    expect(screen.getByText(/No revision history yet/)).toBeInTheDocument();
  });

  it('renders one entry per revision with the right Provenance badge', () => {
    const revs: RevisionEntry[] = [
      {
        id: 'r3',
        revisionNumber: 3,
        source: 'ai-refinement',
        createdAt: NOW - 3_600_000,
        note: 'Substituted K-Mag → Foliar K'
      },
      {
        id: 'r2',
        revisionNumber: 2,
        source: 'manual',
        createdAt: NOW - 86_400_000,
        createdByEmail: 'sherry@hilltop.farm'
      },
      {
        id: 'r1',
        revisionNumber: 1,
        source: 'wizard',
        createdAt: NOW - 7 * 86_400_000
      }
    ];
    render(ProvenancePanel, { revisions: revs, planLabel: '2026 plan' });
    expect(screen.getByText(/Where this plan came from/)).toBeInTheDocument();
    expect(screen.getByText(/2026 plan/)).toBeInTheDocument();
    expect(screen.getByText('#3')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
    // Provenance badges
    expect(screen.getByText('AI')).toBeInTheDocument();
    expect(screen.getByText('You typed')).toBeInTheDocument();
    expect(screen.getByText('Plugin')).toBeInTheDocument();
    expect(screen.getByText('Substituted K-Mag → Foliar K')).toBeInTheDocument();
    expect(screen.getByText('by sherry@hilltop.farm')).toBeInTheDocument();
  });

  it('formats time-ago labels correctly', () => {
    const revs: RevisionEntry[] = [
      { id: 'a', revisionNumber: 1, source: 'manual', createdAt: NOW - 1_500_000 }, // <1h
      { id: 'b', revisionNumber: 2, source: 'manual', createdAt: NOW - 5 * 3_600_000 }, // 5h
      { id: 'c', revisionNumber: 3, source: 'manual', createdAt: NOW - 3 * 86_400_000 } // 3d
    ];
    render(ProvenancePanel, { revisions: revs });
    expect(screen.getByText('just now')).toBeInTheDocument();
    expect(screen.getByText('5h ago')).toBeInTheDocument();
    expect(screen.getByText('3d ago')).toBeInTheDocument();
  });
});
