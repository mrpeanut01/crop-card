<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import HarvestTimingLine from './HarvestTimingLine.svelte';
  import { createT } from '$lib/i18n';
  import { fmt } from '$lib/prefsState.svelte';
  import { goalLineText } from '$lib/garden/pantryText';
  import type { HarvestScheduleResponse } from '$lib/garden/harvestScheduleApi';

  interface Props {
    /** The schedule, when the page already loaded it. Without it the panel
     *  fetches its own for `areaId` (or the whole farm). */
    schedule?: HarvestScheduleResponse | null;
    areaId?: string | null;
    /** Show the brief's goal lines under the weeks. */
    showGoals?: boolean;
    /** Show each planting's sourced cutting stage (#867); off where the
     *  page already shows it per herb. */
    showTiming?: boolean;
  }

  const { schedule = null, areaId = null, showGoals = true, showTiming = true }: Props = $props();

  const tr = $derived(createT(page.data?.locale));
  const locale = $derived(page.data?.locale ?? null);

  let fetched = $state<HarvestScheduleResponse | null>(null);
  let failed = $state(false);
  const data = $derived(schedule ?? fetched);
  const names = $derived(
    new Map((data?.plantings ?? []).map((p) => [p.cropPluginId, p.cropName] as const))
  );

  onMount(() => {
    if (schedule) return;
    const q = areaId ? `?areaId=${encodeURIComponent(areaId)}` : '';
    fetch(`/api/garden/harvest-schedule${q}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        fetched = (await res.json()) as HarvestScheduleResponse;
      })
      .catch(() => {
        failed = true;
      });
  });

  function day(ms: number): string {
    return fmt.day(new Date(ms).toISOString().slice(0, 10));
  }
</script>

<section class="harvest-plan" data-testid="harvest-schedule-panel" aria-labelledby="harvest-plan-h">
  <h2 id="harvest-plan-h">{tr('herbsc.title')}</h2>
  {#if !data}
    <p class="muted">{failed ? tr('herbsc.sched.unavailable') : tr('herbsc.sched.loading')}</p>
  {:else}
    <p class="muted">{tr('herbsc.sched.noAmounts')}</p>
    {#if data.weeks.length === 0}
      <p class="muted" data-testid="harvest-schedule-empty">{tr('herbsc.sched.empty')}</p>
    {:else}
      <ol class="weeks">
        {#each data.weeks as w (w.week)}
          <li data-testid="harvest-week">
            <h3>{tr('herbsc.sched.week', { date: fmt.day(w.week) })}</h3>
            <ul>
              {#each w.cuts as c (c.plantingId + c.fromMs)}
                <li>
                  <span class="crop">{c.cropName}</span>
                  <span class="muted">{c.blockName}</span>
                  <span
                    >{c.kind === 'window'
                      ? tr('herbsc.sched.window')
                      : tr('herbsc.sched.again')}</span
                  >
                  <span class="muted"
                    >{tr('herbsc.sched.range', { from: day(c.fromMs), to: day(c.toMs) })}</span
                  >
                  <Provenance source={c.provenance} compact />
                </li>
              {/each}
            </ul>
          </li>
        {/each}
      </ol>
    {/if}
    {#if data.plantings.length > 0}
      <ul class="notes">
        {#each data.plantings as p (p.plantingId)}
          <li>
            <span class="crop">{p.cropName}</span>
            <span>
              {p.firstWindowOnly ? tr('herbsc.sched.firstOnly') : ''}
              {p.endsAt === 'season-end'
                ? tr('herbsc.sched.endsSeason')
                : tr('herbsc.sched.endsFrost')}
            </span>
            {#if showTiming}<HarvestTimingLine hints={p.timing ?? []} />{/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if showGoals && data.goals.length > 0}
      <h3>{tr('herbsc.pantry.goals')}</h3>
      <ul class="goals">
        {#each data.goals as g (g.goal)}
          <li data-testid="goal-line" data-status={g.status}>
            <span>{goalLineText(g, (id) => names.get(id) ?? id, locale)}</span>
            <Provenance source={g.provenance} compact />
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  .harvest-plan {
    display: grid;
    gap: var(--space-2, 8px);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card, 10px);
    padding: var(--space-3, 12px);
    background: var(--color-paper);
  }
  h2 {
    margin: 0;
    font-size: 1.1rem;
  }
  h3 {
    margin: 0;
    font-size: 1rem;
  }
  .muted {
    color: var(--color-ink-soft);
    margin: 0;
  }
  ol,
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  li li,
  .notes li,
  .goals li {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    align-items: center;
    min-height: 32px;
    overflow-wrap: anywhere;
  }
  .crop {
    font-weight: 600;
  }
</style>
