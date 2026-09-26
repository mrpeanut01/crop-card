<script lang="ts">
  import Modal from '$lib/components/ui/Modal.svelte';
  import { AREA_KINDS, AREA_KIND_LABELS, type AreaKind } from '$lib/farm/areaKinds';
  import { AREA_KIND_STYLE } from '$lib/farm/kindStyle';
  import { toggleKind, type MapFilter } from '$lib/farm/mapFilter';

  const {
    open,
    onClose,
    filter,
    onChange,
    counts,
    showBaseLayer = true,
    hasShade = false,
    canAdd = false
  }: {
    open: boolean;
    onClose: () => void;
    filter: MapFilter;
    onChange: (next: MapFilter) => void;
    counts: Map<AreaKind, number>;
    showBaseLayer?: boolean;
    hasShade?: boolean;
    canAdd?: boolean;
  } = $props();

  const present = $derived(AREA_KINDS.filter((k) => (counts.get(k) ?? 0) > 0));
</script>

<Modal {open} {onClose} title="Filter map">
  <div class="filter" data-testid="map-filter">
    <fieldset>
      <legend>Areas</legend>
      {#if present.length === 0}
        <p class="muted">
          Nothing on the map yet.{#if canAdd}
            Close this and tap <strong>+ Add</strong> to draw your first area.{/if}
        </p>
      {/if}
      {#each present as k (k)}
        <label class="toggle">
          <input
            type="checkbox"
            checked={!filter.hidden.includes(k)}
            onchange={() => onChange(toggleKind(filter, k))}
          />
          <span class="swatch" style:--swatch={AREA_KIND_STYLE[k].color} aria-hidden="true"></span>
          <span class="name">{AREA_KIND_LABELS[k]}</span>
          <span class="n">{counts.get(k)}</span>
        </label>
      {/each}
    </fieldset>
    <fieldset>
      <legend>Show</legend>
      {#if hasShade}
        <label class="toggle">
          <input
            type="checkbox"
            checked={filter.shade}
            onchange={(e) => onChange({ ...filter, shade: e.currentTarget.checked })}
          />
          <span class="name">Shade & structures</span>
        </label>
      {/if}
      <label class="toggle">
        <input
          type="checkbox"
          checked={filter.labels}
          onchange={(e) => onChange({ ...filter, labels: e.currentTarget.checked })}
        />
        <span class="name">Labels</span>
      </label>
      {#if showBaseLayer}
        <label class="toggle">
          <input
            type="checkbox"
            checked={filter.satellite}
            onchange={(e) => onChange({ ...filter, satellite: e.currentTarget.checked })}
          />
          <span class="name">Satellite</span>
        </label>
      {/if}
    </fieldset>
    <p class="muted">Saved on this device for this farm.</p>
  </div>
</Modal>

<style>
  .filter {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
  }
  legend {
    margin-bottom: 6px;
    font-size: var(--font-size-kicker, 11px);
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-ink-muted);
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    border-bottom: 1px solid var(--color-divider-soft);
    cursor: pointer;
  }
  .toggle input {
    width: 22px;
    height: 22px;
    accent-color: var(--color-forest);
  }
  .swatch {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--swatch) 35%, transparent);
    border: 2px solid var(--swatch);
  }
  .name {
    flex: 1;
    font-weight: 600;
    color: var(--color-ink);
  }
  .n {
    color: var(--color-ink-muted);
    font-size: 13px;
  }
  .muted {
    margin: 0;
    color: var(--color-ink-muted);
    font-size: 13px;
  }
</style>
