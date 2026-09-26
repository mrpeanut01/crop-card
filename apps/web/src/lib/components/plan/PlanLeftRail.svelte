<script lang="ts">
  import { Plus, Search } from 'lucide-svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import CardView from '$lib/components/cards/CardView.svelte';
  import { NO_AREA, type RailAreaCard } from '$lib/plan/planCards';
  import { currentPrefs } from '$lib/prefsState.svelte';

  interface Props {
    cards: RailAreaCard[];
    selectedAreaId?: string;
    onAddBlock?: () => void;
  }
  const { cards, selectedAreaId, onAddBlock }: Props = $props();

  let filterText = $state('');
  const query = $derived(filterText.trim().toLowerCase());
  const filtered = $derived(query ? cards.filter((c) => c.searchText.includes(query)) : cards);
  const areaCount = $derived(cards.filter((c) => c.areaId !== NO_AREA).length);
</script>

<aside class="rail" aria-label="Areas" data-sveltekit-noscroll data-sveltekit-keepfocus>
  <div class="rail-head">
    <div class="head-row">
      <Kicker>Areas · {areaCount}</Kicker>
      {#if onAddBlock}
        <button class="add" onclick={onAddBlock} title="New block" aria-label="New block">
          <Plus size={16} strokeWidth={1.75} />
        </button>
      {/if}
    </div>
    <div class="filter-wrap">
      <Search size={13} strokeWidth={1.75} class="filter-icon" />
      <input
        class="filter"
        type="search"
        placeholder="Filter Areas, beds or crops…"
        bind:value={filterText}
        aria-label="Filter Areas by name, bed or crop"
      />
    </div>
  </div>

  {#if filtered.length === 0}
    <div class="empty">
      {query ? `Nothing matches “${filterText.trim()}”.` : 'No Areas yet.'}
    </div>
  {:else}
    <ul class="cards" data-testid="plan-area-cards">
      {#each filtered as c (c.card.key)}
        <li data-area-id={c.areaId}>
          <CardView
            card={c.card}
            variant="compact"
            prefs={currentPrefs()}
            selected={c.areaId === selectedAreaId}
            factLimit={c.card.facts.length}
            showAsOf={false}
          >
            {#snippet actions()}
              {#if c.designer}
                <a class="designer" href={c.designer}>Open designer</a>
              {/if}
            {/snippet}
          </CardView>
        </li>
      {/each}
    </ul>
  {/if}
</aside>

<style>
  .rail {
    width: 300px;
    border-right: 1px solid var(--color-divider);
    background: var(--color-paper);
    overflow-y: auto;
    overflow-x: hidden;
    flex-shrink: 0;
  }
  .rail-head {
    padding: 20px 18px 14px;
    border-bottom: 1px solid var(--color-divider-soft, var(--color-divider));
  }
  .head-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .add {
    width: 48px;
    height: 48px;
    border-radius: 6px;
    background: transparent;
    border: 1px solid var(--color-divider);
    color: var(--color-forest-deep);
    cursor: pointer;
    display: grid;
    place-items: center;
    font-family: inherit;
  }
  .add:hover {
    border-color: var(--color-forest-deep);
    background: var(--color-cream);
  }
  .filter-wrap {
    margin-top: 10px;
    position: relative;
  }
  :global(.filter-wrap .filter-icon) {
    position: absolute;
    left: 10px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--color-ink-muted);
    pointer-events: none;
  }
  .filter {
    width: 100%;
    min-height: 48px;
    padding: 8px 10px 8px 32px;
    font-size: 14px;
    background: var(--color-cream);
    border: 1px solid var(--color-divider);
    border-radius: 6px;
    color: var(--color-ink);
    outline: none;
    font-family: inherit;
  }
  .filter:focus {
    border-color: var(--color-forest-deep);
  }
  .empty {
    padding: 14px 18px;
    color: var(--color-ink-soft);
    font-size: 13px;
    font-style: italic;
  }
  .cards {
    list-style: none;
    margin: 0;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .designer {
    display: flex;
    align-items: center;
    min-height: 48px;
    color: var(--color-forest-deep);
    font-weight: 600;
    text-decoration: underline;
  }
  @media (max-width: 900px) {
    .rail {
      width: 100%;
      max-height: 360px;
      border-right: none;
      border-bottom: 1px solid var(--color-divider);
    }
  }
</style>
