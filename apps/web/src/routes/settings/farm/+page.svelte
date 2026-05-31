<script lang="ts">
  import { ChevronRight, Plus, Map, MapPin } from 'lucide-svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import SettingsShell from '$lib/components/settings/SettingsShell.svelte';
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte';
  import SettingsField from '$lib/components/settings/SettingsField.svelte';
  import BlockMap from '$lib/components/BlockMap.svelte';

  let { data } = $props();

  // Read-only preview only — edit/draw happens at /settings/farm/map. BlockMap
  // requires these callbacks but never invokes them in thumbnail mode.
  const noop = () => {};

  const hasGeometry = $derived(
    data.mapBlocks.some((b) => b.geometryGeojson) || data.mapFields.some((f) => f.geometryGeojson)
  );

  function fmtDate(ms: number): string {
    return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // Per-block tile color — cycle through a forest/wheat/rust/sky palette
  // so the map preview chips look distinct. Stable across renders by
  // hashing the block id.
  const PALETTE = ['#4F7A52', '#A64A2A', '#9C8147', '#6F8FA8', '#8A5A2C', '#5F8045', '#B8893C'];
  function colorFor(id: string): string {
    let h = 0;
    for (const c of id) h = (h * 31 + c.charCodeAt(0)) % PALETTE.length;
    return PALETTE[h] ?? PALETTE[0];
  }

  const total = $derived(data.blocks.reduce((s, b) => s + (b.acres ?? 0), 0));
</script>

<svelte:head><title>Farm & blocks · CropCard</title></svelte:head>

<SettingsShell title="Farm & blocks" kicker="Field geometry" saveAction="?/save">
  <SettingsSection
    title="Farm details"
    sub="Used by frost-date lookup, weather, and inspector links."
  >
    <div class="grid grid-3">
      <SettingsField label="Farm name">
        <input class="s-input" name="farmName" value={data.farmName || 'Loudoun Home Farm'} />
      </SettingsField>
      <SettingsField label="County">
        <input class="s-input" value="Loudoun, VA" />
      </SettingsField>
      <SettingsField label="USDA hardiness">
        <select class="s-input"><option>7a</option><option>7b</option></select>
      </SettingsField>
    </div>
    <div class="grid grid-3 second-row">
      <SettingsField label="Lat / Long" hint="for frost + GDD">
        <input
          class="s-input mono"
          value={`${data.farmLatLon.lat.toFixed(4)}, ${data.farmLatLon.lon.toFixed(4)}`}
        />
      </SettingsField>
      <SettingsField label="Last frost · spring">
        <input class="s-input" value={fmtDate(data.frostDates.lastSpringFrostMs)} />
      </SettingsField>
      <SettingsField label="First frost · fall">
        <input class="s-input" value={fmtDate(data.frostDates.firstFallFrostMs)} />
      </SettingsField>
    </div>
  </SettingsSection>

  <SettingsSection
    title={`Blocks · ${data.blocks.length} · ${total.toFixed(1)} ac total`}
    sub="Click a block to edit boundary, soil zone, irrigation, or rotation history."
  >
    {#snippet right()}
      <a class="primary-sm" href="/settings/farm/map">
        <Plus size={11} /> New block
      </a>
    {/snippet}

    <div class="grid grid-2">
      <!-- Real read-only BlockMap preview; edit/draw lives at /settings/farm/map. -->
      <div class="map-cell">
        {#if browser && hasGeometry}
          <BlockMap
            thumbnail
            blocks={data.mapBlocks}
            fields={data.mapFields}
            canEdit={false}
            onThumbnailClick={() => goto('/settings/farm/map')}
            onSaveGeometry={noop}
            onCreateWithGeometry={noop}
            onSaveFieldGeometry={noop}
            onCreateFieldWithGeometry={noop}
          />
          <a class="map-edit-link" href="/settings/farm/map">
            <Map size={12} /> Edit fields & blocks
          </a>
        {:else if browser}
          <div class="map-empty">
            <MapPin size={22} />
            <p class="map-empty-title">No field boundaries drawn yet</p>
            <a class="primary-sm" href="/settings/farm/map">
              <Plus size={11} /> Draw your blocks
            </a>
          </div>
        {:else}
          <div class="map-loading mono">Loading map…</div>
        {/if}
      </div>

      <!-- Block list -->
      <div class="block-list">
        {#if data.blocks.length === 0}
          <p class="empty">No blocks yet. <a href="/settings/farm/map">Draw one on the map</a>.</p>
        {/if}
        {#each data.blocks as b (b.id)}
          <a class="block-row" href="/settings/farm/map">
            <div class="block-chip" style:background={colorFor(b.id)}>
              {b.blockLabel ?? b.name.charAt(0)}
            </div>
            <div class="block-text">
              <div class="block-name">{b.name}</div>
              <div class="block-sub mono">{b.fieldName ?? '(no field)'}</div>
            </div>
            <span class="block-acres mono">{(b.acres ?? 0).toFixed(1)} ac</span>
            <ChevronRight size={13} />
          </a>
        {/each}
      </div>
    </div>
  </SettingsSection>

  <SettingsSection title={`Season ${data.currentYear} setup`}>
    <p class="lede">
      Season setup is wizard-synced — edit at
      <a href="/settings/season">/settings/season</a> or via the planning wizard.
    </p>
  </SettingsSection>
</SettingsShell>

<style>
  .grid {
    display: grid;
    gap: 12px;
  }
  .grid-3 {
    grid-template-columns: 1.4fr 1fr 1fr;
  }
  .grid-2 {
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  .second-row {
    grid-template-columns: 1fr 1fr 1fr;
    margin-top: 12px;
  }
  .s-input {
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-ink);
    padding: 8px 10px;
    border-radius: var(--radius-input, 6px);
    font-size: 13.5px;
    font-family: inherit;
    outline: none;
    width: 100%;
  }
  .s-input.mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .s-input:focus {
    border-color: var(--color-forest-deep);
    box-shadow: 0 0 0 2px rgba(44, 82, 55, 0.15);
  }

  /* ── Map ── */
  .map-cell {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .map-edit-link {
    align-self: flex-end;
    color: var(--color-forest-deep);
    text-decoration: none;
    font-size: 11.5px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .map-edit-link:hover {
    text-decoration: underline;
  }
  .map-empty {
    border: 1px dashed var(--color-divider);
    border-radius: 8px;
    background: var(--color-cream);
    min-height: 200px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--color-ink-soft);
    text-align: center;
    padding: 16px;
  }
  .map-empty-title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--color-ink);
  }
  .map-loading {
    border: 1px solid var(--color-divider);
    border-radius: 8px;
    min-height: 200px;
    display: grid;
    place-items: center;
    color: var(--color-ink-muted);
    font-size: 12px;
    background: linear-gradient(180deg, #dce6cf 0%, #c5d4b6 100%);
  }

  /* ── Block list ── */
  .block-list {
    border: 1px solid var(--color-divider-soft, var(--color-divider));
    border-radius: 8px;
    overflow: hidden;
  }
  .empty {
    margin: 12px 16px;
    color: var(--color-ink-soft);
    font-size: 13px;
    font-style: italic;
  }
  .block-row {
    padding: 10px 14px;
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    gap: 12px;
    align-items: center;
    text-decoration: none;
    color: inherit;
    border-top: 1px solid var(--color-divider-soft, var(--color-divider));
  }
  .block-row:first-child {
    border-top: 0;
  }
  .block-row:hover {
    background: var(--color-cream);
  }
  .block-chip {
    width: 26px;
    height: 26px;
    border-radius: 5px;
    color: var(--color-cream, #f8f3e8);
    display: grid;
    place-items: center;
    font-weight: 700;
    font-size: 12px;
  }
  .block-name {
    font-size: 12.5px;
    color: var(--color-ink);
    font-weight: 600;
  }
  .block-sub {
    font-size: 10.5px;
    color: var(--color-ink-muted);
    margin-top: 2px;
  }
  .block-acres {
    font-size: 11.5px;
    color: var(--color-ink-soft);
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }

  /* ── Buttons ── */
  .primary-sm {
    background: var(--color-forest-deep);
    color: var(--color-paper);
    padding: 6px 12px;
    border-radius: var(--radius-input, 6px);
    text-decoration: none;
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .primary-sm:hover {
    filter: brightness(1.08);
  }

  .lede {
    margin: 0;
    color: var(--color-ink-soft);
    font-size: 13px;
  }
  .lede a {
    color: var(--color-forest-deep);
    font-weight: 600;
    text-decoration: none;
  }
  .lede a:hover {
    text-decoration: underline;
  }
  @media (max-width: 760px) {
    .grid-3,
    .grid-2,
    .second-row {
      grid-template-columns: 1fr;
    }
  }
</style>
