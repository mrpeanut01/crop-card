<script lang="ts">
  import CardView from './CardView.svelte';
  import type { CardModel } from '$lib/cards/model';
  import type { Prefs } from '$lib/prefs';

  interface Props {
    cards: CardModel[];
    prefs?: Prefs;
    now?: number;
  }

  const { cards, prefs, now }: Props = $props();
</script>

{#if cards.length}
  <section class="care" aria-labelledby="care-guide-heading" data-testid="care-guides">
    <h2 id="care-guide-heading" class="serif">How to care for it</h2>
    {#if cards.length === 1}
      <CardView card={cards[0]} {prefs} {now} />
    {:else}
      {#each cards as card, i (card.key)}
        <details open={i === 0}>
          <summary>{card.title}</summary>
          <CardView {card} {prefs} {now} />
        </details>
      {/each}
    {/if}
  </section>
{/if}

<style>
  .care {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    max-width: 640px;
    margin-top: var(--space-4);
  }
  h2 {
    font-size: var(--font-size-card-title);
    margin: 0;
  }
  details {
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    background: var(--color-paper);
    padding: 0 var(--space-2) var(--space-2);
  }
  summary {
    min-height: 48px;
    display: flex;
    align-items: center;
    font-weight: 600;
    cursor: pointer;
  }
  summary:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
</style>
