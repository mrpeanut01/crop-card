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
  import { onMount, tick, untrack } from 'svelte';
  import BlockMap from '$lib/components/BlockMap.svelte';
  import UnitInput from '$lib/components/ui/UnitInput.svelte';
  import { currentPrefs, fmt } from '$lib/prefsState.svelte';
  import { formatAreaAcres } from '$lib/cards/build/size';
  import FarmSketch from '$lib/components/farm/FarmSketch.svelte';
  import AreaAddDrawer from '$lib/components/farm/AreaAddDrawer.svelte';
  import AreaCardSheet from '$lib/components/farm/AreaCardSheet.svelte';
  import AreaDetailsFields from '$lib/components/farm/AreaDetailsFields.svelte';
  import MapFilterPanel from '$lib/components/farm/MapFilterPanel.svelte';
  import MapFeatureList from '$lib/components/farm/MapFeatureList.svelte';
  import Hint from '$lib/components/ui/Hint.svelte';
  import { markHintSeen } from '$lib/client/hints';
  import { SQFT_PER_ACRE, formatFt, sketchAcres } from '$lib/farm/sketch';
  import {
    AREA_KINDS,
    AREA_KIND_LABELS,
    isCropBearing,
    type AreaDetails,
    type AreaKind
  } from '$lib/farm/areaKinds';
  import {
    AREA_KIND_NOUN,
    AREA_NAME_PLACEHOLDER,
    kindCounts,
    kindStyle,
    type AddPick
  } from '$lib/farm/kindStyle';
  import {
    DEFAULT_MAP_FILTER,
    isFilterActive,
    loadMapFilter,
    saveMapFilter,
    type MapFilter
  } from '$lib/farm/mapFilter';
  import {
    featureCounts as countFeatures,
    type FeatureGeometry,
    type MapFeatureDetails,
    type MapFeatureKind,
    type MapFeatureView
  } from '$lib/farm/mapFeatures';
  import { detailsFromDraft, draftFromDetails, type DetailsDraft } from '$lib/farm/areaDetailsForm';
  import { snapshotFromMapData } from '$lib/farm/mapSnapshot';
  import type { FarmSnapshot } from '$lib/cards/snapshot';
  import type { BlockWithPlantings } from '$lib/db/blocks';
  import type { FieldWithBlocks } from '$lib/db/fields';
  import type { ShadeSource, ShadeSourceKind } from '$lib/db/shadeSources';
  import type { TillageMethod } from '$lib/schedule/constants';

  type Geom = { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
  type ShadeKind = ShadeSourceKind;
  type AreaExtra = { kind: AreaKind; details: AreaDetails | null };

  let {
    blocks,
    fields,
    shadeSources = [],
    mapFeatures = [],
    canEdit,
    isFirstRun = false,
    initialMode,
    initialCenter = null,
    ownerId = null,
    snapshot = null,
    exportHref = '/plan/farm-map'
  }: {
    blocks: BlockWithPlantings[];
    fields: FieldWithBlocks[];
    shadeSources?: ShadeSource[];
    mapFeatures?: MapFeatureView[];
    canEdit: boolean;
    isFirstRun?: boolean;
    /** Start on the map or on the dimension sketch. Defaults to the sketch
     *  when the farm has sizes entered but nothing drawn on the map. */
    initialMode?: 'map' | 'sketch';
    initialCenter?: { lat: number; lon: number } | null;
    /** Keys the saved layer filter so each farm keeps its own. */
    ownerId?: string | null;
    /** Card data for the Area Card; built from `fields`/`blocks` when absent. */
    snapshot?: FarmSnapshot | null;
    /** Where Export goes: the printable Farm Map Card. */
    exportHref?: string | null;
  } = $props();

  // ─── Filter (per Owner, this browser only) ─────────────────────────────────
  let filter = $state<MapFilter>({ ...DEFAULT_MAP_FILTER, hidden: [], hiddenFeatures: [] });
  let filterOpen = $state(false);
  onMount(() => {
    filter = loadMapFilter(ownerId);
  });
  function setFilter(next: MapFilter) {
    filter = next;
    saveMapFilter(ownerId, next);
  }
  const counts = $derived(kindCounts(fields.map((f) => ({ kind: f.kind ?? 'field' }))));
  const featureCounts = $derived(countFeatures(mapFeatures));
  const filterActive = $derived(isFilterActive(filter));

  // ─── Add drawer ────────────────────────────────────────────────────────────
  let addOpen = $state(false);
  let mapBusy = $state(false);
  let sketchFormEl = $state<HTMLFormElement | null>(null);
  async function onPick(pick: AddPick) {
    addOpen = false;
    void markHintSeen('map_add');
    if (mode === 'map') {
      blockMap?.startDrawPick(pick);
      return;
    }
    if (pick.type === 'area') {
      setNewFieldKind(pick.kind);
      await tick();
      sketchFormEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      sketchFormEl?.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
    }
  }

  // ─── Area Card ─────────────────────────────────────────────────────────────
  let selectedAreaId = $state<string | null>(null);
  const selectedArea = $derived(fields.find((f) => f.id === selectedAreaId) ?? null);
  const cardSnapshot = $derived(
    snapshot ?? snapshotFromMapData({ ownerId: ownerId ?? 'local', fields, blocks })
  );
  function openArea(id: string) {
    selectedAreaId = id;
  }
  function editSelectedShape() {
    const id = selectedAreaId;
    selectedAreaId = null;
    if (id) blockMap?.editArea(id);
  }

  const hasGeometry = $derived(
    fields.some((f) => f.geometryGeojson) || blocks.some((b) => b.geometryGeojson)
  );
  const hasSketchDims = $derived(
    fields.some((f) => f.widthFt && f.lengthFt) || blocks.some((b) => b.widthFt && b.lengthFt)
  );
  let mode = $state<'map' | 'sketch'>(
    untrack(() => initialMode ?? (!hasGeometry && hasSketchDims ? 'sketch' : 'map'))
  );

  let locating = $state(false);
  let locateMessage = $state<string | null>(null);
  async function centerOnMe() {
    if (!blockMap) return;
    locating = true;
    locateMessage = null;
    locateMessage = await blockMap.centerOnMe();
    locating = false;
  }

  function dimsText(item: { widthFt?: number; lengthFt?: number }): string | null {
    return item.widthFt && item.lengthFt
      ? `${formatFt(item.widthFt, currentPrefs()).replace(/ \S+$/, '')} × ${formatFt(item.lengthFt, currentPrefs())}`
      : null;
  }

  // ─── BlockMap draw callbacks ──────────────────────────────────────────────
  let blockMap = $state<{
    currentDraftName: () => string;
    currentDraftFieldId: () => string;
    centerOnMe: () => Promise<string | null>;
    startDrawPick: (pick: AddPick) => void;
    editArea: (fieldId: string) => boolean;
  } | null>(null);

  const canEditShape = $derived(
    canEdit &&
      mode === 'map' &&
      !!selectedArea?.geometryGeojson &&
      !!blockMap &&
      !filter.hidden.includes(selectedArea.kind ?? 'field')
  );

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

  async function createFieldWithGeometry(
    name: string,
    geom: Geom,
    suggestedAcres: number | null,
    extra?: AreaExtra
  ) {
    if (!name.trim()) throw new Error('Give it a name first.');
    const res = await fetch('/api/fields', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        acres: suggestedAcres !== null ? Number(suggestedAcres.toFixed(2)) : undefined,
        geometryGeojson: geom,
        kind: extra?.kind,
        details: extra?.details ?? undefined
      })
    });
    if (!res.ok) {
      const out = await res.json().catch(() => ({}));
      throw new Error(out.error ?? `HTTP ${res.status}`);
    }
    await invalidateAll();
  }

  async function saveAreaDetails(fieldId: string, extra: AreaExtra) {
    const res = await fetch(`/api/fields/${encodeURIComponent(fieldId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: extra.kind, details: extra.details })
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

  async function featureRequest(url: string, method: string, body?: unknown) {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!res.ok) {
      const out = await res.json().catch(() => ({}));
      throw new Error(out.error ?? `HTTP ${res.status}`);
    }
    await invalidateAll();
  }

  function createMapFeature(input: {
    kind: MapFeatureKind;
    name: string;
    geometry: FeatureGeometry;
    fieldId: string | null;
    details: MapFeatureDetails | null;
  }) {
    return featureRequest('/api/map-features', 'POST', input);
  }

  function updateMapFeatureGeometry(id: string, geometry: FeatureGeometry) {
    return featureRequest(`/api/map-features/${encodeURIComponent(id)}`, 'PATCH', { geometry });
  }

  function saveMapFeature(
    id: string,
    body: { name: string; fieldId: string | null; details: MapFeatureDetails | null }
  ) {
    return featureRequest(`/api/map-features/${encodeURIComponent(id)}`, 'PATCH', body);
  }

  function deleteMapFeature(id: string) {
    return featureRequest(`/api/map-features/${encodeURIComponent(id)}`, 'DELETE');
  }

  // ─── Field create / edit / delete ─────────────────────────────────────────
  let newFieldName = $state('');
  let newFieldAcres = $state<number | undefined>(undefined);
  let newFieldNotes = $state('');
  let newFieldWidth = $state<number | null | undefined>(undefined);
  let newFieldLength = $state<number | null | undefined>(undefined);
  let creatingField = $state(false);
  let fieldError = $state<string | null>(null);
  let newFieldKind = $state<AreaKind>(
    untrack(
      () => (fields.find((f) => f.kind && isCropBearing(f.kind))?.kind as AreaKind) ?? 'field'
    )
  );
  let newFieldDetails = $state<DetailsDraft>({});

  function setNewFieldKind(kind: AreaKind) {
    newFieldKind = kind;
    newFieldDetails = draftFromDetails(kind, null);
  }

  async function createField() {
    if (!newFieldName.trim()) return;
    const checked = detailsFromDraft(newFieldKind, newFieldDetails);
    if (!checked.ok) {
      fieldError = 'Some details don’t look right. Check them and try again.';
      return;
    }
    creatingField = true;
    fieldError = null;
    try {
      const res = await fetch('/api/fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newFieldName.trim(),
          acres: newFieldAcres,
          notes: newFieldNotes.trim() || undefined,
          widthFt: newFieldWidth || undefined,
          lengthFt: newFieldLength || undefined,
          kind: newFieldKind,
          details: checked.details ?? undefined
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
      newFieldWidth = undefined;
      newFieldLength = undefined;
      newFieldDetails = draftFromDetails(newFieldKind, null);
      if (out.field?.kind && isCropBearing(out.field.kind)) newBlockFieldId = out.field.id;
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
  let editFieldWidth = $state<number | null | undefined>(undefined);
  let editFieldLength = $state<number | null | undefined>(undefined);

  function startEditField(f: {
    id: string;
    name: string;
    acres?: number;
    notes?: string;
    widthFt?: number;
    lengthFt?: number;
  }) {
    editingFieldId = f.id;
    editFieldName = f.name;
    editFieldAcres = f.acres;
    editFieldNotes = f.notes ?? '';
    editFieldWidth = f.widthFt;
    editFieldLength = f.lengthFt;
  }

  async function sizeArea(id: string) {
    const f = fields.find((x) => x.id === id);
    if (!f) return;
    startEditField(f);
    await tick();
    const row = document.querySelector<HTMLElement>(`[data-area-row="${CSS.escape(id)}"]`);
    row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row?.querySelector<HTMLInputElement>('.inline-edit input')?.focus();
  }

  async function saveEditField() {
    if (!editingFieldId) return;
    const res = await fetch(`/api/fields/${encodeURIComponent(editingFieldId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editFieldName.trim(),
        ...dimsPatch(
          editFieldWidth,
          editFieldLength,
          editFieldAcres,
          fields.find((f) => f.id === editingFieldId)
        ),
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
        ? `Delete "${name}"? This removes all ${blockCount} block(s) and every crop and record kept against them. It can't be undone.`
        : `Delete "${name}"?`
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
  let newBlockWidth = $state<number | null | undefined>(undefined);
  let newBlockLength = $state<number | null | undefined>(undefined);
  let creatingBlock = $state(false);

  const blockParents = $derived(fields.filter((f) => isCropBearing(f.kind ?? 'field')));

  $effect(() => {
    if (blockParents.length > 0 && !blockParents.some((f) => f.id === newBlockFieldId)) {
      newBlockFieldId = blockParents[0].id;
    }
  });

  /** When the size changes, acres are left out so the server recomputes them
   *  from width × length; otherwise the edited acres are saved as-is. */
  function dimsPatch(
    widthFt: number | null | undefined,
    lengthFt: number | null | undefined,
    acres: number | undefined,
    before: { widthFt?: number; lengthFt?: number } | undefined
  ) {
    const w = widthFt || null;
    const l = lengthFt || null;
    const resized = w !== (before?.widthFt ?? null) || l !== (before?.lengthFt ?? null);
    const recompute = resized && sketchAcres(w, l) !== undefined;
    return { widthFt: w, lengthFt: l, acres: recompute ? undefined : (acres ?? null) };
  }
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
        body: JSON.stringify({
          name: newBlockName.trim(),
          acres: newBlockAcres,
          fieldId,
          widthFt: newBlockWidth || undefined,
          lengthFt: newBlockLength || undefined
        })
      });
      const out = await res.json();
      if (!res.ok) {
        blockError = out.error ?? `HTTP ${res.status}`;
        return;
      }
      newBlockName = '';
      newBlockAcres = undefined;
      newBlockWidth = undefined;
      newBlockLength = undefined;
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
  let editBlockWidth = $state<number | null | undefined>(undefined);
  let editBlockLength = $state<number | null | undefined>(undefined);

  function startEditBlock(b: {
    id: string;
    name: string;
    acres?: number;
    blockLabel?: string;
    fieldId?: string;
    tillageMethod?: TillageMethod;
    slopePercent?: number;
    slopeAspectDeg?: number;
    widthFt?: number;
    lengthFt?: number;
  }) {
    editingBlockId = b.id;
    editBlockWidth = b.widthFt;
    editBlockLength = b.lengthFt;
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
        ...dimsPatch(
          editBlockWidth,
          editBlockLength,
          editBlockAcres,
          blocks.find((b) => b.id === editingBlockId)
        ),
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
    <h2>Put your farm on the map</h2>
    <p>
      Tap <strong>Add</strong> and pick what you're adding: a field, a garden, a greenhouse, the
      barn. Then outline it on the <strong>Map</strong>. If the aerial view doesn't help, switch to
      <strong>Dimensions</strong> and type its width and length instead; CropCard draws it as a box.
    </p>
  </section>
{/if}

<div class="mode-bar">
  <div class="seg" role="group" aria-label="How to lay out your farm">
    <button
      type="button"
      class:active={mode === 'map'}
      aria-pressed={mode === 'map'}
      onclick={() => (mode = 'map')}>🗺️ Map</button
    >
    <button
      type="button"
      class:active={mode === 'sketch'}
      aria-pressed={mode === 'sketch'}
      onclick={() => (mode = 'sketch')}>📐 Dimensions</button
    >
  </div>
  {#if mode === 'map'}
    <button type="button" class="locate" onclick={centerOnMe} disabled={locating || !blockMap}>
      📍 {locating ? 'Locating…' : 'Center on my location'}
    </button>
  {/if}
</div>
<div class="verbs" role="toolbar" aria-label="Farm map">
  {#if canEdit}
    <button
      type="button"
      class="verb primary"
      data-hint-anchor="map_add"
      onclick={() => (addOpen = true)}
      disabled={mode === 'map' && !blockMap}>+ Add</button
    >
  {/if}
  <button
    type="button"
    class="verb"
    class:on={filterActive}
    data-hint-anchor="map_filter"
    onclick={() => {
      filterOpen = true;
      void markHintSeen('map_filter');
    }}
  >
    Filter{filterActive ? ' (on)' : ''}
  </button>
  {#if exportHref}
    <a class="verb" href={exportHref}>Export card</a>
  {/if}
</div>
{#if mode === 'map' && locateMessage}
  <p class="locate-msg" role="status">{locateMessage}</p>
{/if}

{#if canEdit}
  <Hint
    key="map_add"
    anchor="[data-hint-anchor=map_add]"
    text="Tap Add to put a field, garden, greenhouse or barn on your farm. You pick what it is, then outline it."
    suppressed={addOpen || filterOpen || !!selectedArea || mapBusy}
  />
  <Hint
    key="map_draw_area"
    anchor="[data-hint-anchor=map_draw_area]"
    text="Tap each corner, then the first corner again to close the shape. Size and perimeter fill in for you."
    suppressed={addOpen || filterOpen || !!selectedArea || mapBusy}
  />
{/if}
<Hint
  key="map_filter"
  anchor="[data-hint-anchor=map_filter]"
  text="Filter hides kinds you don't need right now, like woods or the pond. It remembers your choice on this device."
  suppressed={addOpen || filterOpen || !!selectedArea || mapBusy}
/>

<AreaAddDrawer
  open={addOpen}
  onClose={() => (addOpen = false)}
  {onPick}
  {mode}
  canAddBlock={blockParents.length > 0}
/>
<MapFilterPanel
  open={filterOpen}
  onClose={() => (filterOpen = false)}
  {filter}
  onChange={setFilter}
  {counts}
  {featureCounts}
  showBaseLayer={mode === 'map'}
  hasShade={shadeSources.length > 0}
  canAdd={canEdit}
/>
{#if selectedArea}
  <AreaCardSheet
    open={!!selectedArea}
    onClose={() => (selectedAreaId = null)}
    snapshot={cardSnapshot}
    area={{
      id: selectedArea.id,
      name: selectedArea.name,
      kind: selectedArea.kind ?? 'field',
      details: selectedArea.details ?? null
    }}
    {canEdit}
    onEditShape={canEditShape ? editSelectedShape : undefined}
  />
{/if}

{#if mode === 'map'}
  {#if browser}
    <BlockMap
      bind:this={blockMap}
      {blocks}
      {fields}
      {canEdit}
      {shadeSources}
      {initialCenter}
      {filter}
      autoLocate={canEdit && !hasGeometry && !initialCenter}
      onSelectArea={openArea}
      onSaveAreaDetails={saveAreaDetails}
      onSaveGeometry={saveGeometry}
      onCreateWithGeometry={createBlockWithGeometry}
      onSaveFieldGeometry={saveFieldGeometry}
      onCreateFieldWithGeometry={createFieldWithGeometry}
      onCreateShadeSource={createShadeSource}
      onDeleteShadeSource={deleteShadeSource}
      onUpdateShadeGeometry={updateShadeGeometry}
      {mapFeatures}
      onCreateMapFeature={createMapFeature}
      onUpdateMapFeatureGeometry={updateMapFeatureGeometry}
      onBusyChange={(b) => (mapBusy = b)}
    />
  {:else}
    <section class="card empty"><p>Loading map…</p></section>
  {/if}
{:else}
  <FarmSketch
    fields={fields.filter((f) => !filter.hidden.includes(f.kind ?? 'field'))}
    blocks={blocks.filter((b) => {
      const parent = fields.find((f) => f.id === b.fieldId);
      return !parent || !filter.hidden.includes(parent.kind ?? 'field');
    })}
    onSelectArea={openArea}
    onSizeArea={canEdit ? sizeArea : undefined}
  />
  {#if canEdit}
    {@const fieldAcresPreview = sketchAcres(newFieldWidth, newFieldLength)}
    {@const blockAcresPreview = sketchAcres(newBlockWidth, newBlockLength)}
    <section class="card sketch-forms">
      <form
        class="dim-form"
        data-testid="sketch-add-field"
        bind:this={sketchFormEl}
        onsubmit={(e) => {
          e.preventDefault();
          createField();
        }}
      >
        <h3>
          {fields.length === 0 ? '1. ' : ''}Add {AREA_KIND_NOUN[newFieldKind]}
        </h3>
        <label class="kind-pick"
          >Kind
          <select
            value={newFieldKind}
            onchange={(e) => setNewFieldKind(e.currentTarget.value as AreaKind)}
          >
            {#each AREA_KINDS as k (k)}
              <option value={k}>{AREA_KIND_LABELS[k]}</option>
            {/each}
          </select>
        </label>
        <div class="grid3">
          <label
            >Name<input
              type="text"
              placeholder={AREA_NAME_PLACEHOLDER[newFieldKind]}
              bind:value={newFieldName}
            /></label
          >
          <label
            >Width ({fmt.unit('distance')})<UnitInput
              quantity="distance"
              suffix={false}
              min={1}
              bind:value={newFieldWidth}
            /></label
          >
          <label
            >Length ({fmt.unit('distance')})<UnitInput
              quantity="distance"
              suffix={false}
              min={1}
              bind:value={newFieldLength}
            /></label
          >
        </div>
        <AreaDetailsFields kind={newFieldKind} bind:draft={newFieldDetails} idPrefix="sketch-new" />
        <div class="row">
          <button
            type="submit"
            class="primary"
            disabled={creatingField || !newFieldName.trim() || !fieldAcresPreview}
          >
            {creatingField ? '…' : `Add ${AREA_KIND_LABELS[newFieldKind].toLowerCase()}`}
          </button>
          {#if fieldAcresPreview}<span class="hint"
              >≈ {fmt.qty(
                ((newFieldWidth ?? 0) * (newFieldLength ?? 0)) / SQFT_PER_ACRE,
                'area'
              )}</span
            >{/if}
        </div>
        {#if fieldError}<p class="error">{fieldError}</p>{/if}
      </form>

      {#if blockParents.length > 0}
        <form
          class="dim-form"
          data-testid="sketch-add-block"
          onsubmit={(e) => {
            e.preventDefault();
            createBlock();
          }}
        >
          <h3>{blocks.length === 0 ? '2. Add the blocks inside it' : 'Add a block'}</h3>
          <p class="hint">
            A block is a patch you plant as one unit: a bed, a row set, a corner of a field. Blocks
            are packed inside their area's box.
          </p>
          <div class="grid3">
            {#if blockParents.length > 1}
              <label class="full"
                >Inside
                <select bind:value={newBlockFieldId}>
                  {#each blockParents as ff (ff.id)}<option value={ff.id}>{ff.name}</option>{/each}
                </select>
              </label>
            {/if}
            <label
              >Block name<input
                type="text"
                placeholder="e.g. Sweet corn A"
                bind:value={newBlockName}
              /></label
            >
            <label
              >Width ({fmt.unit('distance')})<UnitInput
                quantity="distance"
                suffix={false}
                min={1}
                bind:value={newBlockWidth}
              /></label
            >
            <label
              >Length ({fmt.unit('distance')})<UnitInput
                quantity="distance"
                suffix={false}
                min={1}
                bind:value={newBlockLength}
              /></label
            >
          </div>
          <div class="row">
            <button
              type="submit"
              class="primary"
              disabled={creatingBlock || !newBlockName.trim() || !blockAcresPreview}
            >
              {creatingBlock ? '…' : 'Add block'}
            </button>
            {#if blockAcresPreview}<span class="hint"
                >≈ {fmt.qty(
                  ((newBlockWidth ?? 0) * (newBlockLength ?? 0)) / SQFT_PER_ACRE,
                  'area'
                )}</span
              >{/if}
          </div>
          {#if blockError}<p class="error">{blockError}</p>{/if}
        </form>
      {/if}
    </section>
  {/if}
{/if}

<section class="card" aria-label="Areas">
  {#if fields.length === 0}
    <p class="empty-row">
      Nothing on the map yet. Tap Add to outline a field, garden or barn, or switch to Dimensions
      and type its size.
    </p>
  {:else}
    {#each fields as f (f.id)}
      {@const fieldBlocks = blocks.filter((b) => b.fieldId === f.id)}
      {@const fieldAcresDisplay = f.acres ?? (f.blockAcresTotal > 0 ? f.blockAcresTotal : null)}
      {@const fKind = f.kind ?? 'field'}
      <div class="field-group" data-area-row={f.id}>
        <div class="field-row">
          <span class="field-swatch" style:--kind={kindStyle(fKind).color} aria-hidden="true"
          ></span>
          <button
            type="button"
            class="field-name"
            onclick={() => openArea(f.id)}
            aria-label="Open the card for {f.name}">{f.name}</button
          >
          <span class="field-stats">
            {AREA_KIND_LABELS[fKind]} ·
            {fieldBlocks.length} block{fieldBlocks.length === 1 ? '' : 's'}
            {#if fieldAcresDisplay !== null && fieldAcresDisplay > 0}· {formatAreaAcres(
                fieldAcresDisplay,
                currentPrefs()
              )}{/if}
            {#if dimsText(f)}· {dimsText(f)}{/if}
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
              aria-label="Add block to {f.name}">+ Block</button
            >
            <button
              class="row-action"
              onclick={() => startEditField(f)}
              title="Edit name and size"
              aria-label="Edit name and size of {f.name}">Edit size</button
            >
            <button
              class="row-action danger"
              onclick={() => deleteField(f.id, f.name, fieldBlocks.length)}
              aria-label="Delete {f.name}"
              title="Delete">Delete</button
            >
          {/if}
        </div>

        {#if editingFieldId === f.id}
          <div class="inline-edit">
            <div class="grid2">
              <label>Name<input type="text" bind:value={editFieldName} /></label>
              <label
                >Size<UnitInput
                  quantity="area"
                  min={0}
                  bind:value={
                    () => editFieldAcres ?? null, (v) => (editFieldAcres = v ?? undefined)
                  }
                /></label
              >
              <label
                >Width ({fmt.unit('distance')})<UnitInput
                  quantity="distance"
                  suffix={false}
                  min={1}
                  bind:value={editFieldWidth}
                /></label
              >
              <label
                >Length ({fmt.unit('distance')})<UnitInput
                  quantity="distance"
                  suffix={false}
                  min={1}
                  bind:value={editFieldLength}
                /></label
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
          <p class="empty-row-indent">
            No blocks yet. Draw one on the map, or add it by size under Dimensions.
          </p>
        {:else}
          <ul class="block-list-flat">
            {#each fieldBlocks as b (b.id)}
              {@const acresDisplay =
                b.acres !== undefined && b.acres > 0
                  ? formatAreaAcres(b.acres, currentPrefs())
                  : null}
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
                  {#if dimsText(b)}{acresDisplay || b.plantings.length > 0 ? ' · ' : ''}{dimsText(
                      b
                    )}{/if}
                  {#if !b.geometryGeojson}<span class="not-drawn">not on map</span>{/if}
                </span>
                {#if canEdit}
                  <button
                    class="row-action"
                    onclick={() => startEditBlock(b)}
                    title="Edit block"
                    aria-label="Edit {b.name}">Edit</button
                  >
                  <button
                    class="row-action danger"
                    onclick={() => deleteBlock(b.id, b.name, b.plantings.length)}
                    aria-label="Delete {b.name}"
                    title="Delete block">Delete</button
                  >
                {/if}
              </li>
              {#if editingBlockId === b.id}
                <li class="inline-edit-row">
                  <div class="inline-edit">
                    <div class="grid2">
                      <label>Name<input type="text" bind:value={editBlockName} /></label>
                      <label
                        >Size<UnitInput
                          quantity="area"
                          min={0}
                          bind:value={
                            () => editBlockAcres ?? null, (v) => (editBlockAcres = v ?? undefined)
                          }
                        /></label
                      >
                      <label
                        >Code<input
                          type="text"
                          placeholder="A"
                          bind:value={editBlockLabel}
                        /></label
                      >
                      <label
                        >Width ({fmt.unit('distance')})<UnitInput
                          quantity="distance"
                          suffix={false}
                          min={1}
                          bind:value={editBlockWidth}
                        /></label
                      >
                      <label
                        >Length ({fmt.unit('distance')})<UnitInput
                          quantity="distance"
                          suffix={false}
                          min={1}
                          bind:value={editBlockLength}
                        /></label
                      >
                      {#if fields.length > 1}
                        <label class="full"
                          >Move to
                          <select bind:value={editBlockFieldId}>
                            {#each blockParents as ff (ff.id)}<option value={ff.id}
                                >{ff.name}</option
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
            <input
              type="text"
              placeholder={fKind === 'garden' || fKind === 'greenhouse' ? 'Bed name' : 'Block name'}
              aria-label="Name"
              bind:value={newBlockName}
            />
            {#if fKind === 'garden' || fKind === 'greenhouse'}
              <span class="acres-input"
                ><UnitInput
                  quantity="distance"
                  min={1}
                  suffix={false}
                  placeholder="Width ({fmt.unit('distance')})"
                  aria-label="Width ({fmt.unit('distance')})"
                  bind:value={newBlockWidth}
                /></span
              >
              <span aria-hidden="true">×</span>
              <span class="acres-input"
                ><UnitInput
                  quantity="distance"
                  min={1}
                  suffix={false}
                  placeholder="Length ({fmt.unit('distance')})"
                  aria-label="Length ({fmt.unit('distance')})"
                  bind:value={newBlockLength}
                /></span
              >
            {:else}
              <span class="acres-input"
                ><UnitInput
                  quantity="area"
                  min={0}
                  placeholder={fmt.unit('area')}
                  suffix={false}
                  bind:value={() => newBlockAcres ?? null, (v) => (newBlockAcres = v ?? undefined)}
                /></span
              >
            {/if}
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
                  {s.kind} · {fmt.qty(s.heightFt, 'distance')}{#if s.isDeciduous}
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
          <strong class="field-title">Farm-wide shade sources</strong>
        </div>
        <ul class="block-list-flat">
          {#each shadeSources.filter((s) => !s.fieldId || !fields.some((f) => f.id === s.fieldId)) as s (s.id)}
            <li class="block-row shade-row">
              <span class="block-icon">{shadeKindEmoji(s.kind)}</span>
              <span class="block-name">{s.name}</span>
              <span class="block-stats">
                {s.kind} · {fmt.qty(s.heightFt, 'distance')}{#if s.isDeciduous}
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

{#if mapFeatures.length > 0 || (canEdit && mode === 'map')}
  <MapFeatureList
    features={mapFeatures}
    areas={fields.map((f) => ({ id: f.id, name: f.name }))}
    {canEdit}
    onSave={saveMapFeature}
    onDelete={deleteMapFeature}
  />
{/if}

{#if canEdit && mode === 'map'}
  <details class="card advanced">
    <summary>Add without drawing</summary>
    <p class="lede">
      Add an area, a block, a tree row, a grove, a building or other shade source by name only. You
      can outline it on the map later.
    </p>

    <label class="full">
      What are you adding?
      <select bind:value={addKind}>
        <option value="field">An area (field, garden, barn…)</option>
        <option value="block">A block inside an area</option>
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
            >Kind
            <select
              value={newFieldKind}
              onchange={(e) => setNewFieldKind(e.currentTarget.value as AreaKind)}
            >
              {#each AREA_KINDS as k (k)}
                <option value={k}>{AREA_KIND_LABELS[k]}</option>
              {/each}
            </select>
          </label>
          <label
            >Name<input
              type="text"
              placeholder={AREA_NAME_PLACEHOLDER[newFieldKind]}
              bind:value={newFieldName}
            /></label
          >
          <label
            >Size (optional)<UnitInput
              quantity="area"
              min={0}
              bind:value={() => newFieldAcres ?? null, (v) => (newFieldAcres = v ?? undefined)}
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
        <AreaDetailsFields kind={newFieldKind} bind:draft={newFieldDetails} idPrefix="nodraw-new" />
        <button
          class="primary"
          onclick={createField}
          disabled={creatingField || !newFieldName.trim()}
        >
          {creatingField ? '…' : `Add ${AREA_KIND_LABELS[newFieldKind].toLowerCase()}`}
        </button>
        {#if fieldError}<p class="error">{fieldError}</p>{/if}
      </div>
    {:else if addKind === 'block'}
      {#if blockParents.length === 0}
        <p class="error">Add a crop area first. Every block sits inside one.</p>
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
              >Size (optional)<UnitInput
                quantity="area"
                min={0}
                bind:value={() => newBlockAcres ?? null, (v) => (newBlockAcres = v ?? undefined)}
              /></label
            >
            <label class="full"
              >Inside
              <select bind:value={newBlockFieldId}>
                {#each blockParents as ff (ff.id)}<option value={ff.id}>{ff.name}</option>{/each}
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
            >Height<UnitInput
              quantity="distance"
              min={1}
              max={200}
              bind:value={() => addShadeHeightFt, (v) => (addShadeHeightFt = v ?? 0)}
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
            >Area (optional; leave blank for the whole farm)
            <select bind:value={addShadeFieldId}>
              <option value="">Whole farm</option>
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
            {#each pasteResults as r, idx (idx)}
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
        >Height<UnitInput
          quantity="distance"
          min={1}
          max={200}
          bind:value={() => editShadeHeightFt ?? null, (v) => (editShadeHeightFt = v ?? undefined)}
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
            <option value="">Whole farm</option>
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
  .mode-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 10px;
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--color-divider);
    border-radius: 8px;
    overflow: hidden;
  }
  .seg button {
    min-height: 48px;
    padding: 0 16px !important;
    border: 0 !important;
    border-radius: 0 !important;
    font-size: 14px !important;
    font-weight: 600;
    background: var(--color-paper);
    color: var(--color-ink-soft);
  }
  .seg button.active {
    background: var(--color-forest-deep) !important;
    color: var(--color-paper);
  }
  button.locate {
    min-height: 48px;
    font-weight: 600;
  }
  .locate-msg {
    margin: 0 0 10px;
    font-size: 13px;
    color: var(--color-ink-soft);
  }
  .sketch-forms {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 16px;
  }
  .dim-form h3 {
    margin: 0 0 8px;
    font-size: 1rem;
  }
  .dim-form label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--color-ink-soft);
  }
  .dim-form input,
  .dim-form select {
    min-height: 44px;
    font-size: 15px;
  }
  .dim-form button.primary {
    min-height: 48px;
  }
  .dim-form .row {
    align-items: center;
  }
  .grid3 {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr;
    gap: 10px;
  }
  .grid3 .full {
    grid-column: 1 / -1;
  }
  @media (max-width: 480px) {
    .grid3 {
      grid-template-columns: 1fr 1fr;
    }
    .grid3 > label:first-child:not(.full),
    .grid3 > .full + label {
      grid-column: 1 / -1;
    }
  }
  .hint {
    font-size: 12.5px;
    color: var(--color-ink-muted);
    margin: 0 0 8px;
  }
  .row .hint {
    margin: 0;
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
  .field-title {
    font-size: 14px;
    color: var(--color-ink);
  }
  .field-swatch {
    flex: 0 0 16px;
    height: 16px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--kind) 35%, transparent);
    border: 2px solid var(--kind);
  }
  .field-name {
    min-height: 48px;
    padding: 0 4px;
    border: 0;
    background: none;
    font: inherit;
    font-size: 14px;
    font-weight: 700;
    color: var(--color-ink);
    text-align: left;
    text-decoration: underline;
    text-decoration-color: var(--color-divider);
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .field-name:hover {
    text-decoration-color: currentColor;
  }
  .verbs {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 10px;
  }
  .verb {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    padding: 0 18px;
    border-radius: 8px;
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-forest-deep);
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
  }
  .verb.primary {
    background: var(--color-forest-deep);
    border-color: var(--color-forest-deep);
    color: var(--color-paper);
  }
  .verb.on {
    border-color: var(--color-forest);
    background: var(--pill-forest-bg);
  }
  .verb:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .verb:focus-visible,
  .field-name:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .kind-pick {
    margin-bottom: 8px;
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
    min-width: 48px;
    min-height: 48px;
    padding: 0 10px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    color: var(--color-forest-deep);
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
  label :global(.unit-input > input),
  .acres-input :global(input),
  select,
  textarea {
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-ink);
    padding: 7px 9px;
    border-radius: 6px;
    font-size: 16px;
    font-family: inherit;
    width: 100%;
    min-height: 48px;
    box-sizing: border-box;
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
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    margin: 6px 0 6px 1.5rem;
  }
  .add-block-inline input[type='text'] {
    flex: 1;
  }
  .acres-input {
    max-width: 96px;
  }

  button.primary {
    background: var(--color-forest-deep);
    color: var(--color-paper);
    border: 0;
    border-radius: 6px;
    padding: 8px 14px;
    min-height: 48px;
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
    min-width: 48px;
    font-size: 12px;
  }
  button:not(.primary):not(.row-action):not(.verb):not(.field-name) {
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: 6px;
    padding: 8px 14px;
    min-height: 48px;
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
