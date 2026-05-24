/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import Kicker from './Kicker.svelte';
import { createRawSnippet } from 'svelte';

const textSnippet = createRawSnippet(() => ({
  render: () => '<span>Today · do this first</span>'
}));

describe('Kicker', () => {
  it('renders content', () => {
    const { getByText } = render(Kicker, { children: textSnippet });
    expect(getByText('Today · do this first')).toBeInTheDocument();
  });

  it('applies the kicker class for the global uppercase + tracking treatment', () => {
    const { container } = render(Kicker, { children: textSnippet });
    expect(container.querySelector('.kicker')).toBeInTheDocument();
  });
});
