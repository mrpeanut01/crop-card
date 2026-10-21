<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import HarvestSchedulePanel from '$lib/components/garden/HarvestSchedulePanel.svelte';
  import HarvestTimingLine from '$lib/components/garden/HarvestTimingLine.svelte';
  import { createT, type MessageKey } from '$lib/i18n';
  import { fmt } from '$lib/prefsState.svelte';
  import { goalLineText, preservingMethodLabel } from '$lib/garden/pantryText';
  import { infuseGoalMedia, weekOf } from '$lib/garden/harvestSchedule';
  import { pantryCutTaskText, pantryCutTemplateKey } from '$lib/garden/pantryCutTask';
  import { infuseMethodLabel, infuseSafetyLine } from '$lib/garden/infuse';
  import type { SchedulePlantingView } from '$lib/garden/harvestScheduleApi';

  const { data } = $props();
  const tr = $derived(createT(page.data?.locale));
  const locale = $derived(page.data?.locale ?? null);
  const schedule = $derived(data.schedule);
  const names = $derived(
    new Map(schedule.plantings.map((p) => [p.cropPluginId, p.cropName] as const))
  );

  const keptByCrop = $derived.by(() => {
    const out = new Map<string, { cropName: string; rows: typeof data.kept }>();
    for (const k of data.kept) {
      const entry = out.get(k.cropPluginId) ?? { cropName: k.cropName, rows: [] };
      entry.rows.push(k);
      out.set(k.cropPluginId, entry);
    }
    return [...out.entries()];
  });

  let ready = $state(false);
  onMount(() => {
    ready = true;
  });
  let busy = $state<string | null>(null);
  let messages = $state<Record<string, { text: string; error: boolean }>>({});

  function qty(n: number): string {
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }

  async function scheduleCut(p: SchedulePlantingView) {
    if (!p.nextCut) return;
    busy = p.plantingId;
    const scheduledFor = p.nextCut.fromMs;
    const week = p.nextCut.week || weekOf(scheduledFor);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'primary',
          ...(data.cutTasks[p.plantingId] ?? pantryCutTaskText(p.cropName)),
          cropId: p.plantingId,
          scheduledFor,
          pluginTemplateKey: pantryCutTemplateKey(p.plantingId, week)
        })
      }).catch(() => null);
      if (!res || !res.ok) {
        messages = {
          ...messages,
          [p.plantingId]: { text: tr('herbsc.pantry.scheduleFailed'), error: true }
        };
        return;
      }
      const out = (await res.json()) as { alreadyScheduled?: boolean };
      messages = {
        ...messages,
        [p.plantingId]: {
          text: out.alreadyScheduled
            ? tr('herbsc.pantry.alreadyScheduled')
            : tr('herbsc.pantry.scheduled', {
                date: fmt.day(new Date(scheduledFor).toISOString().slice(0, 10))
              }),
          error: false
        }
      };
    } finally {
      busy = null;
    }
  }
</script>

<svelte:head><title>{tr('herbsc.pantry.docTitle')} · CropCard</title></svelte:head>

<div class="pantry" data-testid="pantry" data-ready={ready}>
  <header>
    <Kicker>{tr('herbsc.pantry.kicker')}</Kicker>
    <h1 class="serif">{tr('herbsc.pantry.title')}</h1>
    <p class="sub">{tr('herbsc.pantry.season', { year: schedule.year })}</p>
    <p class="lede">{tr('herbsc.pantry.lede')}</p>
  </header>

  <section class="card" data-testid="pantry-kept">
    <h2>{tr('herbsc.pantry.kept')}</h2>
    {#if keptByCrop.length === 0}
      <p class="muted">{tr('herbsc.pantry.keptEmpty')}</p>
      <a class="btn" href="/harvest">{tr('herbsc.pantry.harvestLink')}</a>
    {:else}
      <ul class="list">
        {#each keptByCrop as [id, entry] (id)}
          <li data-testid="pantry-crop">
            <h3>{entry.cropName}</h3>
            <ul>
              {#each entry.rows as k (`${k.method}:${k.unit}`)}
                <li data-testid="pantry-kept-row">
                  <span
                    >{k.method
                      ? preservingMethodLabel(k.method, locale)
                      : tr('herbsc.method.notSaid')}</span
                  >
                  <span class="qty"
                    >{tr('herbsc.pantry.total', { qty: qty(k.quantity), unit: k.unit })}</span
                  >
                  <Provenance source="manual" compact />
                </li>
              {/each}
            </ul>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="card" data-testid="pantry-goals">
    <h2>{tr('herbsc.pantry.goals')}</h2>
    {#if !data.hasBrief}
      <p class="muted">{tr('herbsc.pantry.noBrief')}</p>
    {:else if schedule.goals.length === 0}
      <p class="muted">{tr('herbsc.pantry.noGoals')}</p>
    {:else}
      <ul class="list">
        {#each schedule.goals as g (g.goal)}
          <li data-testid="goal-line" data-status={g.status}>
            <span>{goalLineText(g, (id) => names.get(id) ?? id, locale)}</span>
            <Provenance source={g.provenance} compact />
            {#each infuseGoalMedia(g, schedule.plantings) as m (m)}
              <span class="safety" data-testid="infuse-safety" data-medium={m}
                >{infuseSafetyLine(m, locale)}</span
              >
            {/each}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="card" data-testid="pantry-herbs">
    <h2>{tr('herbsc.pantry.herbs')}</h2>
    {#if schedule.plantings.length === 0}
      <p class="muted" data-testid="pantry-no-herbs">{tr('herbsc.pantry.noHerbs')}</p>
      <a class="btn" href="/plan">{tr('herbsc.pantry.planLink')}</a>
    {:else}
      <ul class="list">
        {#each schedule.plantings as p (p.plantingId)}
          <li data-testid="pantry-herb">
            <h3>{p.cropName} <span class="muted">{p.blockName}</span></h3>
            {#if p.preserving.length === 0}
              <p class="muted">{tr('herbsc.preserve.none')}</p>
            {:else}
              <p>
                <span class="muted">{tr('herbsc.pantry.keepsBy')}</span>
                {#each p.preserving as r (`${r.method}:${r.medium ?? ''}`)}
                  <span class="chip"
                    >{tr(`herbsc.suit.${r.suitability}` as MessageKey, {
                      method: r.medium
                        ? infuseMethodLabel(r.medium, locale)
                        : preservingMethodLabel(r.method, locale)
                    })}</span
                  >
                  {#if r.medium}
                    <span class="safety" data-testid="infuse-safety" data-medium={r.medium}
                      >{infuseSafetyLine(r.medium, locale)}</span
                    >
                  {/if}
                {/each}
                <Provenance source="plugin" compact />
              </p>
            {/if}
            <HarvestTimingLine hints={p.timing ?? []} />
            {#if p.nextCut}
              <p>{tr('herbsc.pantry.nextCut', { date: fmt.day(p.nextCut.week) })}</p>
              {#if data.canWrite}
                <button
                  type="button"
                  class="btn"
                  disabled={!ready || busy === p.plantingId}
                  data-testid="schedule-cut"
                  onclick={() => scheduleCut(p)}>{tr('herbsc.pantry.scheduleCut')}</button
                >
              {/if}
            {:else}
              <p class="muted">{tr('herbsc.pantry.noNextCut')}</p>
            {/if}
            {#if messages[p.plantingId]}
              <p
                class={messages[p.plantingId].error ? 'error' : 'status'}
                role={messages[p.plantingId].error ? 'alert' : 'status'}
              >
                {messages[p.plantingId].text}
              </p>
            {/if}
          </li>
        {/each}
      </ul>
      {#if !data.canWrite}<p class="muted">{tr('herbsc.pantry.readOnly')}</p>{/if}
    {/if}
  </section>

  <HarvestSchedulePanel {schedule} showGoals={false} showTiming={false} />
</div>

<style>
  .pantry {
    max-width: 720px;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  h1 {
    margin: 0;
  }
  h2 {
    margin: 0 0 var(--space-2);
    font-size: 1.1rem;
  }
  h3 {
    margin: 0;
    font-size: 1rem;
  }
  .sub,
  .muted {
    color: var(--color-ink-soft);
    margin: 0;
  }
  .lede {
    margin: var(--space-1) 0 0;
  }
  .card {
    background: var(--color-surface, var(--color-cream));
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-card, 12px);
    padding: var(--space-3);
    margin: 0;
    display: grid;
    gap: var(--space-2);
  }
  .list,
  .list ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .list li li,
  [data-testid='goal-line'] {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 10px;
    overflow-wrap: anywhere;
  }
  .qty {
    font-weight: 600;
  }
  .chip {
    display: inline-block;
    padding: 2px 8px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-pill, 999px);
    font-size: 14px;
  }
  p {
    margin: 0;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    padding: 0 16px;
    border-radius: var(--radius-input, 8px);
    border: 1px solid var(--color-forest);
    background: var(--color-forest);
    color: white;
    font: inherit;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
    justify-self: start;
  }
  .btn:disabled {
    opacity: 0.6;
  }
  .error {
    color: var(--color-rust);
  }
  .safety {
    display: block;
    flex-basis: 100%;
    color: var(--color-ink);
    font-size: 0.92rem;
  }
</style>
