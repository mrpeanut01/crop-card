<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import '$lib/components/animals/animalForms.css';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import HoldChips from '$lib/components/animals/HoldChips.svelte';
  import ProductionForm from '$lib/components/animals/ProductionForm.svelte';
  import HoldVoidPanel from '$lib/components/records/HoldVoidPanel.svelte';
  import { errorText, useLabel } from '$lib/components/animals/labels';
  import type { FoodStop } from '$lib/animals/holdCopy';
  import { formatInstant } from '$lib/prefs';
  import { lateLabel } from '$lib/records/lateLabel';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  const { data } = $props();
  const tr = $derived(createT(page.data?.locale));

  const subject = $derived(data.subject);
  const prefs = $derived({ timeZone: data.timeZone, units: 'us' as const });
  const defaultKind = $derived(
    data.subject.speciesId === 'cattle' ||
      data.subject.speciesId === 'goat' ||
      data.subject.speciesId === 'sheep'
      ? ('milk' as const)
      : data.subject.speciesId === 'chicken' || data.subject.speciesId === 'duck'
        ? ('eggs' as const)
        : ('weight' as const)
  );

  let status = $state<string | null>(null);
  let stopText = $state<string | null>(null);
  let actionError = $state<string | null>(null);

  function stopped(stop: FoodStop) {
    status = null;
    stopText = `Stopped: ${stop.error}`;
  }

  async function done(text: string, warnings: string[]) {
    stopText = null;
    status = warnings.length ? `${text} ${warnings.join(' ')}` : text;
    await invalidateAll();
  }

  async function markThrownOut(id: string) {
    actionError = null;
    try {
      const res = await fetch(`/api/animals/production/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ use: 'discard' })
      });
      if (!res.ok) {
        actionError = await errorText(res, tr);
        return;
      }
      status = tr('animals.log.changedThrownOut');
      await invalidateAll();
    } catch {
      actionError = tr('animals.offline');
    }
  }
</script>

<svelte:head>
  <title>{tr('animals.eggsMilkWeights')} · {subject.name} · CropCard</title>
</svelte:head>

<div class="record-page">
  <nav class="crumbs" aria-label={tr('animals.breadcrumb')}>
    <a href={subject.detailHref}>{subject.name}</a>
    <a href="/animals/{subject.id}/health">{tr('animals.health')}</a>
  </nav>

  <header>
    <Kicker>{subject.speciesName} · {tr('animals.eggsMilkWeights')}</Kicker>
    <h1 class="serif">{subject.name}</h1>
  </header>

  <HoldChips
    holds={data.holds}
    foods={data.foods}
    timeZone={data.timeZone}
    isOwner={data.isOwner}
    healthHref="/animals/{subject.id}/health"
  />

  <div class="live" aria-live="assertive" role="status" data-testid="log-status">
    {#if stopText}<p class="af-error">{stopText}</p>{/if}
    {#if status}<p class="af-ok">{status}</p>{/if}
  </div>
  {#if actionError}<p class="af-error" role="alert">{actionError}</p>{/if}

  {#if data.canLog}
    <section aria-label={tr('animals.log.aria')}>
      <ProductionForm
        subjectType={subject.type}
        subjectId={subject.id}
        {defaultKind}
        isOwner={data.isOwner}
        onStopped={stopped}
        onDone={done}
      />
    </section>
  {/if}

  <section aria-labelledby="logs-h">
    <h2 id="logs-h" class="section-title">{tr('animals.log.recent')}</h2>
    {#if data.logs.length === 0}
      <p class="af-help">{tr('animals.log.none')}</p>
    {:else}
      <ul class="rows">
        {#each data.logs as l (l.id)}
          <li class="row">
            <div class="row-main">
              <strong>{l.quantity} {l.unit}</strong>
              <span>{l.kind === 'weight' ? tr('animals.prod.weight') : useLabel(tr, l.use)}</span>
              {#if l.recordedLate}
                <Pill tone="wheat">{lateLabel(true, l.daysLate, page.data?.locale)}</Pill>
              {/if}
              {#if l.inHold}
                <Pill tone="rust">Inside a hold</Pill>
              {/if}
            </div>
            <p class="meta">{formatInstant(l.occurredAt, prefs)}</p>
            {#if data.canLog && (l.use === 'food' || l.use === 'sale')}
              <button type="button" class="af-ghost" onclick={() => markThrownOut(l.id)}>
                {tr('animals.log.markThrownOut')}
              </button>
            {/if}
            <HoldVoidPanel
              url="/api/animals/production/{l.id}/void"
              canVoidHolds={data.canVoidHolds}
              voidableUntilMs={l.voidableUntilMs}
              timeZone={data.timeZone}
              onVoided={() => done('Voided.', [])}
            />
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  .record-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    max-width: 720px;
    min-width: 0;
  }
  .crumbs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    font-size: var(--font-size-caption);
  }
  .crumbs a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
  }
  h1 {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .live:empty {
    display: none;
  }
  .section-title {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-card-title);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .row {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--card-padding);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    background: var(--color-paper);
    min-width: 0;
  }
  .row-main {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  .meta {
    margin: 0;
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
  }
</style>
