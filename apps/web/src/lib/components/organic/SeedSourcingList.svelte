<script lang="ts">
  import { fmt } from '$lib/prefsState.svelte';
  import {
    SEED_ORGANIC_STATUS_LABEL,
    SEED_SEARCH_FLAG_LABEL,
    seedSearchFlag,
    sortChecks,
    type SeedSourcingRow
  } from '$lib/stock/seedSourcing';

  /**
   * 33B (B-39, B-40). The seed sourcing list: every seed lot received or
   * planted in the window with its owner-entered status, the suppliers
   * checked and a "No search on file" flag. It reports what is on file;
   * whether a search was enough is the certifier's call.
   */
  interface Props {
    rows: SeedSourcingRow[];
  }

  const { rows }: Props = $props();
</script>

{#if rows.length === 0}
  <p class="empty">No seed lots were received or planted in this date range.</p>
{:else}
  <ul class="seed-list" data-testid="seed-sourcing-list">
    {#each rows as r (r.stockLotId)}
      {@const flag = seedSearchFlag(r)}
      <li>
        <div class="head">
          <a href="/inventory/seed/{encodeURIComponent(r.stockItemId)}">{r.itemName}</a>
          {#if r.lotNumber}<span class="muted">Lot {r.lotNumber}</span>{/if}
          <span class="muted">received {fmt.instant(r.receivedAt, 'date')}</span>
        </div>
        <div>
          Seed status (owner-entered):
          <strong>{r.status ? SEED_ORGANIC_STATUS_LABEL[r.status] : 'Not recorded'}</strong>
          {#if flag}<span class="flag">{SEED_SEARCH_FLAG_LABEL[flag]}</span>{/if}
        </div>
        {#if r.sourcesChecked.length > 0}
          <ul class="checks">
            {#each sortChecks(r.sourcesChecked) as c, i (i)}
              <li>{fmt.day(c.checkedAt)}, {c.supplier}: {c.result}</li>
            {/each}
          </ul>
        {/if}
        {#if r.unavailabilityNote}<p class="note">{r.unavailabilityNote}</p>{/if}
        {#if r.documentIds.length > 0}
          <p class="muted small">
            {r.documentIds.length} search evidence file{r.documentIds.length === 1 ? '' : 's'} attached
          </p>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .seed-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow-wrap: anywhere;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .head a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    font-weight: 600;
    color: var(--color-forest, #1f5e3a);
  }
  .checks {
    margin: 4px 0 0;
    padding-left: 18px;
  }
  .flag {
    margin-left: 6px;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--color-wheat-soft, #fbf3dc);
    border: 1px solid var(--color-wheat, #d9b45a);
    font-size: 0.8rem;
    font-weight: 600;
  }
  .note {
    margin: 4px 0 0;
    white-space: pre-wrap;
  }
  .empty,
  .muted {
    color: var(--color-ink-muted, #6a6f63);
  }
  .small {
    font-size: 0.8rem;
  }
</style>
