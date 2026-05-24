/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import OfflineIndicator from './OfflineIndicator.svelte';

describe('OfflineIndicator', () => {
  it('online + 0 pending → "Online · synced"', () => {
    render(OfflineIndicator, { online: true, pendingCount: 0 });
    expect(screen.getByText(/Online · synced/)).toBeInTheDocument();
  });

  it('online + N pending → "Syncing · N"', () => {
    render(OfflineIndicator, { online: true, pendingCount: 3 });
    expect(screen.getByText(/Syncing · 3/)).toBeInTheDocument();
  });

  it('offline + 0 pending → "Offline"', () => {
    render(OfflineIndicator, { online: false, pendingCount: 0 });
    expect(screen.getByText(/^Offline$/)).toBeInTheDocument();
  });

  it('offline + N pending → "Offline · N queued"', () => {
    render(OfflineIndicator, { online: false, pendingCount: 5 });
    expect(screen.getByText(/Offline · 5 queued/)).toBeInTheDocument();
  });

  it('applies offline class when not online', () => {
    const { container } = render(OfflineIndicator, { online: false, pendingCount: 0 });
    expect(container.querySelector('.indicator')?.className).toMatch(/offline/);
  });

  it('applies queued class when pendingCount > 0', () => {
    const { container } = render(OfflineIndicator, { online: true, pendingCount: 2 });
    expect(container.querySelector('.indicator')?.className).toMatch(/queued/);
  });
});
