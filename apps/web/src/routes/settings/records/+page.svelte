<script lang="ts">
  import { ChevronRight, FileText, Plus } from 'lucide-svelte';
  import SettingsShell from '$lib/components/settings/SettingsShell.svelte';
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte';
  import { createT } from '$lib/i18n';

  let { data } = $props();

  const tr = $derived(createT(data.locale));

  const totalRecords = $derived(
    data.counts.sprays + data.counts.insecticides + data.counts.fungicides + data.counts.harvests
  );
</script>

<svelte:head><title>{tr('settings.records.pageTitle')}</title></svelte:head>

{#snippet tier()}
  <SettingsSection
    title={tr('settings.records.retentionTitle')}
    sub={tr('settings.records.retentionSub')}
  >
    <div class="tile-grid">
      <div class="tile">
        <div class="tile-v serif">
          {tr('settings.records.yearsShort', { n: data.retention.sprayYears })}
        </div>
        <div class="tile-k">{tr('settings.records.minRetention')}</div>
        <div class="tile-note">{tr('settings.records.retentionKinds')}</div>
      </div>
      <div class="tile">
        <div class="tile-v serif">{data.retention.sprayInRetention}</div>
        <div class="tile-k">{tr('settings.records.inRetention')}</div>
        <div class="tile-note">
          {tr('settings.records.withinYears', { n: data.retention.sprayYears })}
        </div>
      </div>
      <div class="tile">
        <div class="tile-v serif">{data.retention.approachingRetention}</div>
        <div class="tile-k">{tr('settings.records.approaching')}</div>
        <div class="tile-note">{tr('settings.records.preExpiry')}</div>
      </div>
      <div class="tile">
        <div class="tile-v serif">{totalRecords}</div>
        <div class="tile-k">{tr('settings.records.retained')}</div>
        <div class="tile-note">
          {tr('settings.records.counts', {
            sprays: data.counts.sprays,
            insecticides: data.counts.insecticides,
            fungicides: data.counts.fungicides,
            harvests: data.counts.harvests
          })}
        </div>
      </div>
    </div>
  </SettingsSection>

  <SettingsSection title={tr('settings.records.lockTitle')} sub={tr('settings.records.lockSub')}>
    <div class="lock-grid">
      <div class="tile">
        <div class="tile-v serif">{data.lockWindowHours} h</div>
        <div class="tile-k">{tr('settings.records.immutableAfter')}</div>
        <div class="tile-note">{tr('settings.records.measuredFrom')}</div>
      </div>
      <div class="warn-card">
        <strong>{tr('settings.records.howItWorks')}</strong>
        {tr('settings.records.howItWorksBody', { hours: data.lockWindowHours })}
      </div>
    </div>
  </SettingsSection>

  <SettingsSection
    title={tr('settings.records.integrityTitle')}
    sub={tr('settings.records.integritySub')}
  >
    <div class="action-row">
      <a class="ghost" href="/api/records/export.vdacs.pdf">
        <FileText size={12} />
        {tr('settings.records.downloadVdacs')}
      </a>
      <a class="ghost" href="/settings/helpers"
        ><Plus size={12} /> {tr('settings.records.inviteInspector')}</a
      >
    </div>
  </SettingsSection>
{/snippet}

<SettingsShell title={tr('settings.records.title')} kicker={tr('settings.records.kicker')}>
  {#if data.chrome === 'quiet'}
    <details class="quiet-tier" data-testid="quiet-compliance">
      <summary>
        <ChevronRight size={18} class="chev" aria-hidden="true" />
        <span>{tr('settings.records.quietSummary')}</span>
      </summary>
      <p class="quiet-lede">
        {tr('settings.records.quietLede', {
          hours: data.lockWindowHours,
          years: data.retention.sprayYears
        })}
      </p>
      {@render tier()}
    </details>
  {:else}
    {@render tier()}
  {/if}
</SettingsShell>

<style>
  .quiet-tier {
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    padding: 0 16px;
  }
  .quiet-tier > summary {
    cursor: pointer;
    min-height: 48px;
    display: flex;
    align-items: center;
    gap: 6px;
    list-style: none;
    font-weight: 600;
    color: var(--color-forest-deep);
  }
  .quiet-tier > summary::-webkit-details-marker {
    display: none;
  }
  .quiet-tier > summary :global(.chev) {
    flex: none;
    transition: transform 0.15s ease;
  }
  .quiet-tier[open] > summary :global(.chev) {
    transform: rotate(90deg);
  }
  .quiet-tier > summary:focus-visible {
    outline: 2px solid var(--color-forest);
    outline-offset: 2px;
  }
  .quiet-lede {
    margin: 0 0 12px;
    color: var(--color-ink-soft);
    font-size: 13.5px;
    line-height: 1.5;
  }
  .tile-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
  }
  .tile {
    padding: 10px 12px;
    background: var(--color-cream);
    border: 1px solid var(--color-divider-soft, var(--color-divider));
    border-radius: 8px;
  }
  .tile-v {
    font-size: 20px;
    color: var(--color-forest-deep);
    line-height: 1;
    font-weight: 600;
    font-family: var(--font-serif, serif);
  }
  .tile-k {
    font-size: 11px;
    color: var(--color-ink);
    margin-top: 5px;
    font-weight: 700;
  }
  .tile-note {
    font-size: 10.5px;
    color: var(--color-ink-muted);
    margin-top: 2px;
  }

  .lock-grid {
    display: grid;
    grid-template-columns: 1fr 2fr;
    gap: 14px;
    align-items: stretch;
  }
  .warn-card {
    padding: 10px 12px;
    background: rgba(212, 167, 92, 0.12);
    border: 1px solid rgba(212, 167, 92, 0.4);
    border-radius: 6px;
    font-size: 11.5px;
    color: #8a6722;
    line-height: 1.5;
  }

  .action-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .ghost {
    background: var(--color-paper);
    color: var(--color-ink);
    border: 1px solid var(--color-divider);
    padding: 6px 12px;
    border-radius: var(--radius-input, 6px);
    text-decoration: none;
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .ghost:hover {
    border-color: var(--color-forest-deep);
  }
  @media (max-width: 760px) {
    .tile-grid {
      grid-template-columns: 1fr 1fr;
    }
    .lock-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
