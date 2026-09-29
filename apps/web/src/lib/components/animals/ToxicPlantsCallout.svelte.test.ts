/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ToxicPlantsCallout from './ToxicPlantsCallout.svelte';

// Test values only.
const CROPS = [
  {
    pluginId: 'grape-x',
    name: 'Grape X',
    toxicity: [{ speciesIds: ['dog'], parts: ['fruit' as const], severity: 'toxic' as const }]
  }
];

describe('ToxicPlantsCallout', () => {
  it('is one collapsed line with no dismiss control', () => {
    const { container } = render(ToxicPlantsCallout, {
      crops: CROPS,
      speciesIds: ['dog'],
      speciesPlural: { dog: 'Dogs' }
    });
    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(screen.getByText('1 plant here can harm dogs')).toBeInTheDocument();
    expect(screen.getByText('Grape X: Fruit. Poisonous to dogs.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /dismiss|hide|close/i })).toBeNull();
  });

  it('names the destination on the move sheet', () => {
    render(ToxicPlantsCallout, {
      crops: CROPS,
      speciesIds: ['dog'],
      speciesPlural: { dog: 'Dogs' },
      where: 'Back yard'
    });
    expect(screen.getByText('At Back yard: 1 plant here can harm dogs')).toBeInTheDocument();
  });

  it('renders nothing when the plants here do not harm this species', () => {
    const { container } = render(ToxicPlantsCallout, {
      crops: CROPS,
      speciesIds: ['chicken'],
      speciesPlural: {}
    });
    expect(container.querySelector('[data-testid="toxic-plants"]')).toBeNull();
  });
});
