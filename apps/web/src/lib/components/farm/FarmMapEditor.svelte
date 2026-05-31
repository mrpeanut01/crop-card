<script lang="ts">
  /**
   * Standalone Fields & Blocks editing suite (Settings → Farm map).
   *
   * Extracted from the legacy /plan?tab=layout editor so geometry editing
   * lives in one place. Self-contained: data comes in as props, every mutation
   * goes through the owner-gated /api/* endpoints and ends in invalidateAll().
   * No $lib/db/* imports (server-only invariant); BlockMap is browser-guarded.
   */
  import { invalidateAll } from '$app/navigation';
  import { browser } from '$app/environment';
  import { untrack } from 'svelte';
  import BlockMap from '$lib/components/BlockMap.svelte';
  import type { BlockWithPlantings } from '$lib/db/blocks';
  import type { FieldWithBlocks } from '$lib/db/fields';
  import type { ShadeSource, ShadeSourceKind } from '$lib/db/shadeSources';
  import type { TillageMethod } from '$lib/schedule/constants';

  type Geom = { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
  type ShadeKind = ShadeSourceKind;

  let {
    blocks,
    fields,
    shadeSources = [],
    canEdit,
    isFirstRun = false
  }: {
    blocks: BlockWithPlantings[];
    fields: FieldWithBlocks[];
    shadeSources?: ShadeSource[];
    canEdit: boolean;
    isFirstRun?: boolean;
  } = $props();

  // ─── BlockMap draw callbacks ──────────────────────────────────────────────
  let blockMap = $state<{
    currentDraftName: () => string;
    currentDraftFieldId: () => string;
  } | null>(null);

  async function saveGeometry(blockId: string, geom: Geom | null) {
    if (geom === null) {
      const res = await fetch(`/api/blocks/${encodeURIComponent(blockId)}/geometry`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await invalidateAll();
      return;
    }
    const res = await fetch(`/api/blocks/${encodeURIComponent(blockId)}/geometry`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(geom)
    });
    if (!res.ok) {
      const out = await res.json().catch(() => ({}));
      throw new Error(out.error ?? `HTTP ${res.status}`);
    }
    await invalidateAll();
  }

  async function createBlockWithGeometry(geom: Geom, suggestedAcres: number | null) {
    const name = blockMap?.currentDraftName().trim() ?? '';
    if (!name) throw new Error('block name required');
    const fieldId = blockMap?.currentDraftFieldId() || undefined;
    const res = await fetch('/api/blocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        acres: suggestedAcres !== null ? Number(suggestedAcres.toFixed(2)) : undefined,
        fieldId,
        geometryGeojson: geom
      })
    });
    if (!res.ok) {
      const out = await res.json().catch(() => ({}));
      throw new Error(out.error ?? `HTTP ${res.status}`);
    }
    await invalidateAll();
  }

  async function saveFieldGeometry(fieldId: string, geom: Geom | null) {
    if (geom === null) {
      const res = await fetch(`/api/fields/${encodeURIComponent(fieldId)}/geometry`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await invalidateAll();
      return;
    }
    const res = await fetch(`/api/fields/${encodeURIComponent(fieldId)}/geometry`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(geom)
    });
    if (!res.ok) {
      const out = await res.json().catch(() => ({}));
      throw new Error(out.error ?? `HTTP ${res.status}`);
    }
    await invalidateAll();
  }

  async function createFieldWithGeometry(name: string, geom: Geom, suggestedAcres: number | null) {
    if (!name.trim()) throw new Error('field name required');
    const res = await fetch('/api/fields', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        acres: suggestedAcres !== null ? Number(suggestedAcres.toFixed(2)) : undefined,
        geometryGeojson: geom
      })
    });
    if (!res.ok) {
      const out = await res.json().catch(() => ({}));
      throw new Error(out.error ?? `HTTP ${res.status}`);
    }
    await invalidateAll();
  }

  async function createShadeSource(input: {
    name: string;
    kind: ShadeKind;
    geometryGeojson: string;
    heightFt: number;
    opacity: number;
    isDeciduous: boolean;
    leafOnDayOfYear: number;
    leafOffDayOfYear: number;
  }) {
    const res = await fetch('/api/shade-sources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input)
    });
    if (!res.ok) {
      const out = await res.json().catch(() => ({}));
      throw new Error(out.error ?? `HTTP ${res.status}`);
    }
    await invalidateAll();
  }

  async function deleteShadeSource(id: string, name: string) {
    if (!confirm(`Delete shade source "${name}"?`)) return;
    const res = await fetch(`/api/shade-sources/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) {
      const out = await res.json().catch(() => ({}));
      alert(out.error ?? `HTTP ${res.status}`);
      return;
    }
    await invalidateAll();
  }

  async function updateShadeGeometry(id: string, geometryGeojson: string) {
    const res = await fetch(`/api/shade-sources/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ geometryGeojson })
    });
    if (!res.ok) {
      const out = await res.json().catch(() => ({}));
      throw new Error(out.error ?? `HTTP ${res.status}`);
    }
    await invalidateAll();
  }

  // ─── Field create / edit / delete ─────────────────────────────────────────
  let newFieldName = $state('');
  let newFieldAcres = $state<number | undefined>(undefined);
  let newFieldNotes = $state('');
  let creatingField = $state(false);
  let fieldError = $state<string | null>(null);

  async function createField() {
    if (!newFieldName.trim()) return;
    creatingField = true;
    fieldError = null;
    try {
      const res = await fetch('/api/fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newFieldName.trim(),
          acres: newFieldAcres,
          notes: newFieldNotes.trim() || undefined
        })
      });
      const out = await res.json();
      if (!res.ok) {
        fieldError = out.error ?? `HTTP ${res.status}`;
        return;
      }
      newFieldName = '';
      newFieldAcres = undefined;
      newFieldNotes = '';
      await invalidateAll();
    } catch (e) {
      fieldError = e instanceof Error ? e.message : String(e);
    } finally {
      creatingField = false;
    }
  }

  let editingFieldId = $state<string | null>(null);
  let editFieldName = $state('');
  let editFieldAcres = $state<number | undefined>(undefined);
  let editFieldNotes = $state('');

  function startEditField(f: { id: string; name: string; acres?: number; notes?: string }) {
    editingFieldId = f.id;
    editFieldName = f.name;
    editFieldAcres = f.acres;
    editFieldNotes = f.notes ?? '';
  }

  async function saveEditField() {
    if (!editingFieldId) return;
    const res = await fetch(`/api/fields/${encodeURIComponent(editingFieldId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editFieldName.trim(),
        acres: editFieldAcres ?? null,
        notes: editFieldNotes.trim() || null
      })
    });
    if (!res.ok) {
      const out = await res.json().catch(() => ({}));
      alert(`Save failed: ${out.error ?? res.status}`);
      return;
    }
    editingFieldId = null;
    await invalidateAll();
  }

  async function deleteField(id: string, name: string, blockCount: number) {
    const ok = confirm(
      blockCount > 0
        ? `Delete field "${name}"? This removes all ${blockCount} block(s) and every crop + event recorded against them. Cannot be undone.`
        : `Delete field "${name}"?`
    );
    if (!ok) return;
    const res = await fetch(`/api/fields/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) {
      const out = await res.json().catch(() => ({}));
      alert(`Delete failed: ${out.error ?? res.status}`);
      return;
    }
    await invalidateAll();
  }

  // ─── Block create / edit / delete ─────────────────────────────────────────
  let newBlockName = $state('');
  let newBlockAcres = $state<number | undefined>(undefined);
  let newBlockFieldId = $state<string>('');
  let creatingBlock = $state(false);
  let blockError = $state<string | null>(null);
  let addingBlockForFieldId = $state<string | null>(null);

  async function createBlock(targetFieldId?: string) {
    if (!newBlockName.trim()) return;
    creatingBlock = true;
    blockError = null;
    try {
      const fieldId = targetFieldId ?? (newBlockFieldId || undefined);
      const res = await fetch('/api/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newBlockName.trim(), acres: newBlockAcres, fieldId })
      });
      const out = await res.json();
      if (!res.ok) {
        blockError = out.error ?? `HTTP ${res.status}`;
        return;
      }
      newBlockName = '';
      newBlockAcres = undefined;
      newBlockFieldId = '';
      addingBlockForFieldId = null;
      await invalidateAll();
    } catch (e) {
      blockError = e instanceof Error ? e.message : String(e);
    } finally {
      creatingBlock = false;
    }
  }

  let editingBlockId = $state<string | null>(null);
  let editBlockName = $state('');
  let editBlockAcres = $state<number | undefined>(undefined);
  let editBlockLabel = $state('');
  let editBlockFieldId = $state<string>('');
  let editBlockTillage = $state<TillageMethod>('conventional');
  let editBlockSlopePercent = $state<number | null>(null);
  let editBlockSlopeAspectDeg = $state<number | null>(null);

  function startEditBlock(b: {
    id: string;
    name: string;
    acres?: number;
    blockLabel?: string;
    fieldId?: string;
    tillageMethod?: TillageMethod;
    slopePercent?: number;
    slopeAspectDeg?: number;
  }) {
    editingBlockId = b.id;
    editBlockName = b.name;
    editBlockAcres = b.acres;
    editBlockLabel = b.blockLabel ?? '';
    editBlockFieldId = b.fieldId ?? '';
    editBlockTillage = b.tillageMethod ?? 'conventional';
    editBlockSlopePercent = b.slopePercent ?? null;
    editBlockSlopeAspectDeg = b.slopeAspectDeg ?? null;
  }

  async function saveEditBlock() {
    if (!editingBlockId) return;
    const res = await fetch(`/api/blocks/${encodeURIComponent(editingBlockId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editBlockName.trim(),
        acres: editBlockAcres ?? null,
        blockLabel: editBlockLabel.trim() || null,
        fieldId: editBlockFieldId || undefined,
        tillageMethod: editBlockTillage,
        slopePercent: editBlockSlopePercent,
        slopeAspectDeg: editBlockSlopeAspectDeg
      })
    });
    if (!res.ok) {
      const out = await res.json().catch(() => ({}));
      alert(`Save failed: ${out.error ?? res.status}`);
      return;
    }
    editingBlockId = null;
    await invalidateAll();
  }

  async function deleteBlock(id: string, name: string, plantingsCount: number) {
    const ok = confirm(
      plantingsCount > 0
        ? `Delete block "${name}"? This removes all ${plantingsCount} crop(s) plus every event recorded against them. Cannot be undone.`
        : `Delete block "${name}"?`
    );
    if (!ok) return;
    const res = await fetch(`/api/blocks/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) {
      const out = await res.json().catch(() => ({}));
      alert(`Delete failed: ${out.error ?? res.status}`);
      return;
    }
    await invalidateAll();
  }

  // ─── Shade-source inline edit ─────────────────────────────────────────────
  let editingShadeId = $state<string | null>(null);
  let editShadeName = $state('');
  let editShadeKind = $state<ShadeKind>('tree-row');
  let editShadeFieldId = $state<string>('');
  let editShadeHeightFt = $state<number | undefined>(undefined);
  let editShadeOpacity = $state<number | undefined>(undefined);
  let editShadeIsDeciduous = $state<boolean>(true);
  let editShadeLeafOnDoy = $state<number | undefined>(undefined);
  let editShadeLeafOffDoy = $state<number | undefined>(undefined);

  function startEditShade(s: {
    id: string;
    name: string;
    kind: ShadeKind;
    fieldId?: string;
    heightFt: number;
    opacity: number;
    isDeciduous: boolean;
    leafOnDayOfYear: number;
    leafOffDayOfYear: number;
  }) {
    editingShadeId = s.id;
    editShadeName = s.name;
    editShadeKind = s.kind;
    editShadeFieldId = s.fieldId ?? '';
    editShadeHeightFt = s.heightFt;
    editShadeOpacity = s.opacity;
    editShadeIsDeciduous = s.isDeciduous;
    editShadeLeafOnDoy = s.leafOnDayOfYear;
    editShadeLeafOffDoy = s.leafOffDayOfYear;
  }

  async function saveEditShade() {
    if (!editingShadeId) return;
    const body: Record<string, unknown> = {
      name: editShadeName.trim(),
      kind: editShadeKind,
      heightFt: Number(editShadeHeightFt),
      opacity: Number(editShadeOpacity),
      isDeciduous: editShadeIsDeciduous,
      leafOnDayOfYear: Number(editShadeLeafOnDoy) || 105,
      leafOffDayOfYear: Number(editShadeLeafOffDoy) || 305
    };
    body.fieldId = editShadeFieldId || null;
    const res = await fetch(`/api/shade-sources/${encodeURIComponent(editingShadeId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const out = await res.json().catch(() => ({}));
      alert(`Save failed: ${out.error ?? res.status}`);
      return;
    }
    editingShadeId = null;
    await invalidateAll();
  }

  function shadeKindEmoji(kind: string): string {
    switch (kind) {
      case 'tree-row':
        return '🌳';
      case 'tree-grove':
        return '🌲';
      case 'tree-single':
        return '🌳';
      case 'hedge':
        return '🌿';
      case 'building':
        return '🏠';
      case 'fence':
        return '🧱';
      case 'structure':
        return '🏗️';
      default:
        return '🌑';
    }
  }

  // ─── "Add without drawing" panel ──────────────────────────────────────────
  type AddKind = 'field' | 'block' | ShadeKind;
  let addKind = $state<AddKind>('field');
  let addShadeName = $state('');
  let addShadeHeightFt = $state<number>(30);
  let addShadeOpacity = $state<number>(0.7);
  let addShadeIsDeciduous = $state<boolean>(true);
  let addShadeLeafOnDoy = $state<number>(105);
  let addShadeLeafOffDoy = $state<number>(305);
  let addShadeFieldId = $state<string>('');
  let addingShade = $state<boolean>(false);
  let addShadeError = $state<string | null>(null);

  function isShadeKind(k: AddKind): k is ShadeKind {
    return k !== 'field' && k !== 'block';
  }

  async function addShadeWithoutGeometry() {
    if (!isShadeKind(addKind)) return;
    if (!addShadeName.trim()) {
      addShadeError = 'Name is required.';
      return;
    }
    addingShade = true;
    addShadeError = null;
    try {
      const body = {
        name: addShadeName.trim(),
        kind: addKind,
        heightFt: addShadeHeightFt,
        opacity: addShadeOpacity,
        isDeciduous: addShadeIsDeciduous,
        leafOnDayOfYear: addShadeLeafOnDoy,
        leafOffDayOfYear: addShadeLeafOffDoy,
        fieldId: addShadeFieldId || undefined
      };
      const res = await fetch('/api/shade-sources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const out = await res.json().catch(() => ({}));
        addShadeError = out.error ?? `HTTP ${res.status}`;
        return;
      }
      addShadeName = '';
      await invalidateAll();
    } catch (e) {
      addShadeError = e instanceof Error ? e.message : String(e);
    } finally {
      addingShade = false;
    }
  }

  // ─── Advanced GeoJSON paste (power users / QGIS imports) ──────────────────
  let pasteBlockId = $state(untrack(() => blocks[0]?.id ?? ''));
  let pasteText = $state('');
  let pasteMode = $state<'block' | 'collection'>('block');
  let geomBusy = $state(false);
  let geomError = $state<string | null>(null);
  let geomMessage = $state<string | null>(null);
  let pasteResults = $state<Array<{ name: string; kind: string; status: string }>>([]);

  async function savePaste(e: Event) {
    e.preventDefault();
    geomBusy = true;
    geomError = null;
    geomMessage = null;
    pasteResults = [];
    try {
      const parsed = JSON.parse(pasteText);
      if (pasteMode === 'block') {
        const res = await fetch(`/api/blocks/${encodeURIComponent(pasteBlockId)}/geometry`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(parsed)
        });
        const out = await res.json();
        if (!res.ok) {
          geomError = out.error ?? 'failed';
          return;
        }
        geomMessage = 'Geometry saved.';
        pasteText = '';
        await invalidateAll();
        return;
      }
      if (parsed.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) {
        geomError = 'Expected a FeatureCollection with a features array.';
        return;
      }
      const results: typeof pasteResults = [];
      for (const feat of parsed.features as Array<{
        type: string;
        geometry: unknown;
        properties: Record<string, string> | null;
      }>) {
        const props = feat.properties ?? {};
        const kind = props['type'];
        const name = props['name'];
        if (!name) {
          results.push({ name: '(unnamed)', kind: kind ?? '?', status: 'skipped — no name' });
          continue;
        }
        const geom = feat.geometry ?? feat;
        if (kind === 'field') {
          const field = fields.find((f) => f.name === name);
          if (!field) {
            results.push({ name, kind: 'field', status: 'not found' });
            continue;
          }
          const res = await fetch(`/api/fields/${encodeURIComponent(field.id)}/geometry`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(geom)
          });
          results.push({ name, kind: 'field', status: res.ok ? 'saved ✓' : `error ${res.status}` });
        } else if (kind === 'block') {
          const fieldName = props['field'];
          const block =
            blocks.find(
              (b) =>
                b.name === name &&
                (!fieldName || fields.find((f) => f.id === b.fieldId)?.name === fieldName)
            ) ?? blocks.find((b) => b.name === name);
          if (!block) {
            results.push({ name, kind: 'block', status: 'not found' });
            continue;
          }
          const res = await fetch(`/api/blocks/${encodeURIComponent(block.id)}/geometry`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(geom)
          });
          results.push({ name, kind: 'block', status: res.ok ? 'saved ✓' : `error ${res.status}` });
        } else {
          results.push({ name, kind: kind ?? '?', status: 'skipped — unknown type' });
        }
      }
      pasteResults = results;
      pasteText = '';
      await invalidateAll();
    } catch (e2) {
      geomError = e2 instanceof Error ? e2.message : String(e2);
    } finally {
      geomBusy = false;
    }
  }
</script>

{#if isFirstRun && canEdit}
  <section class="card welcome">
    <h2>👋 Draw your farm</h2>
    <p>
      Use the toolbar on the map to <strong>draw a field</strong>, then draw the
      <strong>blocks</strong> inside it. No GPS? Use <strong>Add without drawing</strong> below to create
      them by name and sketch boundaries later.
    </p>
  </section>
{/if}

{#if browser}
  <BlockMap
    bind:this={blockMap}
    {blocks}
    {fields}
    {canEdit}
    {shadeSources}
    onSaveGeometry={saveGeometry}
    onCreateWithGeometry={createBlockWithGeometry}
    onSaveFieldGeometry={saveFieldGeometry}
    onCreateFieldWithGeometry={createFieldWithGeometry}
    onCreateShadeSource={createShadeSource}
    onDeleteShadeSource={deleteShadeSource}
    onUpdateShadeGeometry={updateShadeGeometry}
  />
{:else}
  <section class="card empty"><p>Loading map…</p></section>
{/if}

<section class="card">
  {#if fields.length === 0}
    <p class="empty-row">No fields yet. Use ➕ Draw field on the map above, or add one below.</p>
  {:else}
    {#each fields as f (f.id)}
      {@const fieldBlocks = blocks.filter((b) => b.fieldId === f.id)}
      {@const fieldAcresDisplay = f.acres ?? (f.blockAcresTotal > 0 ? f.blockAcresTotal : null)}
      <div class="field-group">
        <div class="field-row">
          <span class="field-icon">🌾</span>
          <strong class="field-name">{f.name}</strong>
          <span class="field-stats">
            {fieldBlocks.length} block{fieldBlocks.length === 1 ? '' : 's'}
            {#if fieldAcresDisplay !== null}· {fieldAcresDisplay.toFixed(1)} ac{/if}
          </span>
          {#if canEdit}
            <button
              class="row-action"
              onclick={() => {
                addingBlockForFieldId = addingBlockForFieldId === f.id ? null : f.id;
                newBlockName = '';
                newBlockAcres = undefined;
                blockError = null;
              }}
              title="Add block"
              aria-label="Add block to {f.name}">＋</button
            >
            <button class="row-action" onclick={() => startEditField(f)} title="Edit field"
              >✏</button
            >
            <button
              class="row-action danger"
              onclick={() => deleteField(f.id, f.name, fieldBlocks.length)}
              aria-label="Delete {f.name}"
              title="Delete field">🗑</button
            >
          {/if}
        </div>

        {#if editingFieldId === f.id}
          <div class="inline-edit">
            <div class="grid2">
              <label>Name<input type="text" bind:value={editFieldName} /></label>
              <label
                >Acres<input type="number" min="0" step="0.1" bind:value={editFieldAcres} /></label
              >
              <label class="full">Notes<input type="text" bind:value={editFieldNotes} /></label>
            </div>
            <div class="row">
              <button class="primary" onclick={saveEditField}>Save</button>
              <button onclick={() => (editingFieldId = null)}>Cancel</button>
            </div>
          </div>
        {/if}

        {#if f.notes && editingFieldId !== f.id}<p class="field-notes">{f.notes}</p>{/if}

        {#if fieldBlocks.length === 0}
          <p class="empty-row-indent">No blocks yet — draw on the map above or add one below.</p>
        {:else}
          <ul class="block-list-flat">
            {#each fieldBlocks as b (b.id)}
              {@const acresDisplay = b.acres !== undefined ? `${b.acres.toFixed(1)} ac` : null}
              <li class="block-row">
                <span class="block-icon">▪</span>
                <span class="block-name">{b.name}</span>
                <span class="block-stats">
                  {#if acresDisplay}{acresDisplay}{/if}
                  {#if b.plantings.length > 0}
                    {acresDisplay ? ' · ' : ''}{b.plantings.length} planting{b.plantings.length ===
                    1
                      ? ''
                      : 's'}
                  {/if}
                  {#if !b.geometryGeojson}<span class="not-drawn">not drawn</span>{/if}
                </span>
                {#if canEdit}
                  <button class="row-action" onclick={() => startEditBlock(b)} title="Edit block"
                    >✏</button
                  >
                  <button
                    class="row-action danger"
                    onclick={() => deleteBlock(b.id, b.name, b.plantings.length)}
                    aria-label="Delete {b.name}"
                    title="Delete block">🗑</button
                  >
                {/if}
              </li>
              {#if editingBlockId === b.id}
                <li class="inline-edit-row">
                  <div class="inline-edit">
                    <div class="grid2">
                      <label>Name<input type="text" bind:value={editBlockName} /></label>
                      <label
                        >Acres<input
                          type="number"
                          min="0"
                          step="0.1"
                          bind:value={editBlockAcres}
                        /></label
                      >
                      <label
                        >Code<input
                          type="text"
                          placeholder="A"
                          bind:value={editBlockLabel}
                        /></label
                      >
                      {#if fields.length > 1}
                        <label class="full"
                          >Move to field
                          <select bind:value={editBlockFieldId}>
                            {#each fields as ff (ff.id)}<option value={ff.id}>{ff.name}</option
                              >{/each}
                          </select>
                        </label>
                      {/if}
                      <label class="full"
                        >Tillage method
                        <select bind:value={editBlockTillage}>
                          <option value="conventional">Conventional (plow/disk)</option>
                          <option value="reduced-till">Reduced-till (single pass)</option>
                          <option value="no-till">No-till (burndown only)</option>
                        </select>
                      </label>
                      <label
                        >Slope (%)
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.5"
                          placeholder="0"
                          bind:value={editBlockSlopePercent}
                        />
                      </label>
                      <label
                        >Slope aspect (° downhill)
                        <input
                          type="number"
                          min="0"
                          max="360"
                          step="1"
                          placeholder="0=N, 90=E, 180=S, 270=W"
                          bind:value={editBlockSlopeAspectDeg}
                        />
                      </label>
                    </div>
                    <p class="block-slope-hint">
                      Slope inputs are optional. Leave both blank for flat terrain. The shade model
                      uses these to lengthen / shorten projected shadows along the downhill axis.
                    </p>
                    <div class="row">
                      <button class="primary" onclick={saveEditBlock}>Save</button>
                      <button onclick={() => (editingBlockId = null)}>Cancel</button>
                    </div>
                  </div>
                </li>
              {/if}
            {/each}
          </ul>
        {/if}

        {#if canEdit && addingBlockForFieldId === f.id}
          <div class="add-block-inline">
            <input type="text" placeholder="Block name" bind:value={newBlockName} />
            <input
              type="number"
              placeholder="ac"
              min="0"
              step="0.1"
              bind:value={newBlockAcres}
              class="acres-input"
            />
            <button
              class="primary small"
              onclick={() => createBlock(f.id)}
              disabled={creatingBlock || !newBlockName.trim()}
            >
              {creatingBlock ? '…' : 'Add'}
            </button>
            <button
              class="small"
              onclick={() => {
                addingBlockForFieldId = null;
                newBlockName = '';
                newBlockAcres = undefined;
              }}>✕</button
            >
          </div>
          {#if blockError}<p class="error" style="padding-left:1.5rem">{blockError}</p>{/if}
        {/if}

        {#if shadeSources.some((s) => s.fieldId === f.id)}
          <ul class="block-list-flat">
            {#each shadeSources.filter((s) => s.fieldId === f.id) as s (s.id)}
              <li class="block-row shade-row">
                <span class="block-icon">{shadeKindEmoji(s.kind)}</span>
                <span class="block-name">{s.name}</span>
                <span class="block-stats">
                  {s.kind} · {s.heightFt} ft{#if s.isDeciduous}
                    · deciduous{/if}
                  {#if !s.geometryGeojson}<span class="not-drawn">not drawn</span>{/if}
                </span>
                {#if canEdit}
                  <button
                    class="row-action"
                    onclick={() => startEditShade(s)}
                    title="Edit shade source">✏</button
                  >
                  <button
                    class="row-action danger"
                    onclick={() => deleteShadeSource(s.id, s.name)}
                    aria-label="Delete {s.name}"
                    title="Delete shade source">🗑</button
                  >
                {/if}
              </li>
              {#if editingShadeId === s.id}
                <li class="inline-edit-row">
                  {@render shadeEditForm()}
                </li>
              {/if}
            {/each}
          </ul>
        {/if}
      </div>
    {/each}

    {#if shadeSources.some((s) => !s.fieldId || !fields.some((f) => f.id === s.fieldId))}
      <div class="field-group">
        <div class="field-row">
          <span class="field-icon">🌐</span>
          <strong class="field-name">Farm-wide shade sources</strong>
        </div>
        <ul class="block-list-flat">
          {#each shadeSources.filter((s) => !s.fieldId || !fields.some((f) => f.id === s.fieldId)) as s (s.id)}
            <li class="block-row shade-row">
              <span class="block-icon">{shadeKindEmoji(s.kind)}</span>
              <span class="block-name">{s.name}</span>
              <span class="block-stats">
                {s.kind} · {s.heightFt} ft{#if s.isDeciduous}
                  · deciduous{/if}
                {#if !s.geometryGeojson}<span class="not-drawn">not drawn</span>{/if}
              </span>
              {#if canEdit}
                <button
                  class="row-action"
                  onclick={() => startEditShade(s)}
                  title="Edit shade source">✏</button
                >
                <button
                  class="row-action danger"
                  onclick={() => deleteShadeSource(s.id, s.name)}
                  aria-label="Delete {s.name}"
                  title="Delete shade source">🗑</button
                >
              {/if}
            </li>
            {#if editingShadeId === s.id}
              <li class="inline-edit-row">
                {@render shadeEditForm()}
              </li>
            {/if}
          {/each}
        </ul>
      </div>
    {/if}
  {/if}
</section>

{#if canEdit}
  <details class="card advanced">
    <summary>Add without drawing</summary>
    <p class="lede">
      Add a field, block, tree row, grove, building, or other shade source by name only. Geometry is
      optional — draw it later on the map above by selecting the matching tool.
    </p>

    <label class="full">
      What are you adding?
      <select bind:value={addKind}>
        <option value="field">Field</option>
        <option value="block">Block</option>
        <option disabled>──────────────</option>
        <option value="tree-row">🌳 Tree row</option>
        <option value="tree-grove">🌲 Tree grove</option>
        <option value="tree-single">🌳 Single tree</option>
        <option value="hedge">🌿 Hedge</option>
        <option value="building">🏠 Building</option>
        <option value="fence">🧱 Fence</option>
        <option value="structure">🏗️ Structure</option>
        <option value="other">🌑 Other</option>
      </select>
    </label>

    {#if addKind === 'field'}
      <div class="add-form-section">
        <div class="grid2">
          <label
            >Name<input
              type="text"
              placeholder="e.g. North Field"
              bind:value={newFieldName}
            /></label
          >
          <label
            >Acres (optional)<input
              type="number"
              min="0"
              step="0.1"
              bind:value={newFieldAcres}
            /></label
          >
          <label class="full"
            >Notes (optional)<input
              type="text"
              placeholder="Lease info, address, etc."
              bind:value={newFieldNotes}
            /></label
          >
        </div>
        <button
          class="primary"
          onclick={createField}
          disabled={creatingField || !newFieldName.trim()}
        >
          {creatingField ? '…' : 'Add field'}
        </button>
        {#if fieldError}<p class="error">{fieldError}</p>{/if}
      </div>
    {:else if addKind === 'block'}
      {#if fields.length === 0}
        <p class="error">Add a field first — every block belongs to one.</p>
      {:else}
        <div class="add-form-section">
          <div class="grid2">
            <label
              >Name<input
                type="text"
                placeholder="e.g. Corn Block A"
                bind:value={newBlockName}
              /></label
            >
            <label
              >Acres (optional)<input
                type="number"
                min="0"
                step="0.1"
                bind:value={newBlockAcres}
              /></label
            >
            <label class="full"
              >Field
              <select bind:value={newBlockFieldId}>
                {#each fields as ff (ff.id)}<option value={ff.id}>{ff.name}</option>{/each}
              </select>
            </label>
          </div>
          <button
            class="primary"
            onclick={() => createBlock()}
            disabled={creatingBlock || !newBlockName.trim()}
          >
            {creatingBlock ? '…' : 'Add block'}
          </button>
          {#if blockError}<p class="error">{blockError}</p>{/if}
        </div>
      {/if}
    {:else}
      <div class="add-form-section">
        <div class="grid2">
          <label
            >Name<input
              type="text"
              placeholder="e.g. North maple windbreak"
              bind:value={addShadeName}
            /></label
          >
          <label
            >Height (ft)<input
              type="number"
              min="1"
              max="200"
              step="1"
              bind:value={addShadeHeightFt}
            /></label
          >
          <label
            >Opacity (0–1)<input
              type="number"
              min="0"
              max="1"
              step="0.05"
              bind:value={addShadeOpacity}
            /></label
          >
          <label class="full"
            >Field (optional — leave blank for farm-wide)
            <select bind:value={addShadeFieldId}>
              <option value="">— Farm-wide (no field) —</option>
              {#each fields as ff (ff.id)}<option value={ff.id}>{ff.name}</option>{/each}
            </select>
          </label>
        </div>
        <label class="checkbox-line">
          <input type="checkbox" bind:checked={addShadeIsDeciduous} />
          Deciduous (leaves drop in winter)
        </label>
        {#if addShadeIsDeciduous}
          <div class="grid2">
            <label
              >Leaf-on (day of year)<input
                type="number"
                min="1"
                max="366"
                bind:value={addShadeLeafOnDoy}
              /></label
            >
            <label
              >Leaf-off (day of year)<input
                type="number"
                min="1"
                max="366"
                bind:value={addShadeLeafOffDoy}
              /></label
            >
          </div>
        {/if}
        <button
          class="primary"
          onclick={addShadeWithoutGeometry}
          disabled={addingShade || !addShadeName.trim()}
        >
          {addingShade ? '…' : `Add ${addKind}`}
        </button>
        {#if addShadeError}<p class="error">{addShadeError}</p>{/if}
        <p class="muted" style="margin-top:0.4rem">
          Without geometry the shade source won't project shadows — draw it on the map after to wire
          up shading.
        </p>
      </div>
    {/if}

    <details class="nested-advanced">
      <summary>Advanced — paste GeoJSON</summary>
      <p class="lede">
        Power-user import path: paste GeoJSON exported from QGIS, ArcGIS, or a county GIS portal.
        Currently supports field + block features only.
      </p>

      <div class="paste-mode-tabs">
        <button
          class:active={pasteMode === 'block'}
          onclick={() => {
            pasteMode = 'block';
            pasteResults = [];
            geomError = null;
            geomMessage = null;
          }}
          type="button">Single block</button
        >
        <button
          class:active={pasteMode === 'collection'}
          onclick={() => {
            pasteMode = 'collection';
            geomError = null;
            geomMessage = null;
          }}
          type="button">Fields + Blocks (FeatureCollection)</button
        >
      </div>

      <form onsubmit={savePaste}>
        {#if pasteMode === 'block'}
          <label>
            Block
            <select bind:value={pasteBlockId}>
              {#each blocks as b (b.id)}
                <option value={b.id}>{b.name}{b.geometryGeojson ? ' (has geometry)' : ''}</option>
              {/each}
            </select>
          </label>
          <label>
            GeoJSON (Polygon, MultiPolygon, Feature, or FeatureCollection)
            <textarea
              bind:value={pasteText}
              rows="6"
              placeholder={'{"type":"Polygon","coordinates":[[[-77.6,39.1],[-77.6,39.11],[-77.59,39.11],[-77.59,39.1],[-77.6,39.1]]]}'}
            ></textarea>
          </label>
        {:else}
          <p class="lede">
            Paste a GeoJSON <code>FeatureCollection</code> where each Feature has
            <code>properties.type</code> of <code>"field"</code> or <code>"block"</code>, and
            <code>properties.name</code> matching an existing field or block name.
          </p>
          <label>
            FeatureCollection JSON
            <textarea
              bind:value={pasteText}
              rows="10"
              placeholder={'{"type":"FeatureCollection","features":[...]}'}
            ></textarea>
          </label>
        {/if}

        <button type="submit" class="primary" disabled={geomBusy || !pasteText.trim()}>
          {geomBusy ? 'Saving…' : pasteMode === 'collection' ? 'Import all' : 'Save geometry'}
        </button>
      </form>

      {#if geomMessage}<p class="success">{geomMessage}</p>{/if}
      {#if geomError}<p class="error">{geomError}</p>{/if}
      {#if pasteResults.length > 0}
        <table class="paste-results">
          <thead><tr><th>Name</th><th>Type</th><th>Result</th></tr></thead>
          <tbody>
            {#each pasteResults as r}
              <tr class={r.status.startsWith('saved') ? 'result-ok' : 'result-warn'}>
                <td>{r.name}</td>
                <td>{r.kind}</td>
                <td>{r.status}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </details>
  </details>
{/if}

{#snippet shadeEditForm()}
  <div class="inline-edit">
    <div class="grid2">
      <label>Name<input type="text" bind:value={editShadeName} /></label>
      <label
        >Kind
        <select bind:value={editShadeKind}>
          <option value="tree-row">Tree row</option>
          <option value="tree-grove">Tree grove</option>
          <option value="tree-single">Single tree</option>
          <option value="hedge">Hedge</option>
          <option value="building">Building</option>
          <option value="fence">Fence</option>
          <option value="structure">Structure</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label
        >Height (ft)<input
          type="number"
          min="1"
          max="200"
          step="1"
          bind:value={editShadeHeightFt}
        /></label
      >
      <label
        >Opacity (0–1)<input
          type="number"
          min="0"
          max="1"
          step="0.05"
          bind:value={editShadeOpacity}
        /></label
      >
      {#if fields.length > 0}
        <label class="full"
          >Field
          <select bind:value={editShadeFieldId}>
            <option value="">— Farm-wide (no field) —</option>
            {#each fields as ff (ff.id)}<option value={ff.id}>{ff.name}</option>{/each}
          </select>
        </label>
      {/if}
    </div>
    <label class="checkbox-line">
      <input type="checkbox" bind:checked={editShadeIsDeciduous} />
      Deciduous (leaves drop in winter)
    </label>
    {#if editShadeIsDeciduous}
      <div class="grid2">
        <label
          >Leaf-on (day of year)<input
            type="number"
            min="1"
            max="366"
            bind:value={editShadeLeafOnDoy}
          /></label
        >
        <label
          >Leaf-off (day of year)<input
            type="number"
            min="1"
            max="366"
            bind:value={editShadeLeafOffDoy}
          /></label
        >
      </div>
    {/if}
    <div class="row">
      <button class="primary" onclick={saveEditShade}>Save</button>
      <button onclick={() => (editingShadeId = null)}>Cancel</button>
    </div>
  </div>
{/snippet}

<style>
  .card {
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 14px;
  }
  .welcome h2 {
    margin: 0 0 6px;
    font-size: 1.1rem;
  }
  .welcome p,
  .empty p {
    margin: 0;
    color: var(--color-ink-soft);
    font-size: 13.5px;
  }
  .lede {
    color: var(--color-ink-soft);
    font-size: 13px;
    margin: 0 0 10px;
  }
  .empty-row,
  .empty-row-indent {
    color: var(--color-ink-muted);
    font-style: italic;
    font-size: 13px;
  }
  .empty-row-indent {
    padding-left: 1.5rem;
  }

  .field-group {
    border-top: 1px solid var(--color-divider-soft, var(--color-divider));
    padding: 10px 0;
  }
  .field-group:first-child {
    border-top: 0;
  }
  .field-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .field-icon {
    font-size: 1rem;
  }
  .field-name {
    font-size: 14px;
    color: var(--color-ink);
  }
  .field-stats {
    color: var(--color-ink-muted);
    font-size: 12px;
    margin-right: auto;
  }
  .field-notes {
    margin: 4px 0 0 1.5rem;
    color: var(--color-ink-muted);
    font-size: 12px;
  }

  .block-list-flat {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
  }
  .block-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0 6px 1.5rem;
    font-size: 13px;
  }
  .block-icon {
    color: var(--color-forest-deep);
  }
  .block-name {
    color: var(--color-ink);
    font-weight: 600;
  }
  .block-stats {
    color: var(--color-ink-muted);
    font-size: 11.5px;
    margin-right: auto;
  }
  .not-drawn {
    color: var(--color-rust, #a64a2a);
    font-style: italic;
  }
  .shade-row .block-name {
    font-weight: 500;
  }

  .row-action {
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    border-radius: 6px;
    min-width: 32px;
    min-height: 32px;
    cursor: pointer;
    font-size: 13px;
  }
  .row-action:hover {
    border-color: var(--color-forest-deep);
  }
  .row-action.danger:hover {
    border-color: var(--color-rust, #a64a2a);
  }

  .inline-edit-row {
    list-style: none;
  }
  .inline-edit {
    background: var(--color-cream);
    border: 1px solid var(--color-divider);
    border-radius: 8px;
    padding: 12px;
    margin: 6px 0 6px 1.5rem;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .grid2 .full {
    grid-column: 1 / -1;
  }
  .inline-edit label,
  .add-form-section label,
  .advanced > label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--color-ink-soft);
  }
  .checkbox-line {
    flex-direction: row !important;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
  }
  input[type='text'],
  input[type='number'],
  select,
  textarea {
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-ink);
    padding: 7px 9px;
    border-radius: 6px;
    font-size: 13px;
    font-family: inherit;
    width: 100%;
  }
  textarea {
    font-family: var(--font-mono, ui-monospace, monospace);
    resize: vertical;
  }
  .block-slope-hint {
    font-size: 11px;
    color: var(--color-ink-muted);
    margin: 6px 0;
  }
  .row {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }

  .add-block-inline {
    display: flex;
    gap: 8px;
    align-items: center;
    margin: 6px 0 6px 1.5rem;
  }
  .add-block-inline input[type='text'] {
    flex: 1;
  }
  .acres-input {
    max-width: 80px;
  }

  button.primary {
    background: var(--color-forest-deep);
    color: var(--color-paper);
    border: 0;
    border-radius: 6px;
    padding: 8px 14px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  button.primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  button.small,
  button.primary.small {
    padding: 6px 10px;
    font-size: 12px;
  }
  button:not(.primary):not(.row-action) {
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: 6px;
    padding: 8px 14px;
    font-size: 13px;
    cursor: pointer;
  }

  .advanced summary,
  .nested-advanced summary {
    cursor: pointer;
    font-weight: 600;
    font-size: 13.5px;
    color: var(--color-ink);
  }
  .add-form-section {
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .nested-advanced {
    margin-top: 12px;
    border-top: 1px dashed var(--color-divider);
    padding-top: 12px;
  }
  .paste-mode-tabs {
    display: flex;
    gap: 6px;
    margin-bottom: 10px;
  }
  .paste-mode-tabs button.active {
    background: var(--color-forest-deep);
    color: var(--color-paper);
    border-color: var(--color-forest-deep);
  }
  .paste-results {
    width: 100%;
    border-collapse: collapse;
    margin-top: 10px;
    font-size: 12px;
  }
  .paste-results th,
  .paste-results td {
    border: 1px solid var(--color-divider);
    padding: 4px 8px;
    text-align: left;
  }
  .result-ok {
    color: var(--color-forest-deep);
  }
  .result-warn {
    color: var(--color-rust, #a64a2a);
  }
  .error {
    color: var(--color-rust, #a64a2a);
    font-size: 12.5px;
    margin: 6px 0 0;
  }
  .success {
    color: var(--color-forest-deep);
    font-size: 12.5px;
    margin: 6px 0 0;
  }
  .muted {
    color: var(--color-ink-muted);
    font-size: 11.5px;
  }
  code {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 11.5px;
    background: var(--color-cream);
    padding: 1px 4px;
    border-radius: 3px;
  }
</style>
