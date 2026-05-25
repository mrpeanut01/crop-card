<script lang="ts">
  import { Wrench, AlertTriangle, CheckCircle2 } from 'lucide-svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';

  let { data } = $props();

  function fmtDate(ms: number | null): string {
    if (!ms) return '—';
    return new Date(ms).toLocaleDateString();
  }

  type SprayerRow = (typeof data.equipment)[number];
  const dirtyCount = $derived(data.equipment.filter((e: SprayerRow) => e.requiresDecon).length);
  const uncalibratedCount = $derived(
    data.equipment.filter((e: SprayerRow) => e.calibratedGpa == null).length
  );
</script>

<svelte:head>
  <title>Sprayers & calibration · CropCard</title>
</svelte:head>

<a class="back-link" href="/settings">← All settings</a>
<header class="page-head">
  <Kicker>Sprayer hygiene · GPA calibration</Kicker>
  <h1>Sprayers & calibration</h1>
  <p class="lede">
    {data.equipment.length} sprayer{data.equipment.length === 1 ? '' : 's'} ·
    {dirtyCount} need{dirtyCount === 1 ? 's' : ''} decon · {uncalibratedCount} uncalibrated
  </p>
</header>

<section class="card">
  <header class="card-head">
    <h2>Roster</h2>
    <a class="action-link" href="/equipment">+ Add sprayer</a>
  </header>

  {#if data.equipment.length === 0}
    <p class="empty">
      No sprayers configured. Add one at <a href="/equipment">/equipment</a> first; this page
      lists each unit's calibration + contamination state.
    </p>
  {:else}
    <ul class="sprayer-list">
      {#each data.equipment as e (e.id)}
        <li class="sprayer">
          <header>
            <div class="title">
              <Wrench size={16} strokeWidth={1.75} />
              {e.label}
            </div>
            <div class="badges">
              {#if e.requiresDecon}
                <Pill tone="rust">
                  <AlertTriangle size={11} />
                  decon
                </Pill>
              {/if}
              {#if e.calibratedGpa != null}
                <Pill tone="forest">
                  <CheckCircle2 size={11} />
                  {e.calibratedGpa} GPA
                </Pill>
              {:else}
                <Pill tone="wheat">uncalibrated</Pill>
              {/if}
            </div>
          </header>
          <dl class="kv">
            <dt>Last calibrated</dt>
            <dd>{fmtDate(e.calibrationDate)}</dd>
            <dt>Last used</dt>
            <dd>{fmtDate(e.lastUsedAt)} {e.lastChemistryClass ? `(${e.lastChemistryClass})` : ''}</dd>
          </dl>
          <div class="actions">
            <a class="ghost" href="/calibrate?sprayerId={e.id}">Calibrate (1/128-acre)</a>
            <a class="ghost" href="/equipment/{e.id}">Details / decon log</a>
          </div>
        </li>
      {/each}
    </ul>
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
    margin: 0 0 16px;
    font-size: 13.5px;
    color: var(--color-ink-soft);
  }
  .card {
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card, 8px);
    padding: 18px;
  }
  .card-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }
  .card-head h2 {
    margin: 0;
    font-size: 16px;
    color: var(--color-ink);
  }
  .action-link {
    font-size: 13px;
    color: var(--color-forest-deep);
    text-decoration: none;
    font-weight: 600;
  }
  .action-link:hover {
    text-decoration: underline;
  }
  .empty {
    margin: 0;
    color: var(--color-ink-soft);
    font-size: 13.5px;
    font-style: italic;
  }
  .sprayer-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .sprayer {
    background: var(--color-cream);
    border: 1px solid var(--color-divider-soft);
    border-radius: var(--radius-input, 6px);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .sprayer header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    font-weight: 600;
    color: var(--color-ink);
  }
  .badges {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .kv {
    margin: 0;
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 12px;
    font-size: 12.5px;
  }
  .kv dt {
    color: var(--color-ink-muted);
    font-weight: 600;
  }
  .kv dd {
    margin: 0;
    color: var(--color-ink);
  }
  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .ghost {
    padding: 6px 12px;
    background: var(--color-paper);
    color: var(--color-ink);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    text-decoration: none;
    font-size: 12.5px;
    font-weight: 600;
  }
  .ghost:hover {
    border-color: var(--color-forest-deep);
  }
</style>
