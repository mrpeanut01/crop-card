/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import Card from './Card.svelte';
import { createRawSnippet } from 'svelte';

const bodySnippet = createRawSnippet(() => ({ render: () => '<p>card body</p>' }));

describe('Card', () => {
  it('renders children', () => {
    const { getByText } = render(Card, { children: bodySnippet });
    expect(getByText('card body')).toBeInTheDocument();
  });

  it('applies padded class by default', () => {
    const { container } = render(Card, { children: bodySnippet });
    expect(container.querySelector('.card')?.className).toMatch(/padded/);
    expect(container.querySelector('.card')?.className).not.toMatch(/loose/);
  });

  it('padded=false drops the padded class', () => {
    const { container } = render(Card, { children: bodySnippet, padded: false });
    expect(container.querySelector('.card')?.className).not.toMatch(/padded/);
  });

  it('loose=true applies loose class', () => {
    const { container } = render(Card, { children: bodySnippet, loose: true });
    expect(container.querySelector('.card')?.className).toMatch(/loose/);
  });
});
