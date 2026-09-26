<script lang="ts">
  import {
    MAP_FEATURE_NAME_PLACEHOLDER,
    WATER_SOURCE_LABELS,
    WATER_SOURCE_TYPES,
    type MapFeatureKind,
    type WaterSourceType
  } from '$lib/farm/mapFeatures';
  import type { FeatureFormDraft } from '$lib/farm/mapFeatureForm';

  let {
    kind,
    draft = $bindable(),
    areas = [],
    idPrefix = 'feature'
  }: {
    kind: MapFeatureKind;
    draft: FeatureFormDraft;
    areas?: ReadonlyArray<{ id: string; name: string }>;
    idPrefix?: string;
  } = $props();
</script>

<div class="feature-fields" data-testid="map-feature-fields">
  <label class="field" for="{idPrefix}-name">
    <span>Name</span>
    <input
      id="{idPrefix}-name"
      type="text"
      maxlength="120"
      placeholder={MAP_FEATURE_NAME_PLACEHOLDER[kind]}
      value={draft.name}
      oninput={(e) => (draft = { ...draft, name: e.currentTarget.value })}
    />
  </label>
  {#if areas.length}
    <label class="field" for="{idPrefix}-area">
      <span>Belongs to (optional)</span>
      <select
        id="{idPrefix}-area"
        value={draft.fieldId}
        onchange={(e) => (draft = { ...draft, fieldId: e.currentTarget.value })}
      >
        <option value="">The whole farm</option>
        {#each areas as a (a.id)}
          <option value={a.id}>{a.name}</option>
        {/each}
      </select>
    </label>
  {/if}
  {#if kind === 'water_source'}
    <label class="field" for="{idPrefix}-source">
      <span>Where the water comes from</span>
      <select
        id="{idPrefix}-source"
        value={draft.source}
        onchange={(e) =>
          (draft = { ...draft, source: e.currentTarget.value as '' | WaterSourceType })}
      >
        <option value="">Not sure yet</option>
        {#each WATER_SOURCE_TYPES as t (t)}
          <option value={t}>{WATER_SOURCE_LABELS[t]}</option>
        {/each}
      </select>
    </label>
    <label class="field" for="{idPrefix}-flow">
      <span>Flow rate, gallons per minute (optional)</span>
      <input
        id="{idPrefix}-flow"
        type="number"
        min="0.1"
        max="5000"
        step="0.1"
        inputmode="decimal"
        value={draft.flowRate}
        oninput={(e) => (draft = { ...draft, flowRate: e.currentTarget.value })}
      />
    </label>
  {/if}
</div>

<style>
  .feature-fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: var(--space-2, 8px) var(--space-3, 12px);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--color-ink-soft);
  }
  .field select,
  .field input {
    min-height: 48px;
    padding: 0 10px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    background: var(--color-paper);
    color: var(--color-ink);
    font: inherit;
    font-size: 15px;
    width: 100%;
    box-sizing: border-box;
  }
</style>
