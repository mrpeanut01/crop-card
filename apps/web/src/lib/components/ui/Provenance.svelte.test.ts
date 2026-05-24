/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Provenance from './Provenance.svelte';

type ProvenanceSource = 'plugin' | 'data' | 'ai' | 'manual' | 'fallback';

describe('Provenance', () => {
  it('renders the label for every source', () => {
    const cases: Array<[ProvenanceSource, string]> = [
      ['plugin', 'Plugin'],
      ['data', 'Your data'],
      ['ai', 'AI'],
      ['manual', 'You typed'],
      ['fallback', 'Fallback']
    ];
    for (const [source, label] of cases) {
      const { unmount } = render(Provenance, { source });
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it('omits the label in compact mode (icon-only)', () => {
    render(Provenance, { source: 'plugin', compact: true });
    expect(screen.queryByText('Plugin')).not.toBeInTheDocument();
  });

  it('renders detail when provided', () => {
    render(Provenance, { source: 'plugin', detail: 'corn-bb · v1.4' });
    expect(screen.getByText('corn-bb · v1.4')).toBeInTheDocument();
  });

  it('renders confidence as % for ai source only', () => {
    render(Provenance, { source: 'ai', confidence: 0.92 });
    expect(screen.getByText('92%')).toBeInTheDocument();
  });

  it('ignores confidence on non-ai sources', () => {
    render(Provenance, { source: 'plugin', confidence: 0.92 });
    expect(screen.queryByText('92%')).not.toBeInTheDocument();
  });

  it('rounds confidence to the nearest %', () => {
    render(Provenance, { source: 'ai', confidence: 0.876 });
    expect(screen.getByText('88%')).toBeInTheDocument();
  });

  it('exposes long-form explanation in title tooltip', () => {
    const { container } = render(Provenance, {
      source: 'plugin',
      detail: 'foo'
    });
    const badge = container.querySelector('.prov');
    expect(badge?.getAttribute('title')).toContain('crop, input, or safety-kernel plugin');
    expect(badge?.getAttribute('title')).toContain('foo');
  });
});
