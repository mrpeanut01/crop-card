<script lang="ts">
  import { Search, Plus, FileText } from 'lucide-svelte';
  import SettingsShell from '$lib/components/settings/SettingsShell.svelte';
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';

  let { data } = $props();

  const TYPE_LABEL: Record<string, string> = {
    crop: 'Crops',
    herbicide: 'Herbicides',
    insecticide: 'Insecticides',
    fungicide: 'Fungicides',
    fertilizer: 'Fertilizers',
    companion: 'Companions'
  };
</script>

<svelte:head><title>Plugins & crop library · CropCard</title></svelte:head>

<SettingsShell title="Plugins & crop library" kicker="Catalog">
  {#snippet badge()}
    {#if data.updatesAvailable > 0}
      <Pill tone="wheat">{data.updatesAvailable} updates</Pill>
    {/if}
  {/snippet}

  <SettingsSection
    title="Plugin inventory"
    sub="All data-only. Plugin engine validates on registration; no JS executes from plugin files."
  >
    <div class="tile-grid">
      {#each data.byType as t (t.type)}
        <div class="tile">
          <div class="tile-count serif">{t.count}</div>
          <div class="tile-label">{TYPE_LABEL[t.type] ?? t.type}</div>
        </div>
      {/each}
    </div>
    <div class="action-row">
      <a class="ghost" href="/plugins/community"><Search size={13} /> Browse marketplace</a>
      <a class="ghost" href="/plugins/new"><Plus size={13} /> Upload plugin JSON</a>
      <a class="ghost" href="/plugins"><FileText size={13} /> All plugins</a>
    </div>
  </SettingsSection>

  <SettingsSection
    title={`Pending draft plugins · ${data.pluginFailures}`}
    sub="Stock entries that aren't EPA-registered yet. Curator review before safety-kernel eligibility."
  >
    {#if data.pluginFailures === 0}
      <p class="empty">
        No drafts pending review. New stock entries appear here when uploaded with missing fields.
      </p>
    {/if}
  </SettingsSection>

  <SettingsSection
    title={`Updates available · ${data.updatesAvailable}`}
    sub="Plugin maintainers occasionally push label corrections."
  >
    {#if data.updatesAvailable === 0}
      <p class="empty">
        No updates pending. New plugin versions surface here when the marketplace sync runs.
      </p>
    {/if}
  </SettingsSection>
</SettingsShell>

<style>
  .tile-grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 10px;
  }
  .tile {
    padding: 10px 12px;
    background: var(--color-cream);
    border: 1px solid var(--color-divider-soft, var(--color-divider));
    border-radius: 8px;
  }
  .tile-count {
    font-size: 22px;
    color: var(--color-forest-deep);
    line-height: 1;
    font-weight: 600;
    letter-spacing: -0.02em;
    font-family: var(--font-serif, serif);
  }
  .tile-label {
    font-size: 10.5px;
    color: var(--color-ink-muted);
    margin-top: 4px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .action-row {
    margin-top: 12px;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .ghost {
    background: var(--color-paper);
    color: var(--color-ink);
    border: 1px solid var(--color-divider);
    padding: 8px 14px;
    border-radius: var(--radius-input, 6px);
    text-decoration: none;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 36px;
  }
  .ghost:hover {
    border-color: var(--color-forest-deep);
  }
  .empty {
    margin: 0;
    color: var(--color-ink-soft);
    font-size: 13px;
    font-style: italic;
  }
  @media (max-width: 760px) {
    .tile-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }
  @media (max-width: 480px) {
    .tile-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
