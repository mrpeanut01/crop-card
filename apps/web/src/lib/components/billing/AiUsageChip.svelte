<script lang="ts">
  import { onMount } from 'svelte';
  import AiBudgetMeter from './AiBudgetMeter.svelte';
  import type { AiUsageSnapshot } from '$lib/billing/plans';
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';

  interface Props {
    /** Show the meter only once the month's AI help has run out. */
    onlyWhenOut?: boolean;
    refreshKey?: unknown;
    /** Show the day's AI planning runs instead of the monthly budget. */
    planning?: boolean;
  }

  const { onlyWhenOut = false, refreshKey, planning = false }: Props = $props();

  const tr = $derived(createT(page.data?.locale));

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

{#if planning && usage && aiAvailable && !usage.aiOff}
  {@const left = Math.max(0, usage.planning.perDay - usage.planning.usedToday)}
  <p
    class="chip planning"
    data-testid="ai-planning-left"
    data-left={usage.planning.monthlyExhausted ? 0 : left}
  >
    {#if usage.planning.monthlyExhausted}
      {tr('billing.chip.monthlyUsed')}
    {:else if left > 0}
      {tr('billing.chip.left', {
        count: usage.planning.perDay,
        left,
        perDay: usage.planning.perDay
      })}
    {:else}
      {tr('billing.chip.dailyUsed', { perDay: usage.planning.perDay })}
    {/if}
  </p>
{:else if !planning && visible && usage}
  <div class="chip">
    <AiBudgetMeter {usage} {isOwner} compact />
  </div>
{/if}

<style>
  .chip {
    margin: 8px 0;
    max-width: 420px;
  }
  .planning {
    font-size: 0.85rem;
    color: var(--color-ink-soft);
  }
</style>
