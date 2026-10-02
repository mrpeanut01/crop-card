<script lang="ts">
  import type { InventoryType } from '$lib/inventory/types';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import type { MessageKey } from '$lib/i18n';
  import { invTypeLabel, invTypeLower } from './typeLabel';
  import { visibleInventoryTypes } from '$lib/inventory/chips';

  interface Props {
    activeType: InventoryType;
    canAdd: boolean;
    /** Kinds offered as tiles; defaults to the always-shown types plus the
     *  active one. */
    types?: readonly InventoryType[];
  }

  const { activeType, canAdd, types: typesProp }: Props = $props();
  const types = $derived(
    typesProp ?? visibleInventoryTypes({ stockCounts: {}, hasAnimals: false, active: activeType })
  );

  const tr = $derived(createT(page.data?.locale));

  const HINT_KEYS = {
    pesticide: 'inv.empty.hint.pesticide',
    fertility: 'inv.empty.hint.fertility',
    seed: 'inv.empty.hint.seed',
    crop: 'inv.empty.hint.crop',
    feed: 'inv.empty.hint.feed',
    'animal-health': 'inv.empty.hint.animalHealth'
  } as const satisfies Record<InventoryType, MessageKey>;
</script>

<section class="inv-empty" aria-labelledby="inv-empty-title" data-testid="inventory-empty">
  <h2 id="inv-empty-title" class="serif">
    {tr('inv.empty.title', { type: invTypeLower(tr, activeType) })}
  </h2>
  {#if canAdd}
    <p class="lede">{tr('inv.empty.lede')}</p>
    <ul class="grid">
      {#each types as t (t)}
        <li>
          <a
            class="tile"
            class:active={t === activeType}
            href="/inventory/{t}/add"
            aria-current={t === activeType ? 'true' : undefined}
          >
            <span class="tile-title">{invTypeLabel(tr, t)}</span>
            <span class="tile-hint">{tr(HINT_KEYS[t])}</span>
          </a>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="ask-owner" role="note">
      {tr('inv.empty.askOwner')}
    </p>
  {/if}
</section>

<style>
  .inv-empty {
    margin-top: 16px;
    padding: var(--card-padding-loose, 18px);
    border: 1px solid var(--color-divider, #d9cfb7);
    border-radius: var(--radius-card, 8px);
    background: var(--color-paper, #fdfaf2);
  }
  h2 {
    margin: 0 0 var(--space-2, 8px);
    font-size: var(--font-size-card-title, 17px);
    color: var(--color-forest-deep, #1f3a28);
  }
  .lede {
    margin: 0 0 var(--space-3, 12px);
    color: var(--color-ink-soft, #4a4f46);
  }
  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: var(--space-2, 8px);
  }
  .tile {
    height: 100%;
    min-height: 88px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: var(--space-3, 12px);
    border: 1px solid var(--color-divider, #d9cfb7);
    border-radius: var(--radius-card, 8px);
    background: var(--color-cream, #f8f3e8);
    color: var(--color-ink, #1a1f1a);
    text-decoration: none;
  }
  .tile:hover,
  .tile.active {
    border-color: var(--color-forest, #2c5237);
    background: var(--pill-forest-bg, #e5eedf);
  }
  .tile-title {
    font-weight: 600;
    color: var(--color-forest-deep, #1f3a28);
  }
  .tile-hint {
    font-size: var(--font-size-caption, 12px);
    color: var(--color-ink-soft, #4a4f46);
  }
  .ask-owner {
    margin: 0;
    padding: var(--space-3, 12px);
    border-radius: var(--radius-card, 8px);
    background: var(--pill-wheat-bg, #e8d9b5);
    color: var(--pill-wheat-fg, #8a6722);
  }
</style>
