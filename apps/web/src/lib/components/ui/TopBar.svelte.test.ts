/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';

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

function groupLinks(container: HTMLElement, id: string) {
  const group = container.querySelector(`nav.primary-nav > details[data-group="${id}"]`);
  return [...(group?.querySelectorAll('.group-menu a') ?? [])].map((a) => a.getAttribute('href'));
}

describe('TopBar primary nav', () => {
  it('has five entries and no More menu: Today, Plan, Actions, Farm, Records', () => {
    const { container } = render(TopBar, { online: true, pendingCount: 0 });
    const nav = container.querySelector('nav.primary-nav') as HTMLElement;
    const entries = [...nav.children].map(
      (el) => el.getAttribute('href') ?? el.getAttribute('data-group')
    );
    expect(entries).toEqual(['/today', '/plan', 'actions', 'farm', 'records']);
    expect(nav.textContent).not.toContain('More');
  });

  it('puts Spray, Scout and Harvest under Actions', () => {
    const { container } = render(TopBar, { online: true, pendingCount: 0 });
    expect(groupLinks(container, 'actions')).toEqual(['/spray', '/scout', '/harvest']);
  });

  it('puts Inventory then Equipment under Farm (#474), with Animals first when kept', () => {
    const plain = render(TopBar, { online: true, pendingCount: 0 });
    expect(groupLinks(plain.container, 'farm')).toEqual(['/inventory', '/equipment']);
    plain.unmount();
    const withAnimals = render(TopBar, { online: true, pendingCount: 0, animalsLabel: 'Animals' });
    expect(groupLinks(withAnimals.container, 'farm')).toEqual([
      '/animals',
      '/inventory',
      '/equipment'
    ]);
  });

  it('puts Records and Cards under Records', () => {
    const { container } = render(TopBar, { online: true, pendingCount: 0 });
    expect(groupLinks(container, 'records')).toEqual(['/records', '/cards']);
  });

  it('opens one group at a time and closes it on Escape', async () => {
    const { container } = render(TopBar, { online: true, pendingCount: 0 });
    const summary = (id: string) =>
      container.querySelector(`details[data-group="${id}"] > summary`) as HTMLElement;
    const open = () =>
      [...container.querySelectorAll('details.nav-group[open]')].map((d) =>
        d.getAttribute('data-group')
      );
    await fireEvent.click(summary('actions'));
    expect(open()).toEqual(['actions']);
    await fireEvent.click(summary('farm'));
    expect(open()).toEqual(['farm']);
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(open()).toEqual([]);
  });
});

describe('TopBar feedback in the account menu (#466)', () => {
  const user = { email: 'ann@example.com', name: 'Ann', role: 'owner' };

  it('holds Send feedback behind the avatar', () => {
    const { container } = render(TopBar, { online: true, pendingCount: 0, user });
    const menu = container.querySelector('.account-menu') as HTMLElement;
    expect(within(menu).getByLabelText('Account').tagName).toBe('SUMMARY');
    expect(within(menu).getByRole('button', { name: 'Send feedback' })).toBeInTheDocument();
    expect(container.querySelector('a[href="/admin/feedback"]')).toBeNull();
  });

  it('adds the Feedback inbox for superadmins', () => {
    const { container } = render(TopBar, {
      online: true,
      pendingCount: 0,
      user: { ...user, isSuperadmin: true }
    });
    expect(container.querySelector('a[href="/admin/feedback"]')?.textContent).toContain(
      'Feedback inbox'
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
