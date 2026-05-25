/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Banner from './Banner.svelte';
import { createRawSnippet } from 'svelte';

const textSnippet = (text: string) =>
  createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));

describe('Banner', () => {
  it('renders content with role=status by default', () => {
    render(Banner, { children: textSnippet('Sync complete') });
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Sync complete');
  });

  it('urgent flips role to alert', () => {
    render(Banner, { children: textSnippet('Spray blocked'), urgent: true, tone: 'rust' });
    expect(screen.getByRole('alert')).toHaveTextContent('Spray blocked');
  });

  it('applies the tone class', () => {
    const { container } = render(Banner, {
      children: textSnippet('warn'),
      tone: 'wheat'
    });
    expect(container.querySelector('.banner')?.className).toMatch(/wheat/);
  });

  it('dismissible renders a close button that fires onDismiss', async () => {
    const onDismiss = vi.fn();
    render(Banner, { children: textSnippet('x'), dismissible: true, onDismiss });
    const btn = screen.getByRole('button', { name: 'Dismiss' });
    await fireEvent.click(btn);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('non-dismissible renders no close button', () => {
    render(Banner, { children: textSnippet('x') });
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
  });
});
