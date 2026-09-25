/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';

vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/today') }
}));

import TopBar from './TopBar.svelte';
import type { NavAlert } from '$lib/today/navAlerts';

const ALERTS: NavAlert[] = [
  {
    id: 'decon:s1',
    tone: 'rust',
    label: 'Rig needs decon (group-9)',
    href: '/spray/decon?sprayer=s1'
  },
  { id: 'low:i1', tone: 'wheat', label: 'Roundup is low on stock', href: '/inventory/pesticide/i1' }
];

describe('TopBar alerts + search', () => {
  it('does not render a Search control (no search surface exists)', () => {
    render(TopBar, { online: true, pendingCount: 0, alerts: ALERTS });
    expect(screen.queryByLabelText(/search/i)).toBeNull();
  });

  it('Alerts trigger carries the active count and lists each alert as a link', () => {
    const { container } = render(TopBar, { online: true, pendingCount: 0, alerts: ALERTS });
    const trigger = screen.getByLabelText('Alerts, 2 active');
    expect(trigger.tagName).toBe('SUMMARY');
    expect(container.querySelector('.alerts-badge')?.textContent).toBe('2');
    const popover = container.querySelector('.alerts-popover') as HTMLElement;
    const decon = within(popover).getByRole('link', { name: 'Rig needs decon (group-9)' });
    expect(decon.getAttribute('href')).toBe('/spray/decon?sprayer=s1');
    expect(
      within(popover).getByRole('link', { name: 'Roundup is low on stock' }).getAttribute('href')
    ).toBe('/inventory/pesticide/i1');
  });

  it('adds pending offline records as the first alert', () => {
    const { container } = render(TopBar, { online: true, pendingCount: 3, alerts: ALERTS });
    expect(screen.getByLabelText('Alerts, 3 active')).toBeInTheDocument();
    const first = container.querySelector('.alerts-list a');
    expect(first?.textContent).toBe('3 offline records waiting to sync');
    expect(first?.getAttribute('href')).toBe('/records/pending');
  });

  it('shows an empty state and no badge when nothing is active', () => {
    const { container } = render(TopBar, { online: true, pendingCount: 0 });
    expect(screen.getByLabelText('Alerts, none active')).toBeInTheDocument();
    expect(container.querySelector('.alerts-badge')).toBeNull();
    expect(screen.getByText('No active alerts.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Today →' }).getAttribute('href')).toBe('/today');
  });
});
