<script lang="ts">
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  import { fmt } from '$lib/prefsState.svelte';
  import { recordHref } from '$lib/cards/model';
  import type { ReEntryCardItem } from '$lib/today/reEntryCard';

  interface Props {
    items: ReEntryCardItem[];
  }

  const { items }: Props = $props();
  const tr = $derived(createT(page.data?.locale));
</script>

{#if items.length > 0}
  <section
    class="card rei-card"
    role="alert"
    aria-labelledby="rei-card-heading"
    data-testid="today-rei-card"
  >
    <h2 id="rei-card-heading">{tr('today.reEntry.heading')}</h2>
    <ul>
      {#each items as item (item.recordKind + ':' + item.recordId)}
        <li data-testid="today-rei-item">
          <strong>{item.blockName ?? tr('sprayui.removedBlock')}</strong>
          <span lang="en" data-english-only="safety"
            >{item.products.join(' + ')}: {#if item.clearAt !== null}REI in effect until {fmt.instant(
                item.clearAt,
                'datetime'
              )}.{:else}REI not known for every product. Check the label.{/if}</span
          >
          <a href={recordHref(item.recordKind, item.recordId)}>{tr('today.reEntry.openRecord')}</a>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .rei-card {
    border-left: 4px solid var(--color-rust, #ba4b38);
  }
  .rei-card h2 {
    color: var(--color-rust, #ba4b38);
  }
  .rei-card ul {
    margin: 0.5rem 0 0;
    padding: 0;
    list-style: none;
  }
  .rei-card li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 10px;
    overflow-wrap: anywhere;
  }
  .rei-card a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    font-weight: 600;
    color: var(--color-forest-deep);
  }
</style>
