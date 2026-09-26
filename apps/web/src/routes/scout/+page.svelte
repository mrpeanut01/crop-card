<script lang="ts">
  /**
   * /scout — FR-07 threshold-driven scouting + observation persistence.
   *
   * Sprint 4 (#136 / CT-SC-001) — observations now POST to
   * `/api/scout/record`. Phase 25d shipped the API endpoint + the
   * `scout_observations` table but the UI never called either, so every
   * scouting walk silently lost its data and the downstream
   * `/spray/insecticide` IPM gate read from an empty table.
   *
   * Sprint 4 (#138/#140/#141) — page now uses Card / Pill / Kicker /
   * Provenance / Input primitives (Phase 25 visual language), matching
   * /spray's chrome instead of the locally-styled Phase 4 markup.
   *
   * Sprint 4 (#139 / CT-SC-003) — recent observations are loaded by the
   * server + rendered as a per-block history list so the operator can
   * see prior counts at a glance.
   */
  import { evaluateScout, type ScoutSpot } from '$lib/safety/scout';
  import { onMount, untrack } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import Card from '$lib/components/ui/Card.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import UnitInput from '$lib/components/ui/UnitInput.svelte';
  import { fmt } from '$lib/prefsState.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import QueuedBadge from '$lib/components/ui/QueuedBadge.svelte';

  interface QueuedObservation {
    id: string;
    blockId: string;
    pest: string;
    metric: string;
    value: number;
    occurredAt: number;
  }

  let { data } = $props();

  let selectedBlockId = $state(untrack(() => data.preselectedBlockId ?? data.blocks[0]?.id ?? ''));

  let spots = $state<ScoutSpot[]>([
    { weedsPer10SqFt: 0 },
    { weedsPer10SqFt: 0 },
    { weedsPer10SqFt: 0 },
    { weedsPer10SqFt: 0 }
  ]);
  let maxHeight = $state<number | null>(null);

  let saving = $state(false);
  let saveError = $state<string | null>(null);
  let saveSuccess = $state(false);
  let saveQueued = $state(false);
  let queued = $state<QueuedObservation[]>([]);

  const result = $derived(evaluateScout({ spots, maxWeedHeightInches: maxHeight ?? undefined }));
  const selectedBlock = $derived(data.blocks.find((b) => b.id === selectedBlockId));

  /** Prior observations for the selected block, newest first. Comes from
   *  `listScoutObservations({ blockId, fromMs })` in the loader. */
  const observationsForBlock = $derived(data.observationsByBlock[selectedBlockId] ?? []);
  const queuedForBlock = $derived(queued.filter((q) => q.blockId === selectedBlockId));

  function toQueued(id: string, payload: unknown): QueuedObservation | null {
    if (!payload || typeof payload !== 'object') return null;
    const p = payload as Partial<QueuedObservation>;
    if (typeof p.blockId !== 'string' || typeof p.value !== 'number') return null;
    return {
      id,
      blockId: p.blockId,
      pest: String(p.pest ?? ''),
      metric: String(p.metric ?? ''),
      value: p.value,
      occurredAt: typeof p.occurredAt === 'number' ? p.occurredAt : Date.now()
    };
  }

  async function refreshQueued(): Promise<void> {
    try {
      const { listPendingForActiveOwner } = await import('$lib/client/syncQueue');
      const rows = await listPendingForActiveOwner();
      const next = rows
        .filter((r) => r.kind === 'scout')
        .map((r) => toQueued(r.id, r.payload))
        .filter((q): q is QueuedObservation => q !== null)
        .sort((a, b) => b.occurredAt - a.occurredAt);
      const drained = next.length < queued.length;
      queued = next;
      if (drained && navigator.onLine) await invalidateAll();
    } catch {
      queued = [];
    }
  }

  onMount(() => {
    void refreshQueued();
    const timer = setInterval(refreshQueued, 4000);
    return () => clearInterval(timer);
  });

  async function queueObservation(payload: Record<string, unknown>): Promise<void> {
    const { enqueueRecord } = await import('$lib/client/syncQueue');
    await enqueueRecord('scout', payload);
    saveQueued = true;
    await refreshQueued();
  }

  const planSprayHref = $derived.by(() => {
    const params = new URLSearchParams();
    if (selectedBlockId) params.set('block', selectedBlockId);
    if (data.windowStage) params.set('windowStage', data.windowStage);
    params.set('fromScout', '1');
    return `/spray?${params.toString()}`;
  });

  function addSpot() {
    spots = [...spots, { weedsPer10SqFt: 0 }];
  }
  function removeSpot(i: number) {
    spots = spots.filter((_, idx) => idx !== i);
  }

  async function saveObservation(): Promise<void> {
    if (!selectedBlockId) {
      saveError = 'Pick a block first';
      return;
    }
    if (result.spotsCounted === 0) {
      saveError = 'Enter at least one spot count before saving';
      return;
    }
    saving = true;
    saveError = null;
    saveSuccess = false;
    saveQueued = false;
    let payload: Record<string, unknown> | null = null;
    try {
      // One observation per scout walk; value is the average count, with
      // raw per-spot counts + the tallest-weed measurement preserved in
      // notes so the IPM evaluator can read the canonical average AND
      // historical context lives in the audit trail.
      const notes = [
        `spots=[${spots.map((s) => s.weedsPer10SqFt).join(',')}]`,
        maxHeight != null && Number.isFinite(maxHeight)
          ? `tallest_in=${Number(maxHeight.toFixed(2))}`
          : null,
        `decision=${result.decision}`
      ]
        .filter(Boolean)
        .join(' ');
      payload = {
        blockId: selectedBlockId,
        pest: 'broadleaf-weed',
        metric: 'avg-per-10sqft',
        value: result.averagePer10SqFt,
        notes,
        occurredAt: Date.now()
      };
      if (navigator.onLine === false) {
        await queueObservation(payload);
        return;
      }
      const res = await fetch('/api/scout/record', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        saveError = body.error ?? `HTTP ${res.status}`;
        return;
      }
      saveSuccess = true;
      await invalidateAll();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (payload && e instanceof TypeError && /(fetch|network|failed)/i.test(msg)) {
        try {
          await queueObservation(payload);
          return;
        } catch (queueErr) {
          saveError = `Could not keep it on this device: ${
            queueErr instanceof Error ? queueErr.message : queueErr
          }`;
          return;
        }
      }
      saveError = msg;
    } finally {
      saving = false;
    }
  }

  function fmtDate(ms: number): string {
    return fmt.instant(ms, 'month-day');
  }
</script>

<svelte:head>
  <title>Scout · CropCard</title>
</svelte:head>

<header class="page-header">
  <div class="page-header-titles">
    <Kicker>FR-07 · Threshold-driven scouting</Kicker>
    <h1 class="serif">Scout &amp; spray decision</h1>
  </div>
  <Pill tone="forest">SCOUT</Pill>
</header>
<p class="lede">
  Walk the block, count broadleaves in 4–5 random 10 sq ft spots, and note the tallest weed. The
  threshold: ≥ 3 weeds / 10 sq ft on average, or any weed taller than {fmt.qty(2, 'length')} → spray.
</p>

{#if data.blocks.length > 0}
  <div class="card-wrap">
    <Card>
      <h2>Block</h2>
      <label for="scout-block">Which block are you scouting?</label>
      <select id="scout-block" bind:value={selectedBlockId}>
        {#each data.blocks as b (b.id)}
          <option value={b.id}>{b.name}</option>
        {/each}
      </select>
      {#if data.windowStage}
        <p class="meta">Window: <strong>{data.windowStage}</strong> (from today's calendar)</p>
      {/if}
    </Card>
  </div>
{/if}

<div class="card-wrap">
  <Card>
    <h2>Spots</h2>
    {#each spots as _, i (i)}
      <label class="spot">
        Spot {i + 1}: weeds in 10 sq ft
        <input type="number" min="0" step="1" bind:value={spots[i].weedsPer10SqFt} />
        {#if spots.length > 1}
          <button type="button" class="remove" onclick={() => removeSpot(i)}>✕</button>
        {/if}
      </label>
    {/each}
    <button type="button" onclick={addSpot}>+ Add another spot</button>
  </Card>
</div>

<div class="card-wrap">
  <Card>
    <div class="height-field">
      <label for="scout-max-height">Tallest weed observed ({fmt.unit('length')})</label>
      <UnitInput
        id="scout-max-height"
        quantity="length"
        min={0}
        suffix={false}
        aria-describedby="scout-max-height-hint"
        bind:value={maxHeight}
      />
      <div id="scout-max-height-hint" class="hint">
        Leave blank if you didn't measure. Example: {fmt.qty(1.5, 'length', { bare: true })}
      </div>
    </div>
  </Card>
</div>

<section class="result {result.decision === 'SPRAY' ? 'spray' : 'skip'}" aria-live="polite">
  {#if result.decision === 'SPRAY'}
    <h2>SPRAY</h2>
  {:else}
    <h2>SKIP</h2>
  {/if}
  <p>{result.reason}</p>
  <dl>
    <dt>Spots counted</dt>
    <dd>{result.spotsCounted}</dd>
    <dt>Average / 10 sq ft</dt>
    <dd>{result.averagePer10SqFt.toFixed(2)}</dd>
  </dl>
  <div class="result-actions">
    <button
      type="button"
      class="save"
      onclick={saveObservation}
      disabled={saving || result.spotsCounted === 0 || !selectedBlockId}
    >
      {saving
        ? 'Saving…'
        : saveSuccess
          ? '✓ Saved — save another?'
          : saveQueued
            ? 'Kept on this phone. Save another?'
            : 'Save observation'}
    </button>
    {#if result.decision === 'SPRAY'}
      <a href={planSprayHref} class="primary">
        Plan the spray{selectedBlock ? ` for ${selectedBlock.name}` : ''} →
      </a>
    {/if}
  </div>
  {#if saveQueued}
    <p class="queued-note" role="status">
      No signal, so this observation is saved on this phone. It uploads when you are back online.
    </p>
  {/if}
  {#if saveError}
    <p class="error" role="alert">{saveError}</p>
  {/if}
</section>

<div class="card-wrap">
  <Card>
    <div class="history-head">
      <h2>Recent observations{selectedBlock ? ` — ${selectedBlock.name}` : ''}</h2>
      <Provenance source="data" detail="your scout log" compact />
    </div>
    {#if queuedForBlock.length > 0}
      <ul class="history queued-list" aria-label="Waiting to upload">
        {#each queuedForBlock as q (q.id)}
          <li>
            <span class="hist-date">{fmtDate(q.occurredAt)}</span>
            <span class="hist-pest">{q.pest}</span>
            <span class="hist-value">
              {q.value.toFixed(2)}
              <span class="hist-metric">{q.metric}</span>
            </span>
            <QueuedBadge />
          </li>
        {/each}
      </ul>
    {/if}
    {#if observationsForBlock.length === 0 && queuedForBlock.length === 0}
      <p class="muted">
        No observations recorded for this block yet — count a few spots above and save to start
        building the trend.
      </p>
    {:else}
      <ul class="history">
        {#each observationsForBlock as o (o.id)}
          <li>
            <span class="hist-date">{fmtDate(o.occurredAt)}</span>
            <span class="hist-pest">{o.pest}</span>
            <span class="hist-value">
              {o.value.toFixed(2)}
              <span class="hist-metric">{o.metric}</span>
            </span>
            {#if o.value >= 3}
              <Pill tone="rust">over threshold</Pill>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </Card>
</div>

<style>
  .page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 0.4rem;
  }
  .page-header-titles {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  h1 {
    margin: 0;
  }
  .lede {
    color: var(--color-ink-muted);
    margin: 0 0 1.5rem;
  }
  .card-wrap {
    margin-bottom: 1rem;
  }
  .card-wrap :global(.card h2) {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    color: var(--color-forest);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .spot {
    display: grid;
    grid-template-columns: 1fr 6rem auto;
    gap: 0.5rem;
    align-items: center;
    margin-bottom: 0.4rem;
  }
  .spot input {
    padding: 0.6rem;
    border: 2px solid var(--color-divider);
    border-radius: 4px;
    font-size: 1.1rem;
    min-height: 48px;
  }
  .remove {
    background: var(--pill-rust-bg);
    color: var(--color-rust);
    border: none;
    width: 48px;
    height: 48px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 1.1rem;
  }
  button {
    background: var(--color-paper);
    color: var(--color-forest);
    border: 2px solid var(--color-forest);
    border-radius: 6px;
    padding: 0.6rem 1rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 48px;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .result {
    padding: 1.25rem;
    border-radius: 8px;
    margin-top: 1rem;
  }
  .result.spray {
    background: var(--pill-rust-bg);
    border: 2px solid var(--color-rust);
  }
  .result.spray h2 {
    color: var(--color-rust);
  }
  .result.skip {
    background: var(--pill-forest-bg);
    border: 2px solid var(--color-forest);
  }
  .result.skip h2 {
    color: var(--color-forest);
  }
  .result h2 {
    margin: 0;
    font-size: 1.5rem;
  }
  .result dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.4rem 1rem;
    margin: 1rem 0 0;
  }
  .result dt {
    color: var(--color-ink-muted);
  }
  .result-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-top: 1rem;
  }
  .save {
    background: var(--color-forest);
    color: var(--color-cream, white);
    border-color: var(--color-forest);
  }
  .save:hover:not(:disabled) {
    background: var(--color-forest-deep, #1f3522);
  }
  .primary {
    display: inline-block;
    background: var(--color-forest);
    color: white;
    padding: 0.9rem 1.5rem;
    border-radius: 6px;
    text-decoration: none;
    font-weight: 600;
    min-height: 48px;
    line-height: 1.4;
  }
  .queued-note {
    margin: 0.8rem 0 0;
    font-size: 0.9rem;
    color: var(--color-ink);
  }
  .queued-list {
    margin-bottom: 0.5rem;
  }
  .error {
    color: var(--color-rust);
    margin: 0.8rem 0 0;
    font-size: 0.9rem;
  }
  .meta {
    margin: 0.6rem 0 0;
    color: var(--color-ink-muted);
  }
  .history-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 0.75rem;
  }
  .history-head h2 {
    margin: 0;
  }
  .history {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .history li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    border: 1px solid var(--color-divider);
    border-radius: 6px;
    background: var(--color-paper);
    flex-wrap: wrap;
  }
  .hist-date {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.85rem;
    color: var(--color-ink-muted);
    min-width: 60px;
  }
  .hist-pest {
    font-size: 0.85rem;
  }
  .hist-value {
    font-weight: 600;
    margin-left: auto;
  }
  .hist-metric {
    font-weight: 400;
    color: var(--color-ink-muted);
    font-size: 0.8rem;
  }
  .muted {
    color: var(--color-ink-muted);
    margin: 0;
  }
  select {
    padding: 0.6rem;
    border: 2px solid var(--color-divider);
    border-radius: 4px;
    font-size: 1rem;
    min-height: 48px;
    width: 100%;
    box-sizing: border-box;
  }
  .height-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .height-field label {
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
    font-weight: 500;
  }
  .height-field :global(input[type='number']) {
    min-height: 48px;
    padding: 0 10px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    background: var(--color-paper);
    color: var(--color-ink);
    font-size: 1.1rem;
  }
  .hint {
    font-size: var(--font-size-caption);
    color: var(--color-ink-muted);
  }
  label[for='scout-block'] {
    display: block;
    margin-bottom: 0.4rem;
    color: var(--color-ink-soft);
    font-size: var(--font-size-caption);
  }
</style>
