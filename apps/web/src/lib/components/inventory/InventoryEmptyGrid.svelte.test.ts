/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import InventoryEmptyGrid from './InventoryEmptyGrid.svelte';

describe('InventoryEmptyGrid', () => {
  it('links every inventory kind to its add page and marks the current one', () => {
    render(InventoryEmptyGrid, { activeType: 'seed', canAdd: true });
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/inventory/pesticide/add',
      '/inventory/fertility/add',
      '/inventory/seed/add',
      '/inventory/crop/add',
      '/inventory/amendment/add'
    ]);
    expect(screen.getByRole('link', { name: /Manure or compost pile/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { current: true })).toHaveAttribute(
      'href',
      '/inventory/seed/add'
    );
    expect(screen.getByRole('heading', { name: 'No seeds yet' })).toBeInTheDocument();
  });

  it('tells a helper to ask the owner instead of linking to add pages', () => {
    render(InventoryEmptyGrid, { activeType: 'fertility', canAdd: false });
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByText(/Ask the owner to add some/)).toBeInTheDocument();
  });

  it('still offers a helper the manure or compost pile (33C)', () => {
    render(InventoryEmptyGrid, { activeType: 'pesticide', canAdd: false, canAddAmendment: true });
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/inventory/amendment/add']);
    expect(screen.getByText(/Ask the owner to add some/)).toBeInTheDocument();
  });

  it('offers a helper on the empty manure list only the pile tile', () => {
    render(InventoryEmptyGrid, { activeType: 'amendment', canAdd: false, canAddAmendment: true });
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/inventory/amendment/add']);
    expect(screen.queryByText(/Ask the owner to add some/)).toBeNull();
  });
});
