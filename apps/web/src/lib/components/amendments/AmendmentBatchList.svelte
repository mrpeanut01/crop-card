<script lang="ts">
  /** Phase 33C (M-41): the manure and compost rows on the unified
   *  inventory list. One card per batch with its carryover state. */
  import CarryoverStateBadge from './CarryoverStateBadge.svelte';
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  import { batchKindLabel } from '$lib/amendments/model';
  import { fmt } from '$lib/prefsState.svelte';
  import type { AmendmentRow } from '$lib/amendments/view';

  interface Props {
    rows: AmendmentRow[];
  }

  const { rows }: Props = $props();
  const locale = $derived(page.data?.locale);
  const tr = $derived(createT(locale));

  let search = $state('');
  const filtered = $derived(
    search.trim()
      ? rows.filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase()))
      : rows
  );
</script>

<div class="search-row">
  <input
    type="search"
    bind:value={search}
    placeholder={tr('amend.list.searchPh')}
    aria-label={tr('amend.list.searchAria')}
  />
  <span class="count mono"
    >{tr('amend.list.count', { shown: filtered.length, total: rows.length })}</span
  >
</div>

<ul class="batches" data-testid="amendment-list">
  {#each filtered as row (row.id)}
    <li>
      <a class="batch" href="/inventory/amendment/{encodeURIComponent(row.id)}">
        <span class="top">
          <span class="name">{row.name}</span>
          <CarryoverStateBadge state={row.state} />
        </span>
        <span class="meta">
          {batchKindLabel(row.kind, locale)} · {row.origin === 'bought'
            ? row.supplier
              ? tr('amend.header.boughtFrom', { supplier: row.supplier })
              : tr('amend.header.bought')
            : tr('amend.list.sources', { count: row.inputCount })} · {tr('amend.header.started', {
            date: fmt.day(row.startedAt)
          })}{row.closedAt ? ` · ${tr('amend.list.closed')}` : ''}
        </span>
      </a>
    </li>
  {:else}
    <li class="empty">{tr('amend.list.noMatch')}</li>
  {/each}
</ul>

<style>
  .search-row {
    display: flex;
    gap: 8px;
    align-items: center;
    margin: 12px 0;
  }
  .search-row input {
    flex: 1;
    min-width: 0;
    min-height: 48px;
    box-sizing: border-box;
    padding: 8px 10px;
    border: 1px solid var(--color-divider, #e5e7e0);
    border-radius: 6px;
  }
  .count {
    font-size: 0.8rem;
    color: var(--color-ink-muted, #6a6f63);
  }
  .batches {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .batch {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-height: 48px;
    padding: 12px 14px;
    border: 1px solid var(--color-divider, #e5e7e0);
    border-radius: 8px;
    background: var(--color-paper, #fff);
    color: var(--color-ink, #1c1c1c);
    text-decoration: none;
  }
  .batch:hover {
    border-color: var(--color-forest, #1f5e3a);
  }
  .top {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
  }
  .name {
    font-weight: 600;
    color: var(--color-forest-deep, #1f3522);
    overflow-wrap: anywhere;
  }
  .meta {
    font-size: 0.85rem;
    color: var(--color-ink-muted, #6a6f63);
  }
  .empty {
    color: var(--color-ink-muted, #6a6f63);
  }
</style>
