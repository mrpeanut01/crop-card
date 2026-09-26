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
  import SetupSheet from '$lib/components/setup/SetupSheet.svelte';
  import { focusAfterSetup } from '$lib/components/setup/focusAfterSetup';
  import SetupCallout from '$lib/components/setup/SetupCallout.svelte';
  import SetupSpot from '$lib/components/setup/SetupSpot.svelte';
  import SpotSelect from '$lib/components/setup/SpotSelect.svelte';
  import { emptyAreas } from '$lib/setup/spot';
  import type { SetupSpotResult } from '$lib/setup/types';
  import QueuedBadge from '$lib/components/ui/QueuedBadge.svelte';

  interface QueuedObservation {
    id: string;
    blockId: string;
    pest: string;
    metric: string;
    value: number;
    occurredAt: number;
    rejected: boolean;
  }

  let { data } = $props();

  let selectedBlockId = $state(untrack(() => data.preselectedBlockId ?? data.blocks[0]?.id ?? ''));

  let spotSheetOpen = $state(false);
  async function onSpotAdded(r: SetupSpotResult) {
    spotSheetOpen = false;
    await invalidateAll();
    selectedBlockId = r.blockId;
    await focusAfterSetup('#scout-block');
  }

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
  let uploaded = $state(false);
  let saveQueued = $state(false);
  let queued = $state<QueuedObservation[]>([]);
  let queuedThisSession = $state<string[]>([]);
  const result = $derived(evaluateScout({ spots, maxWeedHeightInches: maxHeight ?? undefined }));
  let note = $state('');
  const noteText = $derived(note.trim());
  // The four zero spots are placeholders; a walk only counts once the user enters a count.
  let spotsEdited = $state(false);
  const counted = $derived(result.spotsCounted > 0 && (spotsEdited || maxHeight != null));
  const canSave = $derived(counted || noteText.length > 0);
  const showPicker = $derived(
    data.blocks.length > 0 || (data.setup.canEdit && emptyAreas(data.setup.areas).length > 0)
  );

  const selectedBlock = $derived(data.blocks.find((b) => b.id === selectedBlockId));

  /** Prior observations for the selected block, newest first. Comes from
   *  `listScoutObservations({ blockId, fromMs })` in the loader. */
  const observationsForBlock = $derived(data.observationsByBlock[selectedBlockId] ?? []);
  const queuedForBlock = $derived(queued.filter((q) => q.blockId === selectedBlockId));

  function toQueued(id: string, payload: unknown, rejected: boolean): QueuedObservation | null {
    if (!payload || typeof payload !== 'object') return null;
    const p = payload as Partial<QueuedObservation>;
    if (typeof p.blockId !== 'string' || typeof p.value !== 'number') return null;
    return {
      id,
      blockId: p.blockId,
      pest: String(p.pest ?? ''),
      metric: String(p.metric ?? ''),
      value: p.value,
      occurredAt: typeof p.occurredAt === 'number' ? p.occurredAt : Date.now(),
      rejected
    };
  }

  async function refreshQueued(): Promise<void> {
    try {
      const { listPendingForActiveOwner } = await import('$lib/client/syncQueue');
      const rows = await listPendingForActiveOwner();
      const next = rows
        .filter((r) => r.kind === 'scout')
        .map((r) => toQueued(r.id, r.payload, r.status === 'rejected'))
        .filter((q): q is QueuedObservation => q !== null)
        .sort((a, b) => b.occurredAt - a.occurredAt);
      const waiting = (list: QueuedObservation[]) => list.filter((q) => !q.rejected).length;
      const drained = waiting(next) < waiting(queued);
      queued = next;
      if (saveQueued && queuedThisSession.length > 0) {
        const still = new Set(next.map((q) => q.id));
        if (queuedThisSession.every((id) => !still.has(id))) {
          saveQueued = false;
          saveSuccess = true;
          uploaded = true;
          queuedThisSession = [];
        }
      }
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
    const id = await enqueueRecord('scout', payload);
    queuedThisSession = [...queuedThisSession, id];
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
    spotsEdited = true;
  }
  function removeSpot(i: number) {
    spots = spots.filter((_, idx) => idx !== i);
    spotsEdited = true;
  }

  async function saveObservation(): Promise<void> {
    if (!selectedBlockId) {
      saveError = 'Pick a spot first.';
      return;
    }
    if (!canSave) {
      saveError = 'Write a note or count at least one spot before saving.';
      return;
    }
    saving = true;
    saveError = null;
    saveSuccess = false;
    uploaded = false;
    saveQueued = false;
    let payload: Record<string, unknown> | null = null;
    try {
      // One observation per scout walk; value is the average count, with
      // raw per-spot counts + the tallest-weed measurement preserved in
      // notes so the IPM evaluator can read the canonical average AND
      // historical context lives in the audit trail.
      if (!counted) {
        payload = {
          blockId: selectedBlockId,
          pest: 'note',
          metric: 'note',
          value: 0,
          notes: noteText.slice(0, 500),
          occurredAt: Date.now()
        };
      } else {
        const notes = [
          `spots=[${spots.map((s) => s.weedsPer10SqFt).join(',')}]`,
          maxHeight != null && Number.isFinite(maxHeight)
            ? `tallest_in=${Number(maxHeight.toFixed(2))}`
            : null,
          `decision=${result.decision}`,
          noteText ? `note: ${noteText}` : null
        ]
          .filter(Boolean)
          .join(' ')
          .slice(0, 500);
        payload = {
          blockId: selectedBlockId,
          pest: 'broadleaf-weed',
          metric: 'avg-per-10sqft',
          value: result.averagePer10SqFt,
          notes,
          occurredAt: Date.now()
        };
      }
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
      note = '';
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
    <Kicker>Scout</Kicker>
    <h1 class="serif">What did you see?</h1>
  </div>
  <Pill tone="forest">SCOUT</Pill>
</header>
<p class="lede">
  Jot down what you notice on a walk. Counting weeds? The weed count below tells you whether it's
  time to spray.
</p>

{#if showPicker}
  <div class="card-wrap">
    <Card>
      <h2>Where</h2>
      <label for="scout-block">Which spot are you scouting?</label>
      <SpotSelect
        id="scout-block"
        blocks={data.blocks.map((b) => ({ id: b.id, label: b.name }))}
        areas={data.setup.areas}
        canEdit={data.setup.canEdit}
        bind:value={selectedBlockId}
        onSpotAdded={async (r) => {
          await invalidateAll();
          selectedBlockId = r.blockId;
        }}
        onNewSpot={() => (spotSheetOpen = true)}
      />
      {#if data.windowStage}
        <p class="meta">Window: <strong>{data.windowStage}</strong> (from today's calendar)</p>
      {/if}
    </Card>
  </div>
{:else}
  <SetupCallout
    kicker="Where?"
    title="Where are you scouting?"
    canEdit={data.setup.canEdit}
    askOwner="Ask the owner to add the spot you're scouting. Once it's on the farm it shows up here."
    testId="scout-where"
  >
    <p>
      Counts are saved against a spot so you can see the trend next time. Give this one a name, no
      map needed.
    </p>
    {#snippet actions()}
      <button type="button" class="primary" onclick={() => (spotSheetOpen = true)}>
        Name a new spot
      </button>
    {/snippet}
  </SetupCallout>
{/if}

<SetupSheet
  open={spotSheetOpen}
  kicker="Scout"
  title="Where?"
  onClose={() => (spotSheetOpen = false)}
  onDone={onSpotAdded}
>
  {#snippet children(done)}
    <SetupSpot areas={data.setup.areas} canEdit={data.setup.canEdit} onDone={done} />
  {/snippet}
</SetupSheet>

<div class="card-wrap">
  <Card>
    <h2>Note</h2>
    <label for="scout-note">What did you notice? <span class="optional">(optional)</span></label>
    <textarea
      id="scout-note"
      rows="3"
      maxlength="400"
      placeholder="Aphids on the kale, leaves chewed on the beans"
      bind:value={note}
    ></textarea>
  </Card>
</div>

<div class="card-wrap">
  <Card>
    <h2>Weed count</h2>
    <p class="meta">
      For deciding on a weed spray: count broadleaves in 4 or 5 random 10 sq ft spots and note the
      tallest weed. Spray when the average is 3 or more per 10 sq ft, or any weed is taller than {fmt.qty(
        2,
        'length'
      )}.
    </p>
    {#each spots as _, i (i)}
      <label class="spot">
        Spot {i + 1}: weeds in 10 sq ft
        <input
          type="number"
          min="0"
          step="1"
          bind:value={spots[i].weedsPer10SqFt}
          oninput={() => (spotsEdited = true)}
        />
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
      disabled={saving || !canSave || !selectedBlockId}
    >
      {saving
        ? 'Saving…'
        : uploaded
          ? '✓ Uploaded. Save another?'
          : saveSuccess
            ? '✓ Saved. Save another?'
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
  {:else if uploaded}
    <p class="queued-note" role="status" data-testid="scout-uploaded">
      Uploaded. Your observation is saved to the farm.
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
      <ul class="history queued-list" aria-label="Saved on this device">
        {#each queuedForBlock as q (q.id)}
          <li>
            <span class="hist-date">{fmtDate(q.occurredAt)}</span>
            {#if q.metric === 'note'}
              <span class="hist-note">Note</span>
            {:else}
              <span class="hist-pest">{q.pest}</span>
              <span class="hist-value">
                {q.value.toFixed(2)}
                <span class="hist-metric">{q.metric}</span>
              </span>
            {/if}
            {#if q.rejected}
              <a class="not-saved" href="/records/pending">Not saved - see Pending records</a>
            {:else}
              <QueuedBadge />
            {/if}
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
            {#if o.metric === 'note'}
              <span class="hist-note">{o.note ?? 'Note'}</span>
            {:else}
              <span class="hist-pest">{o.pest}</span>
              <span class="hist-value">
                {o.value.toFixed(2)}
                <span class="hist-metric">{o.metric}</span>
              </span>
              {#if o.value >= 3}
                <Pill tone="rust">over threshold</Pill>
              {/if}
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </Card>
</div>

<style>
  textarea {
    width: 100%;
    box-sizing: border-box;
    min-height: 96px;
    padding: 10px 12px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    background: var(--color-paper);
    font: inherit;
    font-size: 16px;
  }
  .optional {
    font-weight: 400;
    color: var(--color-ink-soft);
  }
  .hist-note {
    flex: 1;
    color: var(--color-ink);
  }
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
  .not-saved {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    font-size: var(--font-size-meta);
    font-weight: 600;
    color: var(--color-rust);
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
