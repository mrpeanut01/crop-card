/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ProvenanceLegend from './ProvenanceLegend.svelte';

describe('ProvenanceLegend', () => {
  it('renders the default 4-source legend', () => {
    render(ProvenanceLegend, {});
    expect(screen.getByText('Where this data came from')).toBeInTheDocument();
    expect(screen.getByText('Plugin')).toBeInTheDocument();
    expect(screen.getByText('Your data')).toBeInTheDocument();
    expect(screen.getByText('AI')).toBeInTheDocument();
    expect(screen.getByText('You typed')).toBeInTheDocument();
    expect(screen.queryByText('Fallback')).not.toBeInTheDocument();
  });

  it('renders the AI-off variant with fallback in place of ai', () => {
    render(ProvenanceLegend, {
      shown: ['plugin', 'data', 'fallback', 'manual'],
      note: 'AI off · plugin defaults filled · all editable'
    });
    expect(screen.getByText('Plugin')).toBeInTheDocument();
    expect(screen.getByText('Fallback')).toBeInTheDocument();
    expect(screen.queryByText('AI')).not.toBeInTheDocument();
    expect(screen.getByText('AI off · plugin defaults filled · all editable')).toBeInTheDocument();
  });

  it('hides the note slot when not provided', () => {
    const { container } = render(ProvenanceLegend, { shown: ['plugin'] });
    expect(container.querySelector('.note')).toBeNull();
  });
});
