<script lang="ts">
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import { featurePlaceholder, waterSourceLabel } from './farmLabels';
  import {
    servesManyAreas,
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

  const tr = $derived(createT(page.data?.locale));
</script>

<div class="feature-fields" data-testid="map-feature-fields">
  <label class="field" for="{idPrefix}-name">
    <span>{tr('farm.sheet.name')}</span>
    <input
      id="{idPrefix}-name"
      type="text"
      maxlength="120"
      placeholder={featurePlaceholder(tr, kind)}
      value={draft.name}
      oninput={(e) => (draft = { ...draft, name: e.currentTarget.value })}
    />
  </label>
  {#if areas.length && servesManyAreas(kind)}
    <fieldset class="serves" data-testid="feature-serves">
      <legend>{tr('farm.feature.servesTitle')}</legend>
      <p class="hint">{tr('farm.feature.servesHint')}</p>
      <ul>
        {#each areas as a (a.id)}
          <li>
            <label class="check">
              <input
                type="checkbox"
                checked={draft.areaIds.includes(a.id)}
                onchange={(e) =>
                  (draft = {
                    ...draft,
                    areaIds: e.currentTarget.checked
                      ? [...draft.areaIds.filter((id) => id !== a.id), a.id]
                      : draft.areaIds.filter((id) => id !== a.id)
                  })}
              />
              <span>{a.name}</span>
            </label>
          </li>
        {/each}
      </ul>
    </fieldset>
  {:else if areas.length}
    <label class="field" for="{idPrefix}-area">
      <span>{tr('farm.feature.belongs')}</span>
      <select
        id="{idPrefix}-area"
        value={draft.fieldId}
        onchange={(e) => (draft = { ...draft, fieldId: e.currentTarget.value })}
      >
        <option value="">{tr('farm.feature.wholeFarm')}</option>
        {#each areas as a (a.id)}
          <option value={a.id}>{a.name}</option>
        {/each}
      </select>
    </label>
  {/if}
  {#if kind === 'water_source'}
    <label class="field" for="{idPrefix}-source">
      <span>{tr('farm.feature.waterFrom')}</span>
      <select
        id="{idPrefix}-source"
        value={draft.source}
        onchange={(e) =>
          (draft = { ...draft, source: e.currentTarget.value as '' | WaterSourceType })}
      >
        <option value="">{tr('farm.feature.notSure')}</option>
        {#each WATER_SOURCE_TYPES as t (t)}
          <option value={t}>{waterSourceLabel(tr, t)}</option>
        {/each}
      </select>
    </label>
    <label class="field" for="{idPrefix}-flow">
      <span>{tr('farm.feature.flow')}</span>
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
  .serves {
    grid-column: 1 / -1;
    margin: 0;
    padding: 8px 10px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    min-width: 0;
  }
  .serves legend {
    font-size: 13px;
    color: var(--color-ink-soft);
    padding: 0 4px;
  }
  .serves .hint {
    margin: 0 0 4px;
    font-size: 13px;
    color: var(--color-ink-muted);
  }
  .serves ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 0 12px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    font-size: 15px;
    color: var(--color-ink);
    cursor: pointer;
    overflow-wrap: anywhere;
  }
  .check input {
    width: 22px;
    height: 22px;
    flex: none;
    accent-color: var(--color-forest);
  }
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
