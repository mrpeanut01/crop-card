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

describe('TopBar animals entry (Phase 32B)', () => {
  it('is hidden for crop-only growers', () => {
    const { container } = render(TopBar, { online: true, pendingCount: 0 });
    expect(container.querySelector('a[href="/animals"]')).toBeNull();
  });

  it('uses the label the layout passes, such as "Pets & animals"', () => {
    const { container } = render(TopBar, {
      online: true,
      pendingCount: 0,
      animalsLabel: 'Pets & animals'
    });
    const links = container.querySelectorAll('a[href="/animals"]');
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].textContent).toContain('Pets & animals');
  });
});

describe('TopBar equipment entry (#474)', () => {
  it('links Equipment right after Inventory', () => {
    const { container } = render(TopBar, { online: true, pendingCount: 0 });
    const nav = container.querySelector('nav.primary-nav') as HTMLElement;
    const hrefs = [...nav.querySelectorAll(':scope > a')].map((a) => a.getAttribute('href'));
    const more = [...nav.querySelectorAll('.more-menu a')].map((a) => a.getAttribute('href'));
    const all = [...hrefs, ...more.filter((h) => !hrefs.includes(h))];
    const i = all.indexOf('/inventory');
    expect(i).toBeGreaterThan(-1);
    expect(all[i + 1]).toBe('/equipment');
    expect(within(nav).getAllByText('Equipment').length).toBeGreaterThan(0);
  });
});

describe('TopBar feedback entry (#466)', () => {
  it('offers Send feedback in the More menu at every width', () => {
    const { container } = render(TopBar, { online: true, pendingCount: 0 });
    const menu = container.querySelector('.more-menu') as HTMLElement;
    expect(within(menu).getByRole('button', { name: 'Send feedback' })).toBeInTheDocument();
    expect(container.querySelector('a[href="/admin/feedback"]')).toBeNull();
  });

  it('adds the Feedback inbox for superadmins', () => {
    const { container } = render(TopBar, {
      online: true,
      pendingCount: 0,
      user: { email: 'a@b.c', role: 'owner', isSuperadmin: true }
    });
    expect(container.querySelector('a[href="/admin/feedback"]')?.textContent).toContain(
      'Feedback inbox'
    );
  });
});

describe('TopBar Actions menu', () => {
  it('groups Spray, Scout and Harvest under one Actions dropdown for the top row', () => {
    const { container } = render(TopBar, { online: true, pendingCount: 0 });
    const actions = container.querySelector('nav.primary-nav > details.actions-nav') as HTMLElement;
    expect(actions.querySelector('summary')?.textContent).toContain('Actions');
    const hrefs = [...actions.querySelectorAll('.actions-menu a')].map((a) =>
      a.getAttribute('href')
    );
    expect(hrefs).toEqual(['/spray', '/scout', '/harvest']);
  });

  it('keeps the three actions as their own bottom-bar tabs, placed after Plan', () => {
    const { container } = render(TopBar, { online: true, pendingCount: 0 });
    const nav = container.querySelector('nav.primary-nav') as HTMLElement;
    const tabs = [...nav.querySelectorAll(':scope > a.nav-link')].map((a) =>
      a.getAttribute('href')
    );
    expect(tabs.slice(0, 5)).toEqual(['/today', '/plan', '/spray', '/scout', '/harvest']);
    for (const href of ['/spray', '/scout', '/harvest']) {
      expect(nav.querySelector(`:scope > a[href="${href}"]`)?.classList).toContain('action-item');
    }
    const order = [...nav.children].map((el) => el.getAttribute('href') ?? el.className);
    expect(order.indexOf('/plan')).toBeLessThan(
      order.findIndex((c) => String(c).includes('actions-nav'))
    );
  });
});

describe('TopBar account menu', () => {
  const user = { email: 'ann@example.com', name: 'Ann', role: 'owner' };

  it('opens from the avatar with the account identity, settings link and sign out', () => {
    const { container } = render(TopBar, { online: true, pendingCount: 0, user });
    const trigger = screen.getByLabelText('Account');
    expect(trigger.tagName).toBe('SUMMARY');
    const popover = container.querySelector('.owner-popover') as HTMLElement;
    expect(within(popover).getByText('ann@example.com')).toBeInTheDocument();
    expect(within(popover).getByRole('link', { name: 'Account' }).getAttribute('href')).toBe(
      '/settings/account'
    );
    const signOut = within(popover).getByRole('button', { name: 'Sign out' });
    const form = signOut.closest('form') as HTMLFormElement;
    expect(form.getAttribute('method')).toBe('POST');
    expect(form.getAttribute('action')).toBe('/signout');
  });

  it('keeps the farm switcher in the same menu when there are several farms', () => {
    const { container } = render(TopBar, {
      online: true,
      pendingCount: 0,
      user,
      activeOwner: { id: 'o1', name: 'Home' },
      availableOwners: [
        { id: 'o1', name: 'Home', role: 'owner' },
        { id: 'o2', name: 'Neighbor', role: 'helper' }
      ]
    });
    const popover = container.querySelector('.owner-popover') as HTMLElement;
    expect(within(popover).getAllByRole('menuitemradio')).toHaveLength(2);
    expect(within(popover).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('shows a phone-only user their formatted number', () => {
    render(TopBar, {
      online: true,
      pendingCount: 0,
      user: { email: null, phone: '+15405550123', role: 'owner' }
    });
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });
});
