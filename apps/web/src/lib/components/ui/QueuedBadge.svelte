<script lang="ts">
  import { CloudOff } from 'lucide-svelte';

  interface Props {
    label?: string;
  }

  const { label = 'Will save when online' }: Props = $props();
</script>

<span class="queued" data-queued title="Saved on this device. It uploads when you have signal.">
  <CloudOff size={13} strokeWidth={2} aria-hidden="true" />
  <span>{label}</span>
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
