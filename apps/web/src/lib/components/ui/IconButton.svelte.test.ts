/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import IconButton from './IconButton.svelte';
import { createRawSnippet } from 'svelte';

const iconSnippet = createRawSnippet(() => ({
  render: () => '<svg aria-hidden="true"><circle r="4" cx="8" cy="8" /></svg>'
}));

describe('IconButton', () => {
  it('renders as <button> by default with the required aria-label', () => {
    render(IconButton, { ariaLabel: 'Settings', icon: iconSnippet });
    const btn = screen.getByRole('button', { name: 'Settings' });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).toHaveAttribute('aria-label', 'Settings');
  });

  it('renders as <a> when href is provided', () => {
    render(IconButton, { ariaLabel: 'Open settings', icon: iconSnippet, href: '/settings' });
    const link = screen.getByRole('link', { name: 'Open settings' });
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/settings');
  });

  it('applies the tone class', () => {
    const { container } = render(IconButton, {
      ariaLabel: 'x',
      icon: iconSnippet,
      tone: 'rust'
    });
    expect(container.querySelector('.icon-btn')?.className).toMatch(/rust/);
  });

  it('fires onclick when clicked', async () => {
    const onclick = vi.fn();
    render(IconButton, { ariaLabel: 'x', icon: iconSnippet, onclick });
    await fireEvent.click(screen.getByRole('button'));
    expect(onclick).toHaveBeenCalledOnce();
  });

  it('renders the icon slot content', () => {
    const { container } = render(IconButton, { ariaLabel: 'x', icon: iconSnippet });
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
