<script lang="ts">
  import ForageAdvisoryPanel from '$lib/components/forage/ForageAdvisoryPanel.svelte';
  import { ForageAdvisoryCache } from '$lib/client/forageAdvisory.svelte';
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';

  interface Props {
    /** The destination Area. */
    fieldId: string;
    where?: string | null;
  }

  const { fieldId, where = null }: Props = $props();
  const tr = $derived(createT(page.data?.locale));
  const cache = new ForageAdvisoryCache();

  $effect(() => {
    if (fieldId) void cache.load({ fieldId });
  });

  const entry = $derived(cache.get({ fieldId }));
</script>

{#if entry}
  <div class="forage-callout" data-testid="forage-callout">
    <ForageAdvisoryPanel advisory={entry.advisory} failed={entry.failed} {where} />
    {#if entry.advisory?.items.length}
      <a class="record" href={entry.advisory.recordHref}>{tr('forage.record')}</a>
    {/if}
  </div>
{/if}

<style>
  .forage-callout {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }
  .record {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    min-height: 48px;
    color: var(--color-forest);
    font-weight: 600;
  }
</style>
