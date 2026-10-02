<script lang="ts">
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  interface Props {
    online: boolean;
    pendingCount: number | null;
  }

  const { online, pendingCount }: Props = $props();
  const tr = $derived(createT(page.data?.locale));

  const label = $derived.by(() => {
    if (!online) {
      const n = pendingCount ?? 0;
      return n > 0 ? tr('ui.offline.queued', { count: n }) : tr('ui.offline.offline');
    }
    if (pendingCount && pendingCount > 0) return tr('ui.offline.syncing', { count: pendingCount });
    return tr('ui.offline.synced');
  });
</script>

<div class="indicator" class:offline={!online} class:queued={(pendingCount ?? 0) > 0} title={label}>
  <span class="dot" aria-hidden="true"></span>
  <span class="label mono">{label}</span>
</div>

<style>
  .indicator {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--font-size-meta);
    color: var(--color-ink-muted);
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    white-space: nowrap;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: var(--radius-pill);
    background: var(--color-forest);
  }
  .queued .dot {
    background: var(--color-wheat);
  }
  .offline .dot {
    background: var(--color-rust);
  }
</style>
