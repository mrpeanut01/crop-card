<script lang="ts">
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  import { fmt } from '$lib/prefsState.svelte';
  import {
    seedOrganicStatusLabel,
    seedSearchFlag,
    seedSearchFlagLabel,
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
  const tr = $derived(createT(page.data?.locale));
</script>

{#if rows.length === 0}
  <p class="empty">{tr('organic.seed.empty')}</p>
{:else}
  <ul class="seed-list" data-testid="seed-sourcing-list">
    {#each rows as r (r.stockLotId)}
      {@const flag = seedSearchFlag(r)}
      <li>
        <div class="head">
          <a href="/inventory/seed/{encodeURIComponent(r.stockItemId)}">{r.itemName}</a>
          {#if r.lotNumber}<span class="muted">{tr('organic.seed.lot', { lot: r.lotNumber })}</span
            >{/if}
          <span class="muted"
            >{tr('organic.seed.received', { date: fmt.instant(r.receivedAt, 'date') })}</span
          >
        </div>
        <div>
          {tr('organic.seed.statusLabel')}
          <strong
            >{r.status
              ? seedOrganicStatusLabel(r.status, page.data?.locale)
              : tr('organic.seed.notRecorded')}</strong
          >
          {#if flag}<span class="flag">{seedSearchFlagLabel(flag, page.data?.locale)}</span>{/if}
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
            {tr('organic.seed.files', { count: r.documentIds.length })}
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
