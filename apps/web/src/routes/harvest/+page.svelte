<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import type { PlantingHarvestStatus } from './+page.server';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Banner from '$lib/components/ui/Banner.svelte';
  import HarvestRouter from '$lib/components/harvest/HarvestRouter.svelte';

  let { data } = $props();

  let recordingFor = $state<string | null>(untrack(() => data.focusPlantingId ?? null));
  // Phase 25c (#88) — HarvestRouter owns the in-form state now; we
  // keep recordingFor + lastError at this level so the parent decides
  // which planting's renderer is active and surfaces error state.
  let lastError = $state<string | null>(null);
  // #324 — PHI warning surfaced after a successful commit (non-blocking).
  let phiWarning = $state<string | null>(null);

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

  /** Phase 25c (#88) — HarvestRouter renderer commit hook. Builds the
   *  POST body, surfaces the new event id on success, reloads, and
   *  routes the error message through `lastError` so the active
   *  renderer can render it. */
  async function commitFromRenderer(
    planting: PlantingHarvestStatus,
    input: { quantity?: string; lotNumber?: string; moisturePct?: number }
  ): Promise<string | null> {
    lastError = null;
    try {
      const res = await fetch('/api/harvest/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blockId: planting.blockId,
          cropPluginId: planting.cropPluginId,
          quantity: input.quantity,
          lotNumber: input.lotNumber,
          // #322 — structured moisture reaches the kernel gate.
          moisturePct: input.moisturePct
        })
      });
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
      recordingFor = null;
      await invalidateAll();
      return (out?.event?.id as string | undefined) ?? null;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      return null;
    }
  }

  function fmtRange(startMs?: number, endMs?: number) {
    if (!startMs || !endMs) return 'unknown';
    const a = new Date(startMs).toLocaleDateString();
    const b = new Date(endMs).toLocaleDateString();
    return `${a} – ${b}`;
  }

  /** Sprint 4 (#197 / CT-HS-001) — archetypes that yield multiple
   *  picks over the season. For these the "Record harvest" form stays
   *  visible after the first pick so the operator can log 2nd, 3rd,
   *  Nth cut/pick. The other archetypes (single-cut-grain, dry-seed,
   *  cure-then-store, etc.) keep the original gate. */
  const RE_HARVEST_ARCHETYPES = new Set([
    'cut-and-come-again',
    'continuous-fruit',
    'tree-fruit-multi-pick'
  ]);
  function allowsReHarvest(p: PlantingHarvestStatus): boolean {
    return p.harvestStyle ? RE_HARVEST_ARCHETYPES.has(p.harvestStyle) : false;
  }

  /** Sprint 4 (#198 / CT-HS-002) — the form is rendered for too-early
   *  + in-window + past plantings so operators can both jump the gun
   *  (weather-shortened seasons) and backfill records weeks late.
   *  Banner copy on the renderer distinguishes the three states. */
  function showHarvestForm(p: PlantingHarvestStatus): boolean {
    if (p.alreadyHarvested && !allowsReHarvest(p)) return false;
    return p.status === 'in-window' || p.status === 'too-early' || p.status === 'past';
  }

  const readyPlantings = $derived(
    data.plantings.filter((p) => p.status === 'in-window' && !p.alreadyHarvested)
  );
  const upcomingPlantings = $derived(data.plantings.filter((p) => p.status === 'too-early'));
  const pastPlantings = $derived(
    data.plantings.filter((p) => p.status === 'past' || p.alreadyHarvested)
  );
  const yearStart = $derived(new Date(new Date().getFullYear(), 0, 1).getTime());
  const eventsYtd = $derived(data.recordedHarvests.filter((e) => e.occurredAt >= yearStart));

  function exportYtdCsv() {
    const rows = [
      ['Date', 'Block', 'Crop plugin', 'Quantity', 'Lot #'],
      ...eventsYtd.map((e) => [
        new Date(e.occurredAt).toISOString().slice(0, 10),
        e.blockName ?? e.blockId,
        e.cropPluginId,
        e.quantity ?? '',
        e.lotNumber ?? ''
      ])
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `harvest-ytd-${new Date().getFullYear()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<svelte:head>
  <title>Harvest — CropCard</title>
</svelte:head>

<header class="page-header">
  <Kicker>Harvest · {new Date().getFullYear()} season</Kicker>
  <h1 class="serif">Harvest.</h1>
  <p class="stat-line">
    <strong>{readyPlantings.length}</strong> ready today ·
    <strong>{upcomingPlantings.length}</strong> upcoming windows ·
    <strong>{eventsYtd.length}</strong> events logged YTD
  </p>
  <div class="page-actions">
    <button class="ghost" type="button" onclick={exportYtdCsv} disabled={eventsYtd.length === 0}>
      Export YTD ↓
    </button>
  </div>
</header>

{#if phiWarning}
  <div class="phi-banner">
    <Banner tone="wheat">
      <strong>⚠ Pre-harvest interval:</strong>
      {phiWarning}
      <button class="phi-dismiss" type="button" onclick={() => (phiWarning = null)}
        >Acknowledge</button
      >
    </Banner>
  </div>
{/if}

{#if data.plantings.length === 0}
  <section class="card empty">
    <h2>No plantings yet</h2>
    <p>Add a planting on <a href="/plan">/plan</a> first.</p>
  </section>
{:else}
  <section class="card panel ready">
    <h2>Plantings <span class="panel-count">{readyPlantings.length} ready</span></h2>
    <ul class="plantings">
      {#each data.plantings as p (p.plantingId)}
        <li
          id="planting-{p.plantingId}"
          class="planting status-{p.status}"
          class:harvested={p.alreadyHarvested}
          class:focused={data.focusPlantingId === p.plantingId}
        >
          <header>
            <strong>{p.varietyDisplayName}</strong>
            <span class="block">{p.blockName}</span>
            {#if p.cropFamily}
              <span class="family">{p.cropFamily}</span>
            {/if}
            {#if p.alreadyHarvested}
              <span class="badge harvested">✓ harvested</span>
            {:else if p.status === 'in-window'}
              <span class="badge in-window">⛏ ready now</span>
            {:else if p.status === 'past'}
              <span class="badge past">⚠ past window</span>
            {:else if p.status === 'too-early'}
              <span class="badge too-early">⏳ too early</span>
            {/if}
          </header>
          <div class="meta">
            {#if p.plantingDate}Planted {new Date(p.plantingDate).toLocaleDateString()} ·
            {/if}Window {fmtRange(p.windowStartMs, p.windowEndMs)}
            {#if p.status === 'too-early'}· {p.daysUntilWindow}d until window{/if}
            {#if p.status === 'in-window'}· {p.daysIntoWindow}d into window{/if}
            {#if p.status === 'past'}· {p.daysPastWindow}d past{/if}
          </div>

          {#if p.harvestIndicators.length > 0}
            {#if p.status === 'in-window' && !p.alreadyHarvested}
              <div class="indicators-inline">
                <strong>Readiness indicators</strong>
                <ul class="indicators">
                  {#each p.harvestIndicators as ind}<li>{ind}</li>{/each}
                </ul>
              </div>
            {:else}
              <details>
                <summary>Readiness indicators</summary>
                <ul class="indicators">
                  {#each p.harvestIndicators as ind}<li>{ind}</li>{/each}
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
                Hay &amp; forage plantings use the cutting workflow.
                <a href="/hay?block={p.blockId}">Open /hay for this block →</a>
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
                  Plugin DTM suggests this isn't ready yet ({p.daysUntilWindow}d to window). Record
                  anyway?
                </Banner>
              </div>
            {:else if p.status === 'past'}
              <div class="window-banner">
                <Banner tone="sky">
                  Window closed {p.daysPastWindow}d ago — logging late?
                </Banner>
              </div>
            {/if}
            <!-- #197 — re-harvest archetypes keep the form available
                 even after the first pick so cut-and-come-again leafies,
                 continuous-fruit (tomato, pepper) and tree-fruit-multi-
                 pick (apple, peach) can log 2nd, 3rd, Nth picks. -->
            {#if p.alreadyHarvested && allowsReHarvest(p)}
              <div class="window-banner">
                <Banner tone="sky">
                  This {p.harvestStyle === 'cut-and-come-again'
                    ? 'cut-and-come-again'
                    : p.harvestStyle === 'continuous-fruit'
                      ? 'continuous-fruit'
                      : 'tree-fruit-multi-pick'} planting supports repeat harvest — log additional picks
                  here.
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
              </div>
            {:else}
              <button class="primary" onclick={() => startRecord(p.plantingId)}>
                {p.alreadyHarvested ? 'Record another pick' : 'Record harvest'}
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
    <h2>Upcoming windows <span class="panel-count">{upcomingPlantings.length}</span></h2>
    <ul class="upcoming-list">
      {#each upcomingPlantings.slice(0, 8) as p (p.plantingId)}
        <li>
          <strong>{p.varietyDisplayName}</strong>
          <span class="up-block">· {p.blockName}</span>
          {#if p.windowStartMs}
            <span class="up-when">
              opens {new Date(p.windowStartMs).toLocaleDateString()} ({p.daysUntilWindow}d)
            </span>
          {/if}
        </li>
      {/each}
      {#if upcomingPlantings.length > 8}
        <li class="more">+ {upcomingPlantings.length - 8} more upcoming.</li>
      {/if}
    </ul>
  </section>
{/if}

{#if data.recordedHarvests.length > 0}
  {@const inCuring = data.recordedHarvests.filter((h) => h.curing && h.curing.phase !== 'overdue')}
  {#if inCuring.length > 0}
    <section class="card curing-card">
      <h2>Curing in progress (FR-08)</h2>
      <ul class="curing-list">
        {#each inCuring as h (h.id)}
          <li class="curing-item phase-{h.curing!.phase}">
            <header>
              <strong>{h.cropPluginId}</strong>
              {#if h.lotNumber}<span class="lot">lot {h.lotNumber}</span>{/if}
              <span class="phase-badge phase-{h.curing!.phase}">
                {h.curing!.phase === 'in-progress' ? '⏳ in progress' : '✓ ready window'}
              </span>
            </header>
            <p class="meta">
              Harvested {new Date(h.occurredAt).toLocaleDateString()} · method: {h.curing!.method ??
                '—'} ·
              {h.curing!.minWeeks}–{h.curing!.maxWeeks} wk
            </p>
            {#if h.curing!.phase === 'in-progress'}
              <p class="countdown">
                <strong>{h.curing!.daysRemaining}</strong> day{h.curing!.daysRemaining === 1
                  ? ''
                  : 's'}
                until ready window opens
              </p>
            {:else}
              <p class="countdown ready">
                <strong>Ready now</strong> — verify
                {#if h.curing!.targetMoisturePercent}
                  moisture {h.curing!.targetMoisturePercent.min}–{h.curing!.targetMoisturePercent
                    .max}%
                {:else}
                  by feel + visual check
                {/if}
                · {h.curing!.daysRemaining} day{h.curing!.daysRemaining === 1 ? '' : 's'} until window
                closes
                {#if h.curing!.storageLocation}
                  · then move to <em>{h.curing!.storageLocation}</em>
                {/if}
              </p>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="card">
    <h2>Recorded harvests</h2>
    <table>
      <thead>
        <tr>
          <th>When</th>
          <th>Block</th>
          <th>Variety</th>
          <th>Quantity</th>
          <th>Lot</th>
          <th>Curing</th>
        </tr>
      </thead>
      <tbody>
        {#each data.recordedHarvests as h (h.id)}
          <tr>
            <td>{new Date(h.occurredAt).toLocaleDateString()}</td>
            <td>{h.blockName ?? `(deleted block)`}</td>
            <td><code>{h.cropPluginId}</code></td>
            <td>{h.quantity ?? '—'}</td>
            <td>{h.lotNumber ?? '—'}</td>
            <td>
              {#if h.curing}
                <span class="phase-badge phase-{h.curing.phase}">
                  {h.curing.phase === 'in-progress'
                    ? `${h.curing.daysRemaining}d → ready`
                    : h.curing.phase === 'ready'
                      ? `ready (${h.curing.daysRemaining}d left)`
                      : 'overdue — store now'}
                </span>
              {:else}
                <span class="muted">no curing data</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
{/if}

<style>
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
  .empty {
    text-align: center;
    padding: 2rem;
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
  code {
    background: #f5f5f5;
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
    font-size: 0.8rem;
  }
</style>
