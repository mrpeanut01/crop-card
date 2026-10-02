<script lang="ts">
  import { CloudOff } from 'lucide-svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  interface Props {
    label?: string;
  }

  const { label }: Props = $props();
  const tr = $derived(createT(page.data?.locale));
</script>

<span class="queued" data-queued title={tr('ui.queued.title')}>
  <CloudOff size={13} strokeWidth={2} aria-hidden="true" />
  <span>{label ?? tr('ui.queued.label')}</span>
</span>

<style>
  .queued {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    font-size: var(--font-size-meta);
    font-weight: 600;
    background: var(--pill-wheat-bg);
    color: var(--pill-wheat-fg);
    border: 1px solid var(--pill-wheat-bd);
    white-space: nowrap;
  }
</style>
