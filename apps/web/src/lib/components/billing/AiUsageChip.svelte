<script lang="ts">
  import { onMount } from 'svelte';
  import AiBudgetMeter from './AiBudgetMeter.svelte';
  import type { AiUsageSnapshot } from '$lib/billing/plans';

  interface Props {
    /** Show the meter only once the month's AI help has run out. */
    onlyWhenOut?: boolean;
    refreshKey?: unknown;
  }

  const { onlyWhenOut = false, refreshKey }: Props = $props();

  let usage = $state<AiUsageSnapshot | null>(null);
  let isOwner = $state(false);
  let aiAvailable = $state(false);
  let mounted = $state(false);

  async function load() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    try {
      const res = await fetch('/api/ai/usage', { headers: { accept: 'application/json' } });
      if (!res.ok) return;
      const body = (await res.json()) as {
        usage: AiUsageSnapshot;
        isOwner: boolean;
        aiAvailable: boolean;
      };
      usage = body.usage;
      isOwner = body.isOwner;
      aiAvailable = body.aiAvailable;
    } catch {
      usage = null;
    }
  }

  onMount(() => {
    mounted = true;
  });

  $effect(() => {
    void refreshKey;
    if (mounted) void load();
  });

  const visible = $derived(
    !!usage &&
      (aiAvailable || usage.monthlyUsdSoFar > 0 || usage.aiOff) &&
      (!onlyWhenOut || usage.exhausted || usage.aiOff)
  );
</script>

{#if visible && usage}
  <div class="chip">
    <AiBudgetMeter {usage} {isOwner} compact />
  </div>
{/if}

<style>
  .chip {
    margin: 8px 0;
    max-width: 420px;
  }
</style>
