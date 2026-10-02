<script lang="ts">
  /**
   * Phase 32E (E1-16, E1-18, E1-20). Seed starting on the Planting Card
   * page: the crop's sourced timing (or an honest "not known"), the trays
   * with their germination steppers, and the owner's "Log a tray" form.
   */
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import GerminationStepper from './GerminationStepper.svelte';
  import type { FarmSnapshot, SnapshotSeedTray } from '$lib/cards/snapshot';
  import {
    HARDEN_TIMING_UNKNOWN,
    SOW_TIMING_UNKNOWN,
    resolveSeedStartTiming
  } from '$lib/schedule/seedStart';
  import { localDayInput, traySownAt } from '$lib/seedStart/trayDate';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  interface Props {
    snapshot: FarmSnapshot;
    plantingId: string;
    role: string | null;
  }

  const { snapshot, plantingId, role }: Props = $props();
  const tr = $derived(createT(page.data?.locale));

  const planting = $derived(snapshot.plantings.find((p) => p.id === plantingId) ?? null);
  const plugin = $derived(planting ? snapshot.cropPlugins[planting.cropPluginId] : undefined);
  const timing = $derived(plugin ? resolveSeedStartTiming(plugin) : null);
  const germ = $derived(plugin?.plantingGuide?.germinationTempF);
  let added = $state<SnapshotSeedTray[]>([]);
  const trays = $derived([...(planting?.trays ?? []), ...added]);
  const shown = $derived(
    !!planting && (planting.establishment === 'transplant' || trays.length > 0)
  );
  const canWrite = $derived(role !== null && role !== 'inspector');
  const isOwner = $derived(role === 'owner');

  let formOpen = $state(false);
  $effect(() => {
    if (isOwner && typeof location !== 'undefined' && location.hash === '#log-tray') {
      formOpen = true;
    }
  });
  let sownOn = $state(localDayInput(Date.now()));
  let trayLabel = $state('');
  let cells = $state<number | null>(null);
  let seedsPerCell = $state<number | null>(1);
  let busy = $state(false);
  let error = $state('');

  function range(r: { min: number; max: number }, unit: string) {
    return r.min === r.max
      ? `${r.min} ${unit}`
      : tr('cardsui.seed.range', { min: r.min, max: r.max, unit });
  }

  async function logTray(e: SubmitEvent) {
    e.preventDefault();
    if (!planting) return;
    const sownAt = traySownAt(sownOn, Date.now());
    if (sownAt === null) {
      error = tr('cardsui.seed.pickDay');
      return;
    }
    busy = true;
    error = '';
    try {
      const res = await fetch('/api/seed-starts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cropId: planting.id,
          sownAt,
          trayLabel: trayLabel.trim() || null,
          cells: cells && cells > 0 ? cells : null,
          seedsPerCell: seedsPerCell && seedsPerCell > 0 ? seedsPerCell : null
        })
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        error = body?.error ?? tr('cardsui.seed.couldNotSave', { status: res.status });
        return;
      }
      added = [...added, body.tray as SnapshotSeedTray];
      formOpen = false;
      trayLabel = '';
    } catch {
      error = tr('cardsui.seed.needsConnection');
    } finally {
      busy = false;
    }
  }
</script>

{#if shown && planting}
  <section id="log-tray" class="seed" aria-labelledby="seed-title" data-testid="seed-start-panel">
    <h2 id="seed-title" class="serif">{tr('cardsui.seed.title')}</h2>
    <ul class="facts">
      <li>
        {#if germ}
          {tr('cardsui.seed.germBest', { range: range(germ, '°F') })}
          <Provenance source="plugin" compact />
        {:else}
          {tr('cardsui.seed.germUnknown')}
        {/if}
      </li>
      <li>
        {#if timing?.startIndoorsWeeks}
          {tr('cardsui.seed.startIndoors', {
            range: range(timing.startIndoorsWeeks, tr('cardsui.seed.weeks'))
          })}
          <Provenance source={timing.startIndoorsWeeks.source} compact />
        {:else}
          {SOW_TIMING_UNKNOWN}
        {/if}
      </li>
      <li>
        {#if timing?.hardenOffDays}
          {tr('cardsui.seed.hardenOff', {
            range: range(timing.hardenOffDays, tr('cardsui.seed.days'))
          })}
          <Provenance source={timing.hardenOffDays.source} compact />
        {:else}
          {HARDEN_TIMING_UNKNOWN}
        {/if}
      </li>
    </ul>

    {#if trays.length}
      <h3>{tr('cardsui.seed.trays')}</h3>
      {#each trays as t (t.id)}
        <GerminationStepper tray={t} {canWrite} />
      {/each}
    {:else}
      <p class="hint">{tr('cardsui.seed.noTray')}</p>
    {/if}

    {#if isOwner}
      {#if formOpen}
        <form class="form" onsubmit={logTray}>
          <label class="field">
            <span>{tr('cardsui.seed.sownOn')}</span>
            <input type="date" bind:value={sownOn} max={localDayInput(Date.now())} required />
          </label>
          <label class="field">
            <span>{tr('cardsui.seed.trayName')}</span>
            <input
              type="text"
              bind:value={trayLabel}
              maxlength="80"
              placeholder={tr('cardsui.seed.optional')}
            />
          </label>
          <div class="pair">
            <label class="field">
              <span>{tr('cardsui.seed.cells')}</span>
              <input type="number" min="1" max="2000" inputmode="numeric" bind:value={cells} />
            </label>
            <label class="field">
              <span>{tr('cardsui.seed.seedsPerCell')}</span>
              <input type="number" min="1" max="50" inputmode="numeric" bind:value={seedsPerCell} />
            </label>
          </div>
          <div class="row">
            <button type="submit" class="btn primary" disabled={busy}
              >{tr('cardsui.seed.saveTray')}</button
            >
            <button type="button" class="btn" onclick={() => (formOpen = false)}
              >{tr('cardsui.seed.cancel')}</button
            >
          </div>
        </form>
      {:else}
        <button type="button" class="btn" onclick={() => (formOpen = true)}
          >{tr('cardsui.seed.logTray')}</button
        >
      {/if}
    {:else if canWrite && !trays.length}
      <p class="hint">{tr('cardsui.seed.askOwner')}</p>
    {/if}
    {#if error}<p class="err" role="alert">{error}</p>{/if}
  </section>
{/if}

<style>
  .seed {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin: var(--space-4) 0;
    max-width: 640px;
    min-width: 0;
  }
  h2,
  h3 {
    margin: 0;
  }
  .facts {
    margin: 0;
    padding-left: 1.1rem;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .hint {
    margin: 0;
    color: var(--color-ink-soft);
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .field input {
    min-height: 48px;
    max-width: 100%;
    font-size: var(--font-size-body);
  }
  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .btn {
    min-height: 48px;
    padding: 0 var(--space-4);
    border-radius: var(--radius-input);
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-ink);
    font-size: var(--font-size-body);
    font-weight: 600;
    cursor: pointer;
    align-self: flex-start;
  }
  .btn.primary {
    background: var(--color-forest);
    border-color: var(--color-forest);
    color: var(--color-paper);
  }
  .err {
    margin: 0;
    color: var(--color-rust);
  }
</style>
