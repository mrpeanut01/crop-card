<script lang="ts">
  import { grazingTimeHref, holdChips, type HoldSummaries } from '$lib/animals/holdCopy';
  import { FOODS, type Food } from '$lib/safety/animalWithdrawal';

  interface Props {
    holds: HoldSummaries | null | undefined;
    timeZone: string;
    /** The foods this animal gives; the rest are not shown. */
    foods?: readonly Food[];
    /** Owners get a pointer to where a missing withdrawal is added. */
    isOwner?: boolean;
    healthHref?: string | null;
  }

  const { holds, timeZone, foods = FOODS, isOwner = false, healthHref = null }: Props = $props();
  const chips = $derived(holdChips(holds, timeZone, foods));
  const withdrawalUnknown = $derived(chips.some((c) => c.withdrawalUnknown));
  const grazingUnknown = $derived(chips.some((c) => c.grazingUnknown));
  const grazingArea = $derived.by(() => {
    if (!holds) return null;
    for (const food of foods) {
      const h = holds[food];
      const id = h?.grazingUnknownFieldIds?.[0] ?? h?.grazedFieldIds?.[0];
      if (id) return id;
    }
    return null;
  });
</script>

{#if chips.length > 0}
  <div class="holds" data-testid="hold-chips">
    <ul lang="en" data-english-only="safety">
      {#each chips as c (c.food)}
        <li class="chip {c.tone}">
          <strong>{c.title}</strong>
          {#if c.detail}<span class="detail">{c.detail}</span>{/if}
        </li>
      {/each}
    </ul>
    {#if withdrawalUnknown}
      <p class="hint" lang="en" data-english-only="safety">
        {#if isOwner}
          {#if healthHref}Add the withdrawal from the label or your vet on the <a href={healthHref}
              >health page</a
            >.{:else}Add the withdrawal from the label or your vet.{/if}
        {:else}
          Ask the owner to add the withdrawal from the label or the vet.
        {/if}
      </p>
    {/if}
    {#if grazingUnknown}
      <p class="hint" lang="en" data-english-only="safety">
        {#if isOwner && grazingArea}
          <a href={grazingTimeHref(grazingArea)}>Add the grazing time from the label</a>.
        {:else}
          Ask the owner to add the grazing time from the label.
        {/if}
      </p>
    {/if}
  </div>
{/if}

<style>
  .holds {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .chip {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 48px;
    justify-content: center;
    padding: 6px 12px;
    border-radius: var(--radius-card);
    border: 2px solid var(--color-rust);
    background: var(--color-paper);
    color: var(--color-ink);
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  .chip strong {
    color: var(--color-rust);
    font-weight: 700;
  }
  .chip.unknown {
    border-color: var(--color-wheat-deep, var(--color-rust));
  }
  .chip.prohibited {
    background: var(--pill-rust-bg, var(--color-paper));
  }
  .detail {
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
  }
  .hint {
    margin: 0;
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
  }
  .hint a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
  }
</style>
