<script lang="ts">
  import MapFeatureFields from '$lib/components/farm/MapFeatureFields.svelte';
  import { fmt } from '$lib/prefsState.svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import { featureLabel, featurePlural } from './farmLabels';
  import {
    MAP_FEATURE_KINDS,
    MAP_FEATURE_STYLE,
    describeFeature,
    geometryTypeFor,
    servedAreaIds,
    type MapFeatureView
  } from '$lib/farm/mapFeatures';
  import {
    bodyFromDraft,
    draftFromFeature,
    type FeatureBody,
    type FeatureFormDraft
  } from '$lib/farm/mapFeatureForm';

  const tr = $derived(createT(page.data?.locale));
  type Body = FeatureBody;

  const {
    features,
    areas,
    canEdit,
    onSave,
    onDelete
  }: {
    features: MapFeatureView[];
    areas: ReadonlyArray<{ id: string; name: string }>;
    canEdit: boolean;
    onSave: (id: string, body: Body) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
  } = $props();

  const groups = $derived(
    MAP_FEATURE_KINDS.map((kind) => ({
      kind,
      items: features.filter((f) => f.kind === kind)
    })).filter((g) => g.items.length > 0)
  );
  const areaName = $derived(new Map(areas.map((a) => [a.id, a.name] as const)));
  const servedNames = (f: MapFeatureView) =>
    servedAreaIds(f)
      .map((id) => areaName.get(id))
      .filter((n): n is string => !!n);

  let editingId = $state<string | null>(null);
  let draft = $state<FeatureFormDraft>(draftFromFeature());
  let busy = $state(false);
  let error = $state<string | null>(null);

  function startEdit(f: MapFeatureView) {
    editingId = f.id;
    draft = draftFromFeature(f);
    error = null;
  }

  async function save(f: MapFeatureView) {
    const checked = bodyFromDraft(f.kind, draft, page.data?.locale);
    if (!checked.ok) {
      error = checked.message;
      return;
    }
    busy = true;
    error = null;
    try {
      await onSave(f.id, checked.body);
      editingId = null;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function remove(f: MapFeatureView) {
    if (!confirm(tr('farm.list.confirmRemove', { name: f.name }))) return;
    try {
      await onDelete(f.id);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  const lengthText = (ft: number) => fmt.qty(ft, 'distance', { digits: 0 });
</script>

<section class="card features" aria-labelledby="map-features-title" data-testid="map-feature-list">
  <h2 id="map-features-title">{tr('farm.group.features')}</h2>
  {#if groups.length === 0}
    <p class="muted">
      {tr('farm.list.empty')}{#if canEdit}
        {tr('farm.list.emptyTap')} <strong>{tr('farm.addPlus')}</strong>
        {tr('farm.list.emptyPick')}{/if}
    </p>
  {/if}
  {#each groups as g (g.kind)}
    <h3>
      <span
        class="swatch"
        class:line={geometryTypeFor(g.kind) === 'LineString'}
        style:--swatch={MAP_FEATURE_STYLE[g.kind].color}
        aria-hidden="true">{MAP_FEATURE_STYLE[g.kind].symbol ?? ''}</span
      >
      {featurePlural(tr, g.kind)}
    </h3>
    <ul>
      {#each g.items as f (f.id)}
        <li data-feature-row={f.id} data-feature-kind={f.kind}>
          <div class="row">
            <span class="text">
              <span class="name">{describeFeature(f, lengthText, page.data?.locale)}</span>
              {#if servedNames(f).length}
                <span class="where"
                  >{f.kind === 'hydrant' ? tr('farm.list.serves') + ' ' : ''}{servedNames(f).join(
                    ', '
                  )}</span
                >
              {/if}
              {#if !f.geometry}<span class="where">{tr('farm.list.notOnMap')}</span>{/if}
            </span>
            {#if canEdit && editingId !== f.id}
              <button
                type="button"
                class="act"
                onclick={() => startEdit(f)}
                aria-label={tr('farm.list.editName', { name: f.name })}>{tr('farm.edit')}</button
              >
              <button
                type="button"
                class="act danger"
                onclick={() => remove(f)}
                aria-label={tr('farm.list.removeName', { name: f.name })}
                >{tr('farm.list.remove')}</button
              >
            {/if}
          </div>
          {#if editingId === f.id}
            <form
              class="edit"
              novalidate
              aria-label={tr('farm.list.editName', {
                name: featureLabel(tr, f.kind).toLowerCase()
              })}
              onsubmit={(e) => {
                e.preventDefault();
                void save(f);
              }}
            >
              <MapFeatureFields kind={f.kind} bind:draft {areas} idPrefix="feature-edit-{f.id}" />
              {#if error}<p class="error" role="alert">{error}</p>{/if}
              <div class="actions">
                <button type="submit" class="primary" disabled={busy || !draft.name.trim()}
                  >{busy ? tr('farm.sheet.saving') : tr('farm.save')}</button
                >
                <button type="button" onclick={() => (editingId = null)}>{tr('farm.cancel')}</button
                >
              </div>
            </form>
          {/if}
        </li>
      {/each}
    </ul>
  {/each}
  {#if error && !editingId}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
  .card {
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 14px;
  }
  .features h2 {
    margin: 0 0 6px;
    font-size: 1.05rem;
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 12px 0 4px;
    font-size: var(--font-size-kicker, 11px);
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-ink-muted);
  }
  .swatch {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--swatch);
    color: #fff;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0;
  }
  .swatch.line {
    width: 22px;
    height: 5px;
    border-radius: 3px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    border-bottom: 1px solid var(--color-divider-soft, var(--color-divider));
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 52px;
    flex-wrap: wrap;
  }
  .text {
    flex: 1 1 180px;
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: 6px 0;
  }
  .name {
    font-weight: 600;
    color: var(--color-ink);
    overflow-wrap: anywhere;
  }
  .where {
    font-size: 12.5px;
    color: var(--color-ink-muted);
  }
  .act,
  .actions button {
    min-height: 48px;
    min-width: 48px;
    padding: 0 14px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 8px);
    background: var(--color-paper);
    color: var(--color-forest-deep);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .act.danger {
    color: var(--color-rust, #a64a2a);
  }
  .edit {
    padding: 8px 0 12px;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 10px;
    flex-wrap: wrap;
  }
  .actions .primary {
    background: var(--color-forest-deep);
    color: var(--color-paper);
    border: 0;
  }
  .muted {
    margin: 0;
    color: var(--color-ink-muted);
    font-size: 13.5px;
  }
  .error {
    margin: 8px 0 0;
    color: var(--color-rust, #a64a2a);
    font-size: 13.5px;
  }
</style>
