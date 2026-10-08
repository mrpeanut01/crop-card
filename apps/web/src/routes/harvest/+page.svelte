<script lang="ts">
  import { isUpdatingResponse, retryAfterSeconds, updatingQueuedNotice } from '$lib/updating';
  import { createT } from '$lib/i18n';
  import { cropDisplayName } from '$lib/i18n/cropName';
  import { onMount, tick, untrack } from 'svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import type { PlantingHarvestStatus } from './+page.server';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Banner from '$lib/components/ui/Banner.svelte';
  import HarvestRouter from '$lib/components/harvest/HarvestRouter.svelte';
  import { reHarvestArchetype, reHarvestLabel } from '$lib/components/harvest/reHarvest';
  import { fmt, currentPrefs } from '$lib/prefsState.svelte';
  import { ymdInZone } from '$lib/prefs';
  import { harvestYtdCsv } from '$lib/harvest/ytdCsv';
  import SetupSheet from '$lib/components/setup/SetupSheet.svelte';
  import { focusAfterSetup } from '$lib/components/setup/focusAfterSetup';
  import SetupCallout from '$lib/components/setup/SetupCallout.svelte';
  import SetupPlantingBackfill from '$lib/components/setup/SetupPlantingBackfill.svelte';
  import type { SetupPlantingResult } from '$lib/setup/types';
  import { recordSaleOffline, recordSaleHref, type SaleLink } from '$lib/finance/harvestSale';
  import DispositionPanel from '$lib/components/harvest/DispositionPanel.svelte';
  import TaskCloseNote from '$lib/components/tasks/TaskCloseNote.svelte';
  import {
    taskClosedBy,
    type RecordTaskClose,
    type TaskRecordTarget
  } from '$lib/tasks/recordClose';

  let { data } = $props();
  const tr = $derived(createT(data.locale));
  const harvestCropName = (id: string) =>
    cropDisplayName(id, data.harvestCropNames[id] ?? id, data.locale);
  // Kept from the first load: the reload after a save no longer finds the
  // task open, and the saved line still has to show.
  const taskCtx = untrack(() => data.taskContext);
  let taskOutcome = $state<RecordTaskClose | null>(null);
  let taskQueued = $state(false);
  let taskRecord = $state<TaskRecordTarget>({});
  // Once a save closed the task, later saves on this page leave it alone.
  let taskClosed = $state(false);
  const openTask = $derived(taskClosed ? null : taskCtx);

  let recordingFor = $state<string | null>(untrack(() => data.focusPlantingId ?? null));
  // Phase 25c (#88) — HarvestRouter owns the in-form state now; we
  // keep recordingFor + lastError at this level so the parent decides
  // which planting's renderer is active and surfaces error state.
  let lastError = $state<string | null>(null);
  // #316 — non-error success/offline notice (e.g. "queued offline").
  let lastNotice = $state<string | null>(null);
  // #324 — PHI warning surfaced after a successful commit (non-blocking).
  let phiWarning = $state<string | null>(null);
  // F2-15: after a saved harvest, owners get a secondary "Record a sale".
  let lastSale = $state<(SaleLink & { name: string }) | null>(null);
  let saleQueued = $state<string | null>(null);
  let online = $state(true);
  // Phase 33B (B-36): the "Where did it go?" sheet, for one saved harvest.
  let dispositionFor = $state<string | null>(null);
  const dispositionHarvest = $derived(
    dispositionFor ? (data.recordedHarvests.find((h) => h.id === dispositionFor) ?? null) : null
  );
  function whereCount(id: string): number {
    return data.dispositions[id]?.length ?? 0;
  }

  $effect(() => {
    online = navigator.onLine !== false;
    const up = () => (online = true);
    const down = () => (online = false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  });

  onMount(async () => {
    if (data.focusPlantingId) {
      await tick();
      const el = document.getElementById(`planting-${data.focusPlantingId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });

  function startRecord(plantingId: string) {
    recordingFor = plantingId;
    lastError = null;
    phiWarning = null;
  }

  function cancelRecord() {
    recordingFor = null;
  }

  let plantingSheetOpen = $state(false);
  async function onPlantingAdded(r: SetupPlantingResult) {
    plantingSheetOpen = false;
    await invalidateAll();
    const added = data.plantings.find((p) => p.plantingId === r.plantingId);
    if (added?.harvestStyle === 'forage-cutting-cycle') {
      await goto(
        `/hay?block=${encodeURIComponent(r.blockId)}&crop=${encodeURIComponent(r.plantingId)}`
      );
      return;
    }
    startRecord(r.plantingId);
    await tick();
    document
      .getElementById(`planting-${r.plantingId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await focusAfterSetup(`#planting-${CSS.escape(r.plantingId)}`);
  }

  /** Phase 25c (#88) — HarvestRouter renderer commit hook. Builds the
   *  POST body, surfaces the new event id on success, reloads, and
   *  routes the error message through `lastError` so the active
   *  renderer can render it. */
  async function commitFromRenderer(
    planting: PlantingHarvestStatus,
    input: { quantity?: string; lotNumber?: string; moisturePct?: number }
  ): Promise<string | null> {
    lastError = null;
    lastNotice = null;
    if (!taskClosed) {
      taskOutcome = null;
      taskQueued = false;
      taskRecord = { blockId: planting.blockId, cropPluginId: planting.cropPluginId };
    }
    const body = {
      blockId: planting.blockId,
      cropPluginId: planting.cropPluginId,
      quantity: input.quantity,
      lotNumber: input.lotNumber,
      // #322 — structured moisture reaches the kernel gate.
      moisturePct: input.moisturePct,
      ...(openTask ? { taskId: openTask.id } : {})
    };
    try {
      // #316 (NFR-02) — offline path. Queue the harvest locally; the sync
      // queue replays it against /api/harvest/record (server re-runs the
      // moisture kernel) on reconnect. No invalidateAll — the server has
      // nothing new yet.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        const { enqueueRecord } = await import('$lib/client/syncQueue');
        const queueId = await enqueueRecord('harvest', body);
        recordingFor = null;
        lastNotice = tr('harvestui.queued');
        taskQueued = !!openTask || taskQueued;
        lastSale = null;
        saleQueued = planting.varietyDisplayName;
        return queueId;
      }
      const res = await fetch('/api/harvest/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (isUpdatingResponse(res)) {
        const { enqueueRecord, scheduleDrain } = await import('$lib/client/syncQueue');
        const queueId = await enqueueRecord('harvest', body);
        scheduleDrain((retryAfterSeconds(res) + 2) * 1000);
        recordingFor = null;
        lastNotice = updatingQueuedNotice(data.locale);
        taskQueued = !!openTask || taskQueued;
        return queueId;
      }
      const out = await res.json();
      if (!res.ok) {
        // #341 — surface the API's human `message` (with threshold) instead
        // of the raw error code, so the operator reads a plain sentence.
        const thresh =
          typeof out.thresholdPct === 'number' ? ` (threshold ${out.thresholdPct}%)` : '';
        lastError = out.message ? `${out.message}${thresh}` : (out.error ?? `HTTP ${res.status}`);
        return null;
      }
      // #324 — non-blocking PHI warning: the record committed, but surface
      // the label-interval caution so the operator can act on it.
      phiWarning = out?.phiWarning?.message ?? null;
      if (!taskClosed) {
        taskOutcome = out?.taskClose ?? null;
        taskClosed = taskClosedBy(taskOutcome);
      }
      recordingFor = null;
      const eventId = (out?.event?.id as string | undefined) ?? null;
      lastSale = eventId
        ? {
            harvestEventId: eventId,
            cropId: planting.plantingId,
            name: planting.varietyDisplayName
          }
        : null;
      saleQueued = null;
      await invalidateAll();
      return eventId;
    } catch (e) {
      // #316 — transient network failure while "online": queue instead of
      // losing the harvest.
      const msg = e instanceof Error ? e.message : String(e);
      const isNetworkErr = e instanceof TypeError && /(fetch|network|failed)/i.test(msg);
      if (isNetworkErr) {
        try {
          const { enqueueRecord } = await import('$lib/client/syncQueue');
          const queueId = await enqueueRecord('harvest', body);
          recordingFor = null;
          lastNotice = tr('harvestui.queued');
          taskQueued = !!openTask || taskQueued;
          return queueId;
        } catch (queueErr) {
          lastError = tr('harvestui.errQueue', {
            msg: queueErr instanceof Error ? queueErr.message : String(queueErr)
          });
          return null;
        }
      }
      lastError = msg;
      return null;
    }
  }

  function windowFromPick(p: PlantingHarvestStatus): boolean {
    const forage =
      p.archetype === 'forage-cutting-cycle' || p.harvestStyle === 'forage-cutting-cycle';
    return (
      forage && p.rendererData.priorPickCount > 0 && !!p.rendererData.hayOperations?.cutIntervalDays
    );
  }

  function fmtWindowDay(ms: number, p: PlantingHarvestStatus) {
    return windowFromPick(p) ? fmt.instant(ms, 'date') : fmt.day(ms);
  }

  function fmtRange(p: PlantingHarvestStatus) {
    if (!p.windowStartMs || !p.windowEndMs) return tr('harvestui.unknown');
    return `${fmtWindowDay(p.windowStartMs, p)} – ${fmtWindowDay(p.windowEndMs, p)}`;
  }

  /** Sprint 4 (#197 / CT-HS-001) — archetypes that yield multiple
   *  picks over the season. For these the "Record harvest" form stays
   *  visible after the first pick so the operator can log 2nd, 3rd,
   *  Nth cut/pick. The other archetypes (single-cut-grain, dry-seed,
   *  cure-then-store, etc.) keep the original gate. */
  function allowsReHarvest(p: PlantingHarvestStatus): boolean {
    return reHarvestArchetype(p) !== null;
  }

  /** Sprint 4 (#198 / CT-HS-002) — the form is rendered for too-early
   *  + in-window + past plantings so operators can both jump the gun
   *  (weather-shortened seasons) and backfill records weeks late.
   *  Banner copy on the renderer distinguishes the three states. */
  function showHarvestForm(p: PlantingHarvestStatus): boolean {
    if (p.alreadyHarvested && !allowsReHarvest(p)) return false;
    return (
      p.status === 'in-window' ||
      p.status === 'too-early' ||
      p.status === 'past' ||
      p.status === 'unknown'
    );
  }

  const readyPlantings = $derived(
    data.plantings.filter((p) => p.status === 'in-window' && !p.alreadyHarvested)
  );
  const upcomingPlantings = $derived(data.plantings.filter((p) => p.status === 'too-early'));
  const pastPlantings = $derived(
    data.plantings.filter((p) => p.status === 'past' || p.alreadyHarvested)
  );
  const seasonYear = $derived(Number(fmt.today().slice(0, 4)));
  const yearStart = $derived(new Date(seasonYear, 0, 1).getTime());
  const eventsYtd = $derived(data.recordedHarvests.filter((e) => e.occurredAt >= yearStart));

  function reLabel(a: NonNullable<ReturnType<typeof reHarvestArchetype>>): string {
    if (a === 'cut-and-come-again-leafy') return tr('harvestui.reLabel.leafy');
    if (a === 'continuous-harvest-fruit') return tr('harvestui.reLabel.fruit');
    if (a === 'tree-fruit-multi-pick') return tr('harvestui.reLabel.tree');
    return reHarvestLabel(a);
  }

  function exportYtdCsv() {
    const csv = harvestYtdCsv(
      eventsYtd.map((e) => [
        ymdInZone(e.occurredAt, currentPrefs().timeZone),
        e.blockName ?? e.blockId,
        e.cropPluginId,
        e.quantity ?? '',
        e.lotNumber ?? ''
      ])
    );
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `harvest-ytd-${seasonYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<svelte:head>
  <title>{tr('harvestui.pageTitle')}</title>
</svelte:head>

<header class="page-header">
  <Kicker>{tr('harvestui.kickerSeason', { year: seasonYear })}</Kicker>
  <h1 class="serif">{tr('harvestui.h1')}</h1>
  <p class="stat-line">
    <strong>{readyPlantings.length}</strong>
    {tr('harvestui.readyToday')}
    <strong>{upcomingPlantings.length}</strong>
    {tr('harvestui.upcomingWindows')}
    <strong>{eventsYtd.length}</strong>
    {tr('harvestui.eventsYtd')}
  </p>
  <div class="page-actions">
    <button class="ghost" type="button" onclick={exportYtdCsv} disabled={eventsYtd.length === 0}>
      {tr('harvestui.exportYtd')}
    </button>
  </div>
</header>

{#if lastNotice}
  <Banner tone="wheat">{lastNotice}</Banner>
{/if}
{#if taskCtx && (taskOutcome || taskQueued || !recordingFor)}
  <TaskCloseNote task={taskCtx} record={taskRecord} outcome={taskOutcome} queued={taskQueued} />
{/if}
{#if lastSale || saleQueued}
  <div class="sale-strip" data-testid="harvest-saved-strip">
    <span
      >{data.canRecordSale
        ? lastSale
          ? tr('harvestui.savedSoldFor', { name: lastSale.name })
          : tr('harvestui.savedSold')
        : lastSale
          ? tr('harvestui.savedFor', { name: lastSale.name })
          : tr('harvestui.saved')}</span
    >
    {#if lastSale && data.canWriteRecords}
      <button
        type="button"
        class="sale-link"
        data-testid="where-did-it-go"
        onclick={() => (dispositionFor = lastSale?.harvestEventId ?? null)}
        >{tr('harvestui.whereDidItGo')}</button
      >
    {:else if saleQueued && data.canWriteRecords}
      <span class="sale-offline" data-testid="where-after-sync"
        >{tr('harvestui.whereAfterSync')}</span
      >
    {/if}
    {#if data.canRecordSale}
      <span class="record-sale" data-testid="record-sale">
        {#if lastSale && online}
          <a class="sale-link" href={recordSaleHref(lastSale)}>{tr('harvestui.recordSale')}</a>
        {:else}
          <span class="sale-offline">{recordSaleOffline(data.locale)}</span>
        {/if}
      </span>
    {/if}
  </div>
{/if}
{#if phiWarning}
  <div class="phi-banner">
    <Banner tone="wheat">
      <span lang="en" data-english-only="safety">
        <strong>⚠ Pre-harvest interval:</strong>
        {phiWarning}
      </span>
      <button class="phi-dismiss" type="button" onclick={() => (phiWarning = null)}
        >{tr('harvestui.phiAck')}</button
      >
    </Banner>
  </div>
{/if}

{#if data.plantings.length === 0}
  <SetupCallout
    kicker={tr('harvestui.callout.kicker')}
    title={tr('harvestui.callout.title')}
    canEdit={data.setup.canEdit}
    askOwner={tr('harvestui.callout.askOwner')}
    testId="harvest-what"
  >
    <p>
      {tr('harvestui.callout.body')}
    </p>
    {#snippet actions()}
      <button type="button" class="primary" onclick={() => (plantingSheetOpen = true)}>
        {tr('harvestui.callout.add')}
      </button>
      <a href="/plan">{tr('harvestui.callout.planInstead')}</a>
    {/snippet}
  </SetupCallout>
{:else}
  <section class="card panel ready">
    <div class="panel-head">
      <h2>
        {tr('harvestui.plantings')}
        <span class="panel-count">{tr('harvestui.nReady', { n: readyPlantings.length })}</span>
      </h2>
      {#if data.setup.canEdit}
        <button type="button" class="add-more" onclick={() => (plantingSheetOpen = true)}>
          {tr('harvestui.addMore')}
        </button>
      {/if}
    </div>
    <ul class="plantings">
      {#each data.plantings as p (p.plantingId)}
        <li
          id="planting-{p.plantingId}"
          class="planting status-{p.status}"
          class:harvested={p.alreadyHarvested}
          class:focused={data.focusPlantingId === p.plantingId}
        >
          <header>
            <strong>{cropDisplayName(p.cropPluginId, p.varietyDisplayName, data.locale)}</strong>
            <span class="block">{p.blockName}</span>
            {#if p.cropFamily}
              <span class="family">{p.cropFamily}</span>
            {/if}
            {#if p.alreadyHarvested}
              <span class="badge harvested">{tr('harvestui.badge.harvested')}</span>
            {:else if p.status === 'in-window'}
              <span class="badge in-window">{tr('harvestui.badge.ready')}</span>
            {:else if p.status === 'past'}
              <span class="badge past">{tr('harvestui.badge.past')}</span>
            {:else if p.status === 'too-early'}
              <span class="badge too-early">{tr('harvestui.badge.early')}</span>
            {/if}
          </header>
          <div class="meta">
            {#if p.plantingDate}{tr('harvestui.planted', { date: fmt.day(p.plantingDate) })}
            {/if}{tr('harvestui.windowRange', { range: fmtRange(p) })}
            {#if p.status === 'too-early'}{tr('harvestui.dUntil', {
                n: p.daysUntilWindow ?? ''
              })}{/if}
            {#if p.status === 'in-window'}{tr('harvestui.dInto', {
                n: p.daysIntoWindow ?? ''
              })}{/if}
            {#if p.status === 'past'}{tr('harvestui.dPast', { n: p.daysPastWindow ?? '' })}{/if}
          </div>

          {#if p.harvestIndicators.length > 0}
            {#if p.status === 'in-window' && !p.alreadyHarvested}
              <div class="indicators-inline">
                <strong>{tr('harvestui.indicators')}</strong>
                <ul class="indicators">
                  {#each p.harvestIndicators as ind, idx (idx)}<li>{ind}</li>{/each}
                </ul>
              </div>
            {:else}
              <details>
                <summary>{tr('harvestui.indicators')}</summary>
                <ul class="indicators">
                  {#each p.harvestIndicators as ind, idx (idx)}<li>{ind}</li>{/each}
                </ul>
              </details>
            {/if}
          {/if}

          <!-- #230 — forage plantings live on /hay's cutting workflow,
               not /harvest. Surface the cross-link so a forage operator
               who clicks through to /harvest can find the right surface
               without bouncing back to primary nav. -->
          {#if p.harvestStyle === 'forage-cutting-cycle'}
            <div class="forage-banner">
              <Banner tone="sky">
                {tr('harvestui.forageBanner')}
                <a href="/hay?block={p.blockId}">{tr('harvestui.forageLink')}</a>
              </Banner>
            </div>
          {:else if showHarvestForm(p)}
            <!-- #198 — pre-window + past-window banners so the operator
                 knows they're recording outside the calendar-derived
                 window. The form still submits; the banner is the
                 acknowledgement, not a block. -->
            {#if p.status === 'too-early'}
              <div class="window-banner">
                <Banner tone="wheat">
                  {tr('harvestui.tooEarlyBanner', { n: p.daysUntilWindow ?? '' })}
                </Banner>
              </div>
            {:else if p.status === 'past'}
              <div class="window-banner">
                <Banner tone="sky">
                  {tr('harvestui.pastBanner', { n: p.daysPastWindow ?? '' })}
                </Banner>
              </div>
            {:else if p.status === 'unknown'}
              <div class="window-banner" data-testid="no-window-banner">
                <Banner tone="sky">{tr('harvestui.noWindowBanner')}</Banner>
              </div>
            {/if}
            <!-- #197 — re-harvest archetypes keep the form available
                 even after the first pick so cut-and-come-again leafies,
                 continuous-fruit (tomato, pepper) and tree-fruit-multi-
                 pick (apple, peach) can log 2nd, 3rd, Nth picks. -->
            {@const reArch = p.alreadyHarvested ? reHarvestArchetype(p) : null}
            {#if reArch}
              <div class="window-banner">
                <Banner tone="sky">
                  {tr('harvestui.reBanner', { label: reLabel(reArch) })}
                </Banner>
              </div>
            {/if}
            {#if recordingFor === p.plantingId}
              <div class="renderer-mount">
                <HarvestRouter
                  harvestStyle={p.harvestStyle}
                  archetype={p.archetype}
                  archetypeOverride={p.archetypeOverride}
                  plantingId={p.plantingId}
                  blockId={p.blockId}
                  blockName={p.blockName}
                  cropPluginId={p.cropPluginId}
                  varietyDisplayName={p.varietyDisplayName}
                  cropFamily={p.cropFamily}
                  plantingDate={p.plantingDate}
                  windowStartMs={p.windowStartMs}
                  windowEndMs={p.windowEndMs}
                  harvestIndicators={p.harvestIndicators}
                  rendererData={p.rendererData}
                  onCommit={(input) => commitFromRenderer(p, input)}
                  error={lastError}
                  onCancel={cancelRecord}
                />
                <TaskCloseNote
                  task={openTask}
                  record={{ blockId: p.blockId, cropPluginId: p.cropPluginId }}
                />
              </div>
            {:else}
              <button class="primary" onclick={() => startRecord(p.plantingId)}>
                {p.alreadyHarvested ? tr('harvestui.recordAnother') : tr('harvestui.record')}
              </button>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

{#if upcomingPlantings.length > 0}
  <section class="card panel upcoming">
    <h2>
      {tr('harvestui.upcoming')} <span class="panel-count">{upcomingPlantings.length}</span>
    </h2>
    <ul class="upcoming-list">
      {#each upcomingPlantings.slice(0, 8) as p (p.plantingId)}
        <li>
          <strong>{cropDisplayName(p.cropPluginId, p.varietyDisplayName, data.locale)}</strong>
          <span class="up-block">· {p.blockName}</span>
          {#if p.windowStartMs}
            <span class="up-when">
              {tr('harvestui.opens', {
                date: fmtWindowDay(p.windowStartMs, p),
                n: p.daysUntilWindow ?? ''
              })}
            </span>
          {/if}
        </li>
      {/each}
      {#if upcomingPlantings.length > 8}
        <li class="more">{tr('harvestui.moreUpcoming', { n: upcomingPlantings.length - 8 })}</li>
      {/if}
    </ul>
  </section>
{/if}

{#if data.recordedHarvests.length > 0}
  {@const inCuring = data.recordedHarvests.filter((h) => h.curing && h.curing.phase !== 'overdue')}
  {#if inCuring.length > 0}
    <section class="card curing-card">
      <h2>{tr('harvestui.curing.title')}</h2>
      <ul class="curing-list">
        {#each inCuring as h (h.id)}
          <li class="curing-item phase-{h.curing!.phase}">
            <header>
              <strong>{harvestCropName(h.cropPluginId)}</strong>
              {#if h.lotNumber}<span class="lot"
                  >{tr('harvestui.curing.lot', { lot: h.lotNumber })}</span
                >{/if}
              <span class="phase-badge phase-{h.curing!.phase}">
                {h.curing!.phase === 'in-progress'
                  ? tr('harvestui.curing.inProgress')
                  : tr('harvestui.curing.readyWindow')}
              </span>
            </header>
            <p class="meta">
              {tr('harvestui.curing.meta', {
                date: fmt.instant(h.occurredAt, 'date'),
                method: h.curing!.method ?? '—',
                min: h.curing!.minWeeks,
                max: h.curing!.maxWeeks
              })}
            </p>
            {#if h.curing!.phase === 'in-progress'}
              <p class="countdown">
                <strong>{h.curing!.daysRemaining}</strong>
                {tr('harvestui.curing.untilOpens', { count: h.curing!.daysRemaining })}
              </p>
            {:else}
              <p class="countdown ready">
                <strong>{tr('harvestui.curing.readyNow')}</strong>
                {tr('harvestui.curing.verify')}
                {#if h.curing!.targetMoisturePercent}
                  {tr('harvestui.curing.moisture', {
                    min: h.curing!.targetMoisturePercent.min,
                    max: h.curing!.targetMoisturePercent.max
                  })}
                {:else}
                  {tr('harvestui.curing.byFeel')}
                {/if}
                {tr('harvestui.curing.untilCloses', {
                  count: h.curing!.daysRemaining
                })}
                {#if h.curing!.storageLocation}
                  {tr('harvestui.curing.thenMove')} <em>{h.curing!.storageLocation}</em>
                {/if}
              </p>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="card">
    <h2>{tr('harvestui.recorded')}</h2>
    <div class="table-scroll">
      <table class="recorded">
        <thead>
          <tr>
            <th>{tr('harvestui.th.when')}</th>
            <th>{tr('harvestui.th.block')}</th>
            <th>{tr('harvestui.th.variety')}</th>
            <th>{tr('harvestui.th.quantity')}</th>
            <th>{tr('harvestui.th.lot')}</th>
            <th>{tr('harvestui.th.curing')}</th>
            <th>{tr('harvestui.th.where')}</th>
          </tr>
        </thead>
        <tbody>
          {#each data.recordedHarvests as h (h.id)}
            <tr>
              <td data-label={tr('harvestui.th.when')}>{fmt.instant(h.occurredAt, 'date')}</td>
              <td data-label={tr('harvestui.th.block')}
                >{h.blockName ?? tr('harvestui.deletedBlock')}</td
              >
              <td data-label={tr('harvestui.th.variety')}>{harvestCropName(h.cropPluginId)}</td>
              <td data-label={tr('harvestui.th.quantity')}>{h.quantity ?? '—'}</td>
              <td data-label={tr('harvestui.th.lot')}>{h.lotNumber ?? '—'}</td>
              <td data-label={tr('harvestui.th.curing')}>
                {#if h.curing}
                  <span class="phase-badge phase-{h.curing.phase}">
                    {h.curing.phase === 'in-progress'
                      ? tr('harvestui.cur.inProgress', { n: h.curing.daysRemaining })
                      : h.curing.phase === 'ready'
                        ? tr('harvestui.cur.ready', { n: h.curing.daysRemaining })
                        : tr('harvestui.cur.overdue')}
                  </span>
                {:else}
                  <span class="muted">{tr('harvestui.noCuring')}</span>
                {/if}
              </td>
              <td data-label={tr('harvestui.th.where')}>
                <button
                  type="button"
                  class="where-btn"
                  data-testid="where-it-went-{h.id}"
                  onclick={() => (dispositionFor = h.id)}
                >
                  {whereCount(h.id) > 0
                    ? tr('harvestui.whereRecorded', { n: whereCount(h.id) })
                    : data.canWriteRecords
                      ? tr('harvestui.whereAdd')
                      : tr('harvestui.whereNone')}
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
{/if}

<SetupSheet
  open={dispositionHarvest !== null}
  kicker={tr('harvestui.sheet.kicker')}
  title={tr('harvestui.whereDidItGo')}
  onClose={() => (dispositionFor = null)}
>
  {#if dispositionHarvest}
    <DispositionPanel
      harvest={{
        id: dispositionHarvest.id,
        cropId: dispositionHarvest.cropId ?? null,
        occurredAt: dispositionHarvest.occurredAt,
        quantity: dispositionHarvest.quantity ?? null
      }}
      dispositions={data.dispositions[dispositionHarvest.id] ?? []}
      canWrite={data.canWriteRecords}
      isOwner={data.isOwner}
      canRecordSale={data.canRecordSale}
      askSoldAsOrganic={data.askSoldAsOrganic}
      {online}
      onChanged={() => invalidateAll()}
    />
  {/if}
</SetupSheet>

<SetupSheet
  open={plantingSheetOpen}
  kicker={tr('harvestui.sheet.kicker')}
  title={tr('harvestui.sheet.title')}
  onClose={() => (plantingSheetOpen = false)}
  onDone={onPlantingAdded}
>
  {#snippet children(done)}
    <SetupPlantingBackfill
      blocks={data.setup.blocks}
      areas={data.setup.areas}
      canEdit={data.setup.canEdit}
      submitLabel={tr('harvestui.sheet.submit')}
      onDone={done}
    />
  {/snippet}
</SetupSheet>

<style>
  .sale-strip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2, 8px);
    margin: 0 0 var(--space-3, 12px);
    padding: var(--space-2, 8px) var(--space-3, 12px);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card, 10px);
    background: var(--color-paper);
  }
  .sale-link {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    padding: 0 16px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 8px);
    color: var(--color-forest-deep);
    font-weight: 600;
    text-decoration: none;
  }
  .sale-offline {
    color: var(--color-ink-soft);
  }
  button.sale-link {
    background: var(--color-paper);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .record-sale {
    display: inline-flex;
    align-items: center;
  }
  .table-scroll {
    overflow-x: auto;
    max-width: 100%;
  }
  @media (max-width: 640px) {
    .recorded thead {
      display: none;
    }
    .recorded,
    .recorded tbody,
    .recorded tr,
    .recorded td {
      display: block;
      width: 100%;
    }
    .recorded tr {
      padding: 8px 0;
      border-bottom: 1px solid var(--color-divider);
    }
    .recorded td {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border: 0;
      padding: 4px 0;
      overflow-wrap: anywhere;
    }
    .recorded td::before {
      content: attr(data-label);
      font-weight: 600;
      color: var(--color-ink-soft, inherit);
      flex: none;
    }
  }
  .where-btn {
    min-height: 48px;
    min-width: 48px;
    padding: 0 12px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 8px);
    background: var(--color-paper);
    color: var(--color-forest-deep);
    font: inherit;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }
  .panel-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .add-more {
    min-height: 48px;
    padding: 0 16px;
    border-radius: var(--radius-input);
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-forest-deep);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  h1 {
    margin: 0 0 0.25rem;
  }
  .lede {
    color: #555;
    margin: 0 0 1.5rem;
  }
  .stat-line {
    margin: 0.25rem 0 0.75rem;
    color: var(--color-ink-soft);
    font-size: 14px;
  }
  .stat-line strong {
    color: var(--color-ink);
    font-weight: 700;
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .page-actions {
    margin-bottom: 1rem;
  }
  .page-actions .ghost {
    background: transparent;
    color: var(--color-ink);
    border: 1px solid var(--color-divider);
    padding: 6px 12px;
    border-radius: 4px;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .page-actions .ghost:hover {
    border-color: var(--color-ink);
  }
  .page-actions .ghost:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .panel-count {
    font-size: 12px;
    color: var(--color-ink-muted);
    font-weight: 500;
    margin-left: 0.5rem;
  }
  .upcoming {
    background: rgba(141, 174, 138, 0.06);
  }
  .upcoming-list {
    list-style: none;
    padding: 0;
    margin: 0;
    font-size: 13px;
  }
  .upcoming-list li {
    padding: 6px 0;
    border-bottom: 1px solid var(--color-divider-soft, var(--color-divider));
  }
  .upcoming-list li:last-child {
    border-bottom: none;
  }
  .upcoming-list .up-block {
    color: var(--color-ink-muted);
    margin-left: 4px;
  }
  .upcoming-list .up-when {
    color: var(--color-ink-soft);
    margin-left: 0.5rem;
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .upcoming-list .more {
    color: var(--color-ink-muted);
    font-style: italic;
  }
  .curing-card {
    border-left: 4px solid #d4a017;
    background: #fffaeb;
  }
  .curing-card h2 {
    color: #6b4f00;
  }
  .curing-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .curing-item {
    padding: 0.6rem 0.8rem;
    margin: 0.4rem 0;
    background: white;
    border-radius: 4px;
    border-left: 3px solid #d4a017;
  }
  .curing-item.phase-ready {
    border-left-color: var(--color-forest);
    background: #f0f8f0;
  }
  .curing-item header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 0.4rem;
  }
  .curing-item .lot {
    color: #666;
    font-size: 0.85rem;
  }
  .phase-badge {
    padding: 0.1rem 0.5rem;
    border-radius: 3px;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    margin-left: auto;
  }
  .phase-badge.phase-in-progress {
    background: var(--pill-wheat-bg);
    color: #6b4f00;
  }
  .phase-badge.phase-ready {
    background: var(--pill-forest-bg);
    color: var(--color-forest);
  }
  .phase-badge.phase-overdue {
    background: var(--pill-rust-bg);
    color: var(--color-rust);
  }
  .curing-item .meta {
    color: #555;
    font-size: 0.85rem;
    margin: 0 0 0.4rem;
  }
  .countdown {
    margin: 0;
    font-size: 0.95rem;
  }
  .countdown.ready {
    color: var(--color-forest);
    font-weight: 600;
  }
  .muted {
    color: #888;
    font-style: italic;
    font-size: 0.85rem;
  }
  .card {
    background: white;
    border-radius: 8px;
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .card h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    color: var(--color-forest);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .plantings {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .planting {
    border-left: 4px solid #ccc;
    background: #fafbfa;
    padding: 0.75rem 1rem;
    margin: 0.5rem 0;
    border-radius: 0 4px 4px 0;
  }
  .planting.status-in-window {
    border-left-color: var(--color-forest);
    background: #f0f8f3;
  }
  .planting.status-past {
    border-left-color: var(--color-wheat);
    background: #fff8ec;
  }
  .planting.status-too-early {
    border-left-color: #6b6b6b;
  }
  .planting.harvested {
    opacity: 0.7;
  }
  .planting.focused {
    outline: 3px solid #ffd400;
    outline-offset: 2px;
  }
  .planting header {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .block {
    color: #555;
    font-size: 0.9rem;
  }
  .family {
    font-size: 0.75rem;
    color: var(--color-forest);
    background: var(--pill-forest-bg);
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
  }
  .badge {
    margin-left: auto;
    padding: 0.15rem 0.5rem;
    border-radius: 3px;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .badge.in-window {
    background: var(--pill-forest-bg);
    color: var(--color-forest);
  }
  .badge.past {
    background: var(--pill-wheat-bg);
    color: var(--color-wheat);
  }
  .badge.too-early {
    background: #eaeaea;
    color: #555;
  }
  .badge.harvested {
    background: #ddd;
    color: #555;
  }
  .meta {
    color: #555;
    font-size: 0.85rem;
    margin: 0.4rem 0;
    font-family: monospace;
  }
  details {
    margin-top: 0.5rem;
  }
  details > summary {
    min-height: 48px;
    padding-block: 12px;
    cursor: pointer;
  }
  .indicators-inline {
    margin-top: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: #fff;
    border-left: 3px solid var(--color-forest);
    border-radius: 0 4px 4px 0;
  }
  .indicators-inline strong {
    color: var(--color-forest);
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .indicators {
    margin: 0.4rem 0 0 1.25rem;
    padding: 0;
  }
  .renderer-mount {
    margin-top: 0.75rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--color-divider-soft, var(--color-divider));
  }
  .window-banner,
  .forage-banner {
    margin-top: 0.6rem;
  }
  .phi-banner {
    margin-bottom: 1rem;
  }
  .phi-dismiss {
    margin-left: 0.5rem;
    background: transparent;
    border: 1px solid currentColor;
    color: inherit;
    border-radius: 4px;
    padding: 4px 10px;
    font: inherit;
    font-size: 12px;
    min-height: unset;
    cursor: pointer;
  }
  .primary {
    background: var(--color-forest);
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.75rem 1.25rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 48px;
    margin-top: 0.5rem;
  }
  button {
    background: white;
    border: 2px solid var(--color-forest);
    color: var(--color-forest);
    border-radius: 6px;
    padding: 0.75rem 1.25rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 48px;
  }
  button.primary {
    background: var(--color-forest);
    color: white;
    border-color: var(--color-forest);
  }
  .error {
    color: var(--color-rust);
    grid-column: 1 / -1;
    margin: 0;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  th,
  td {
    text-align: left;
    padding: 0.5rem;
    border-bottom: 1px solid #eee;
  }
  th {
    background: var(--color-cream);
    color: var(--color-forest);
    text-transform: uppercase;
    font-size: 0.75rem;
    letter-spacing: 0.5px;
  }
</style>
