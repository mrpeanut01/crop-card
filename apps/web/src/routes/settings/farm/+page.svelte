<script lang="ts">
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>Farm & blocks · CropCard</title>
</svelte:head>

<a class="back-link" href="/settings">← All settings</a>
<header class="page-head">
  <Kicker>Farm geometry · season config</Kicker>
  <h1>Farm & blocks</h1>
  <p class="lede">
    {data.fields.length} field{data.fields.length === 1 ? '' : 's'} · {data.blocks.length} block{data
      .blocks.length === 1
      ? ''
      : 's'} · Loudoun County, VA defaults applied where unset.
  </p>
</header>

<section class="card">
  <h2>Blocks</h2>
  {#if data.blocks.length === 0}
    <p class="empty">
      No blocks yet. <a href="/plan">Go to /plan</a> to add the first one.
    </p>
  {:else}
    <ul class="block-list">
      {#each data.blocks as b (b.id)}
        <li class="block-row">
          <div class="block-name">
            {#if b.blockLabel}<span class="label-chip">{b.blockLabel}</span>{/if}
            {b.name}
          </div>
          <div class="block-meta">
            {b.acres} ac · {b.fieldName ?? '(no field)'} · {b.plantingCount} planting{b.plantingCount ===
            1
              ? ''
              : 's'}
          </div>
        </li>
      {/each}
    </ul>
    <p class="hint">
      Block CRUD lives at <a href="/plan?tab=layout">/plan (Layout tab)</a> where you can also
      paint geometry on the map.
    </p>
  {/if}
</section>

<section class="card">
  <h2>Location & climate</h2>
  <dl class="kv">
    <dt>Lat / lon</dt>
    <dd class="mono">
      {data.farmLatLon.lat.toFixed(4)}, {data.farmLatLon.lon.toFixed(4)}
    </dd>
    <dt>Last spring frost (avg)</dt>
    <dd>{new Date(data.frostDates.lastSpringFrostMs).toLocaleDateString()}</dd>
    <dt>First fall frost (avg)</dt>
    <dd>{new Date(data.frostDates.firstFallFrostMs).toLocaleDateString()}</dd>
  </dl>
  <p class="hint">
    Edit lat/lon and frost dates from <a href="/settings/system">Power tools → Location & Climate</a>.
    A dedicated form here lands when the structural rebuild finishes.
  </p>
</section>

<section class="card">
  <h2>Season {data.currentYear} setup</h2>
  {#if data.activeSeasonSetup}
    <dl class="kv">
      <dt>Philosophy</dt>
      <dd><Pill tone="forest">{data.activeSeasonSetup.philosophy ?? 'unset'}</Pill></dd>
      <dt>Fertility approach</dt>
      <dd><Pill tone="wheat">{data.activeSeasonSetup.fertilityApproach ?? 'unset'}</Pill></dd>
      <dt>Weed strategy</dt>
      <dd>{data.activeSeasonSetup.weedStrategy ?? '—'}</dd>
      <dt>Pest strategy</dt>
      <dd>{data.activeSeasonSetup.pestStrategy ?? '—'}</dd>
    </dl>
    <a class="action-link" href="/settings/season">Edit season setup →</a>
  {:else}
    <p class="empty">
      No setup recorded for {data.currentYear} yet.
      <a href="/settings/season">Set it up now →</a>
    </p>
  {/if}
</section>

<style>
  .back-link {
    display: inline-block;
    margin-bottom: 12px;
    font-size: 13px;
    color: var(--color-forest-deep);
    text-decoration: none;
  }
  .back-link:hover {
    text-decoration: underline;
  }
  .page-head h1 {
    margin: 4px 0 8px;
    font-family: var(--font-serif, serif);
    font-size: 26px;
    color: var(--color-forest-deep);
  }
  .lede {
    margin: 0 0 18px;
    font-size: 13.5px;
    color: var(--color-ink-soft);
    line-height: 1.45;
  }
  .card {
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card, 8px);
    padding: 18px;
    margin-bottom: 16px;
  }
  .card h2 {
    margin: 0 0 12px;
    font-size: 16px;
    color: var(--color-ink);
  }
  .empty {
    margin: 0;
    color: var(--color-ink-soft);
    font-size: 13.5px;
    font-style: italic;
  }
  .block-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .block-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    background: var(--color-cream);
    border: 1px solid var(--color-divider-soft);
    border-radius: var(--radius-input, 6px);
  }
  .block-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--color-ink);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .label-chip {
    background: var(--color-forest-deep);
    color: var(--color-paper);
    padding: 2px 7px;
    border-radius: 4px;
    font-size: 11px;
    font-family: var(--font-mono, monospace);
    font-weight: 700;
  }
  .block-meta {
    font-size: 12px;
    color: var(--color-ink-muted);
  }
  .hint {
    margin: 12px 0 0;
    font-size: 12.5px;
    color: var(--color-ink-muted);
  }
  .kv {
    margin: 0;
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 8px 16px;
    font-size: 13.5px;
  }
  .kv dt {
    color: var(--color-ink-muted);
    font-weight: 600;
  }
  .kv dd {
    margin: 0;
    color: var(--color-ink);
  }
  .mono {
    font-family: var(--font-mono, monospace);
    font-size: 13px;
  }
  .action-link {
    display: inline-block;
    margin-top: 12px;
    color: var(--color-forest-deep);
    text-decoration: none;
    font-weight: 600;
    font-size: 13.5px;
  }
  .action-link:hover {
    text-decoration: underline;
  }
</style>
