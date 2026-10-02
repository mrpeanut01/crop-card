<script lang="ts">
  import ForageAdvisoryPanel from './ForageAdvisoryPanel.svelte';
  import ForageTestForm from './ForageTestForm.svelte';
  import { ForageAdvisoryCache } from '$lib/client/forageAdvisory.svelte';
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';

  interface Props {
    cuttingId: string;
    /** Inspectors read only. */
    canRecord: boolean;
    /** Owner only: attach the lab report. */
    canAttach: boolean;
  }

  const { cuttingId, canRecord, canAttach }: Props = $props();
  const tr = $derived(createT(page.data?.locale));
  const cache = new ForageAdvisoryCache();
  let formOpen = $state(false);
  let saved = $state<string | null>(null);

  $effect(() => {
    void cache.load({ hayCuttingId: cuttingId });
  });

  const entry = $derived(cache.get({ hayCuttingId: cuttingId }));
</script>

<div class="hay-forage" data-testid="hay-forage">
  {#if entry}
    <ForageAdvisoryPanel
      advisory={entry.advisory}
      failed={entry.failed}
      showTargetTest
      open={!!entry.advisory?.targetTest}
    />
  {:else}
    <ForageAdvisoryPanel advisory={null} loading />
  {/if}
  {#if saved}<p class="saved" role="status">{saved}</p>{/if}
  {#if canRecord}
    {#if formOpen}
      <ForageTestForm
        target={{ hayCuttingId: cuttingId }}
        {canAttach}
        onSaved={async () => {
          formOpen = false;
          saved = tr('forage.saved');
          await cache.load({ hayCuttingId: cuttingId }, true);
        }}
        onCancel={() => (formOpen = false)}
      />
    {:else}
      <button
        class="record"
        type="button"
        onclick={() => {
          saved = null;
          formOpen = true;
        }}
      >
        {tr('forage.record')}
      </button>
    {/if}
  {/if}
</div>

<style>
  .hay-forage {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-2);
    min-width: 0;
  }
  .record {
    align-self: flex-start;
    min-height: 48px;
    padding: 0 var(--space-4);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    background: var(--color-paper);
    color: var(--color-ink);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .saved {
    margin: 0;
    color: var(--color-forest);
  }
</style>
