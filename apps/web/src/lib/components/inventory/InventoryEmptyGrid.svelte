<script lang="ts">
  import { INVENTORY_TYPES, INVENTORY_TYPE_LABELS, type InventoryType } from '$lib/inventory/types';

  interface Props {
    activeType: InventoryType;
    canAdd: boolean;
  }

  const { activeType, canAdd }: Props = $props();

  const HINTS: Record<InventoryType, string> = {
    pesticide: 'Herbicides, insecticides and fungicides on the shelf.',
    fertility: 'Fertilizer, compost and other amendments.',
    seed: 'Seed packets and bags, with their lot numbers.',
    crop: "A crop the library doesn't have yet.",
    sprayer: 'Backpack, ATV or boom sprayers.'
  };
</script>

<section class="inv-empty" aria-labelledby="inv-empty-title" data-testid="inventory-empty">
  <h2 id="inv-empty-title" class="serif">
    No {INVENTORY_TYPE_LABELS[activeType].toLowerCase()} yet
  </h2>
  {#if canAdd}
    <p class="lede">What would you like to add? Pick a kind and CropCard walks you through it.</p>
    <ul class="grid">
      {#each INVENTORY_TYPES as t (t)}
        <li>
          <a
            class="tile"
            class:active={t === activeType}
            href="/inventory/{t}/add"
            aria-current={t === activeType ? 'true' : undefined}
          >
            <span class="tile-title">{INVENTORY_TYPE_LABELS[t]}</span>
            <span class="tile-hint">{HINTS[t]}</span>
          </a>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="ask-owner" role="note">
      Ask the owner to add some. Everything they add shows up here.
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
