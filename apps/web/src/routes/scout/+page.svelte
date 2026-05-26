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
  import { untrack } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import Card from '$lib/components/ui/Card.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';

  let { data } = $props();

  let selectedBlockId = $state(untrack(() => data.preselectedBlockId ?? data.blocks[0]?.id ?? ''));

  let spots = $state<ScoutSpot[]>([
    { weedsPer10SqFt: 0 },
    { weedsPer10SqFt: 0 },
    { weedsPer10SqFt: 0 },
    { weedsPer10SqFt: 0 }
  ]);
  let maxHeight = $state<number | undefined>(undefined);

  let saving = $state(false);
  let saveError = $state<string | null>(null);
  let saveSuccess = $state(false);

  const result = $derived(evaluateScout({ spots, maxWeedHeightInches: maxHeight }));
  const selectedBlock = $derived(data.blocks.find((b) => b.id === selectedBlockId));

  /** Prior observations for the selected block, newest first. Comes from
   *  `listScoutObservations({ blockId, fromMs })` in the loader. */
  const observationsForBlock = $derived(data.observationsByBlock[selectedBlockId] ?? []);

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
    try {
      // One observation per scout walk; value is the average count, with
      // raw per-spot counts + the tallest-weed measurement preserved in
      // notes so the IPM evaluator can read the canonical average AND
      // historical context lives in the audit trail.
      const notes = [
        `spots=[${spots.map((s) => s.weedsPer10SqFt).join(',')}]`,
        maxHeight != null && Number.isFinite(maxHeight) ? `tallest_in=${maxHeight}` : null,
        `decision=${result.decision}`
      ]
        .filter(Boolean)
        .join(' ');
      const res = await fetch('/api/scout/record', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          blockId: selectedBlockId,
          pest: 'broadleaf-weed',
          metric: 'avg-per-10sqft',
          value: result.averagePer10SqFt,
          notes,
          occurredAt: Date.now()
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        saveError = body.error ?? `HTTP ${res.status}`;
        return;
      }
      saveSuccess = true;
      await invalidateAll();
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  function fmtDate(ms: number): string {
    return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
  threshold: ≥ 3 weeds / 10 sq ft on average, or any weed taller than 2 inches → spray.
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
    <Input
      label="Tallest weed observed (in)"
      hint="Leave blank if you didn't measure. Example: 1.5"
      type="number"
      step="0.5"
      min="0"
      bind:value={maxHeight}
    />
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
      {saving ? 'Saving…' : saveSuccess ? '✓ Saved — save another?' : 'Save observation'}
    </button>
    {#if result.decision === 'SPRAY'}
      <a href={planSprayHref} class="primary">
        Plan the spray{selectedBlock ? ` for ${selectedBlock.name}` : ''} →
      </a>
    {/if}
  </div>
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
    {#if observationsForBlock.length === 0}
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
  label[for='scout-block'] {
    display: block;
    margin-bottom: 0.4rem;
    color: var(--color-ink-soft);
    font-size: var(--font-size-caption);
  }
</style>
