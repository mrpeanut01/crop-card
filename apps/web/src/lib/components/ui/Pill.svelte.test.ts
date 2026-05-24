/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Pill from './Pill.svelte';
import { createRawSnippet } from 'svelte';

const textSnippet = (text: string) =>
  createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));

describe('Pill', () => {
  it('renders content', () => {
    render(Pill, { children: textSnippet('Today') });
    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  it('applies the neutral tone class by default', () => {
    const { container } = render(Pill, { children: textSnippet('x') });
    expect(container.querySelector('.pill')?.className).toMatch(/neutral/);
  });

  it.each(['neutral', 'forest', 'wheat', 'rust', 'sky'] as const)(
    'applies the %s tone class',
    (tone) => {
      const { container } = render(Pill, { children: textSnippet('x'), tone });
      expect(container.querySelector('.pill')?.className).toMatch(new RegExp(tone));
    }
  );
});
