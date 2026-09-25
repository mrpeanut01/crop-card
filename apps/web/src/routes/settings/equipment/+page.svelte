<script lang="ts">
  import { Plus, SprayCan, Tractor } from 'lucide-svelte';
  import SettingsShell from '$lib/components/settings/SettingsShell.svelte';
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import type { PageData } from './$types';
  import { fmt, currentPrefs } from '$lib/prefsState.svelte';

  let { data }: { data: PageData } = $props();

  const dirtyCount = $derived(data.sprayers.filter((s) => s.needsDecon).length);
  const otherCount = $derived(data.otherTypes.reduce((n, t) => n + t.count, 0));

  const fmtDate = (ms: number) => fmt.instant(ms, 'date');
  const metricGpa = (gpa: number) =>
    currentPrefs().units === 'metric' ? ` (${fmt.qty(gpa, 'volumePerArea')})` : '';
</script>

<svelte:head><title>Equipment · CropCard</title></svelte:head>

<SettingsShell title="Equipment" kicker="Machinery">
  {#snippet badge()}
    {#if dirtyCount > 0}
      <Pill tone="rust">Decon needed</Pill>
    {/if}
  {/snippet}

  <SettingsSection
    title={`Sprayers & calibration · ${data.sprayers.length}`}
    sub="Calibrated GPA drives every tank-mix calculation. Sprayers that need decon block the next spray until cleaned."
  >
    {#snippet right()}
      <a class="primary-sm" href="/inventory/sprayer/add"><Plus size={11} /> Add sprayer</a>
    {/snippet}

    {#if data.sprayers.length === 0}
      <p class="empty">No sprayers yet. Add one, then run the 1/128-acre calibration.</p>
    {/if}
    {#each data.sprayers as s (s.id)}
      <div class="row">
        <div class="icon"><SprayCan size={16} strokeWidth={1.75} /></div>
        <div class="row-text">
          <a class="row-title" href="/inventory/sprayer/{s.id}">{s.label}</a>
          <div class="row-sub mono">
            {#if s.calibratedGpa != null}
              {s.calibratedGpa.toFixed(1)} GPA{metricGpa(s.calibratedGpa)}{s.calibrationDate
                ? ` · calibrated ${fmtDate(s.calibrationDate)}`
                : ''}
            {:else}
              Uncalibrated
            {/if}
            {#if s.winterizedAt}· winterized {fmtDate(s.winterizedAt)}{/if}
          </div>
        </div>
        <div class="row-actions">
          {#if s.needsDecon}
            <a class="ghost-sm rust" href="/spray/decon?sprayer={encodeURIComponent(s.id)}">Decon</a
            >
          {/if}
          <a class="ghost-sm" href="/calibrate?sprayer={encodeURIComponent(s.id)}">Calibrate</a>
        </div>
      </div>
    {/each}
  </SettingsSection>

  <SettingsSection
    title={`Other equipment · ${otherCount}`}
    sub="Tractors, planters, mowers and the rest. Hour meters, maintenance logs and winterization live on each item."
  >
    {#snippet right()}
      <a class="ghost-sm" href="/equipment">Manage all</a>
    {/snippet}

    {#if data.otherTypes.length === 0}
      <p class="empty">Nothing besides sprayers yet.</p>
    {:else}
      <div class="type-grid">
        {#each data.otherTypes as t (t.type)}
          <div class="type-card">
            <Tractor size={14} strokeWidth={1.75} />
            <span class="type-name">{t.type}</span>
            <span class="type-count mono">{t.count}</span>
          </div>
        {/each}
      </div>
    {/if}
  </SettingsSection>
</SettingsShell>

<style>
  .row {
    padding: 12px 0;
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 14px;
    align-items: center;
    border-top: 1px solid var(--color-divider-soft, var(--color-divider));
  }
  .row:first-child {
    border-top: 0;
  }
  .icon {
    width: 36px;
    height: 36px;
    border-radius: 7px;
    background: rgba(141, 174, 138, 0.18);
    color: var(--color-forest-deep);
    display: grid;
    place-items: center;
  }
  .row-text {
    min-width: 0;
  }
  .row-title {
    font-size: 13.5px;
    color: var(--color-ink);
    font-weight: 600;
    text-decoration: none;
  }
  .row-title:hover {
    text-decoration: underline;
  }
  .row-sub {
    font-size: 11.5px;
    color: var(--color-ink-soft);
    margin-top: 2px;
  }
  .row-actions {
    display: flex;
    gap: 8px;
  }
  .type-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 10px;
  }
  .type-card {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border: 1px solid var(--color-divider-soft, var(--color-divider));
    border-radius: 8px;
    color: var(--color-forest-deep);
  }
  .type-name {
    flex: 1;
    font-size: 12.5px;
    color: var(--color-ink);
    font-weight: 600;
    text-transform: capitalize;
  }
  .type-count {
    font-size: 12px;
    font-weight: 700;
  }
  .empty {
    margin: 0;
    color: var(--color-ink-soft);
    font-size: 13px;
    font-style: italic;
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .primary-sm,
  .ghost-sm {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 48px;
    padding: 6px 14px;
    border-radius: var(--radius-input, 6px);
    font-family: inherit;
    font-size: 12.5px;
    font-weight: 600;
    text-decoration: none;
    white-space: nowrap;
  }
  .primary-sm {
    background: var(--color-forest-deep);
    color: var(--color-paper);
  }
  .ghost-sm {
    background: var(--color-paper);
    color: var(--color-ink);
    border: 1px solid var(--color-divider);
  }
  .ghost-sm:hover {
    border-color: var(--color-forest-deep);
  }
  .ghost-sm.rust {
    color: var(--color-rust, #ba4b38);
    border-color: rgba(186, 75, 56, 0.3);
  }
  @media (max-width: 700px) {
    .row {
      grid-template-columns: auto 1fr;
    }
    .row-actions {
      grid-column: 1 / -1;
    }
  }
</style>
