/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import PlantingCard from './PlantingCard.svelte';
import type { PlantingRecord } from '$lib/db/blocks';

const PLANTING: PlantingRecord = {
  id: 'p1',
  blockId: 'b1',
  cropPluginId: 'corn-bloody-butcher',
  varietyDisplayName: 'Bloody Butcher',
  plantingDate: Date.UTC(2026, 4, 1, 12),
  quantityPlanted: 400,
  quantityUnit: 'seeds'
};

function terms(container: HTMLElement): string[] {
  return [...container.querySelectorAll('dt')].map((d) => d.textContent ?? '');
}

function values(container: HTMLElement): string[] {
  return [...container.querySelectorAll('dd .value')].map((d) => d.textContent ?? '');
}

describe('PlantingCard (#121)', () => {
  it('renders as a planting Card', () => {
    const { container } = render(PlantingCard, { planting: PLANTING });
    const article = container.querySelector('article')!;
    expect(article.dataset.cardKind).toBe('planting');
    expect(article.dataset.cardKey).toBe('pl_p1');
  });

  it('renders the crop · role line as the kicker', () => {
    const { container } = render(PlantingCard, {
      planting: PLANTING,
      cropName: 'Dent corn',
      role: 'Anchor',
      stage: 'V6 · Six leaf'
    });
    expect(container.querySelector('.kicker')?.textContent).toBe('Dent corn · Anchor');
  });

  it('omits the crop name from the kicker when it matches the title', () => {
    const { container } = render(PlantingCard, {
      planting: PLANTING,
      cropName: 'Bloody Butcher',
      role: 'Primary'
    });
    expect(container.querySelector('.kicker')?.textContent).toBe('Primary');
  });

  it('always renders the five facts in order', () => {
    const { container } = render(PlantingCard, {
      planting: PLANTING,
      daysToMaturity: 100,
      role: 'Companion',
      stage: 'V6 · Six leaf'
    });
    expect(terms(container)).toEqual(['Role', 'Stage', 'Planted', 'Harvest', 'Amount']);
    expect(values(container)[0]).toBe('Companion');
    expect(screen.getByText('V6 · Six leaf')).toBeInTheDocument();
    expect(screen.getByText('400 seeds')).toBeInTheDocument();
    expect(values(container)[2]).toBe('May 1, 2026');
    expect(values(container)[3]).toBe('Aug 9');
  });

  it('shows placeholders when role / stage are unknown', () => {
    const { container } = render(PlantingCard, { planting: PLANTING });
    expect(values(container)[0]).toBe('—');
    expect(values(container)[1]).toBe('—');
  });

  it('shows a derived status pill', () => {
    const { container } = render(PlantingCard, {
      planting: { ...PLANTING, plantingDate: null }
    });
    expect(container.querySelector('[data-card-status]')?.textContent?.trim()).toBe('planned');
  });

  it('uses the planting swatch for the stripe', () => {
    const { container } = render(PlantingCard, { planting: PLANTING });
    const article = container.querySelector('article') as HTMLElement;
    expect(article.style.getPropertyValue('--strip')).toMatch(/^#/);
  });

  it('keeps the companion jump chips and the refine action', async () => {
    const onCompanionClick = vi.fn();
    const onRefine = vi.fn();
    render(PlantingCard, {
      planting: PLANTING,
      companions: [{ ...PLANTING, id: 'p2', varietyDisplayName: 'Cherokee Trail Beans' }],
      onCompanionClick,
      onRefine
    });
    await fireEvent.click(screen.getByRole('button', { name: /Cherokee Trail/ }));
    expect(onCompanionClick).toHaveBeenCalledWith('p2');
    await fireEvent.click(screen.getByRole('button', { name: /Refine/ }));
    expect(onRefine).toHaveBeenCalled();
  });

  it('links the archetype plan view when there is one', () => {
    render(PlantingCard, { planting: PLANTING, detailHref: '/plan/wheat?planting=p1' });
    expect(screen.getByRole('link', { name: 'Stages, scab risk & vernalization' })).toHaveAttribute(
      'href',
      '/plan/wheat?planting=p1'
    );
  });

  it('tags provenance: AI plan, carry-forward, or manual entry', () => {
    const ai = render(PlantingCard, { planting: PLANTING, sourceTag: 'AI plan' });
    expect(
      ai.container.querySelector('footer [data-provenance]')?.getAttribute('data-provenance')
    ).toBe('ai');
    expect(ai.container.querySelector('footer')?.textContent).toContain('AI plan');
    ai.unmount();
    const carry = render(PlantingCard, { planting: PLANTING, sourceTag: 'Carry-forward' });
    expect(
      carry.container.querySelector('footer [data-provenance]')?.getAttribute('data-provenance')
    ).toBe('fallback');
    carry.unmount();
    const manual = render(PlantingCard, { planting: PLANTING });
    expect(manual.container.querySelector('footer')?.textContent).toContain('Manual entry');
    expect(manual.container.querySelector('.asof')).toBeNull();
  });
});

describe('PlantingCard title link (#179)', () => {
  it('links the title to the planting detail page', () => {
    render(PlantingCard, { planting: PLANTING });
    const link = screen.getByRole('link', { name: 'Bloody Butcher' });
    expect(link.getAttribute('href')).toBe('/crops/p1');
  });
});
