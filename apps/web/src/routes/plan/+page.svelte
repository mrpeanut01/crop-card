<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { untrack } from 'svelte';
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import BlockMap from '$lib/components/BlockMap.svelte';
  import CropPickerModal from '$lib/components/CropPickerModal.svelte';
  import BlockSwimlane from '$lib/components/BlockSwimlane.svelte';
  import CropPalette from '$lib/components/CropPalette.svelte';
  import SeedQuantityModal from '$lib/components/SeedQuantityModal.svelte';
  import AllocationWizard from '$lib/components/AllocationWizard.svelte';
  import PlantingGroupWizard from '$lib/components/PlantingGroupWizard.svelte';
  import ScheduleOptimizerSidebar from '$lib/components/ScheduleOptimizerSidebar.svelte';
  import GroupInspector from '$lib/components/GroupInspector.svelte';
  import SeasonSetupStep from '$lib/components/SeasonSetupStep.svelte';
  import {
    type SeasonSetup,
    PHILOSOPHY_LABELS,
    WEED_LABELS,
    PEST_LABELS,
    FERTILITY_LABELS,
    COVER_LABELS,
    SPRAY_LABELS
  } from '$lib/season/setup';
  import {
    applyBlockOrder,
    loadBlockOrder,
    reorderOnDrop,
    saveBlockOrder
  } from '$lib/client/blockOrder';
  import { eventsForPlanting } from '$lib/calendar/engine';
  import { prepTasksForPlanting } from '$lib/schedule/prepTasks';
  import { detectPhiConflict, harvestWindow, sprayWindows } from '$lib/schedule/timeline';
  import { DAY_MS, type TillageMethod } from '$lib/schedule/constants';
  import type { PlanTab, ScheduleCatalogItem } from './+page.server';

  let { data } = $props();

  // Schedule tab merged into Calendar (2026-05-17). Calendar tab now
  // toggles between swimlane (Schedule's view) and grid (month view).
  // Legacy /plan?tab=schedule URLs still load the swimlane payload so
  // bookmarks don't break.
  const TABS: Array<{ id: PlanTab; label: string; icon: string }> = [
    { id: 'overview', label: 'Overview', icon: '🏠' },
    { id: 'layout', label: 'Layout', icon: '🗺️' },
    { id: 'crops', label: 'Crops', icon: '🌱' },
    { id: 'calendar', label: 'Calendar', icon: '📅' }
  ];

  const FROST = $derived(data.frostDates);

  function tabHref(tab: PlanTab): string {
    const sp = new URLSearchParams($page.url.searchParams);
    sp.set('tab', tab);
    sp.delete('ym');
    sp.delete('fieldId');
    sp.delete('blockId');
    return `/plan?${sp.toString()}`;
  }

  /** Build a /plan URL that flips the Calendar view between swimlane
   *  and grid without leaving duplicate `view=` query params behind.
   *  Naive string concatenation produced `?view=grid&view=swimlane`,
   *  and URLSearchParams.get() returns the first match — so the
   *  switch silently no-op'd. Use this helper any time the destination
   *  URL needs an explicit view choice. */
  function calendarHref(targetView: 'swimlane' | 'grid'): string {
    const sp = new URLSearchParams($page.url.searchParams);
    sp.set('tab', 'calendar');
    sp.set('view', targetView);
    sp.delete('ym');
    sp.delete('fieldId');
    sp.delete('blockId');
    return `/plan?${sp.toString()}`;
  }

  // ─── Layout — field / block management state ────────────────────────────
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
  /** v1.3 shade model: terrain slope inputs. */
  let editBlockSlopePercent = $state<number | null>(null);
  let editBlockSlopeAspectDeg = $state<number | null>(null);

  // ─── Shade-source inline edit state (parallels block edit) ────────────────
  let editingShadeId = $state<string | null>(null);
  let editShadeName = $state('');
  let editShadeKind = $state<'tree-row' | 'tree-grove' | 'tree-single' | 'hedge' | 'building' | 'fence' | 'structure' | 'other'>('tree-row');
  let editShadeFieldId = $state<string>('');
  let editShadeHeightFt = $state<number | undefined>(undefined);
  let editShadeOpacity = $state<number | undefined>(undefined);
  let editShadeIsDeciduous = $state<boolean>(true);
  let editShadeLeafOnDoy = $state<number | undefined>(undefined);
  let editShadeLeafOffDoy = $state<number | undefined>(undefined);

  function startEditShade(s: {
    id: string;
    name: string;
    kind: 'tree-row' | 'tree-grove' | 'tree-single' | 'hedge' | 'building' | 'fence' | 'structure' | 'other';
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
      case 'tree-row': return '🌳';
      case 'tree-grove': return '🌲';
      case 'tree-single': return '🌳';
      case 'hedge': return '🌿';
      case 'building': return '🏠';
      case 'fence': return '🧱';
      case 'structure': return '🏗️';
      default: return '🌑';
    }
  }

  // ─── Unified "Add without drawing" panel ──────────────────────────────────
  type AddKind =
    | 'field'
    | 'block'
    | 'tree-row'
    | 'tree-grove'
    | 'tree-single'
    | 'hedge'
    | 'building'
    | 'fence'
    | 'structure'
    | 'other';
  let addKind = $state<AddKind>('field');
  // Shade-source-specific add state (separate from the inline edit state).
  let addShadeName = $state('');
  let addShadeHeightFt = $state<number>(30);
  let addShadeOpacity = $state<number>(0.7);
  let addShadeIsDeciduous = $state<boolean>(true);
  let addShadeLeafOnDoy = $state<number>(105);
  let addShadeLeafOffDoy = $state<number>(305);
  let addShadeFieldId = $state<string>('');
  let addingShade = $state<boolean>(false);
  let addShadeError = $state<string | null>(null);

  function isShadeKind(k: AddKind): boolean {
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

  // ─── Crops tab state ────────────────────────────────────────────────────
  let plantingError = $state<string | null>(null);
  let pickerBlockId = $state<string | null>(null);
  let openGuides = $state(new Set<string>());
  function toggleGuide(id: string) {
    const next = new Set(openGuides);
    next.has(id) ? next.delete(id) : next.add(id);
    openGuides = next;
  }

  type CompanionSuggestion = {
    systemName: string;
    systemBenefit: string;
    members: Array<{
      cropPluginId: string;
      displayName: string;
      cropFamily: string;
      plantingOffsetDays: number;
      role: string;
    }>;
  };
  let advisor = $state<{
    blockId: string;
    primaryDateMs: number;
    suggestions: CompanionSuggestion[];
  } | null>(null);
  let advisorBusy = $state(false);

  async function addPlanting(blockId: string, cropPluginId: string, plantingDateIso: string | null) {
    plantingError = null;
    try {
      const plantingDateMs = plantingDateIso ? new Date(plantingDateIso).getTime() : null;
      const res = await fetch(`/api/blocks/${encodeURIComponent(blockId)}/plantings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cropPluginId,
          plantingDate: plantingDateMs
        })
      });
      const out = await res.json();
      if (!res.ok) {
        plantingError = out.error ?? `HTTP ${res.status}`;
        return;
      }
      await invalidateAll();
      if (plantingDateMs !== null) {
        const advice = await fetch(
          `/api/blocks/${encodeURIComponent(blockId)}/companions?cropPluginId=${encodeURIComponent(cropPluginId)}`
        );
        if (advice.ok) {
          const adviceData = await advice.json();
          if (adviceData.suggestions?.length > 0) {
            advisor = {
              blockId,
              primaryDateMs: plantingDateMs,
              suggestions: adviceData.suggestions
            };
          }
        }
      }
    } catch (e) {
      plantingError = e instanceof Error ? e.message : String(e);
    }
  }

  async function acceptCompanions(suggestion: CompanionSuggestion) {
    if (!advisor) return;
    advisorBusy = true;
    try {
      for (const m of suggestion.members) {
        const date = advisor.primaryDateMs + m.plantingOffsetDays * 24 * 60 * 60 * 1000;
        const res = await fetch(`/api/blocks/${encodeURIComponent(advisor.blockId)}/plantings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cropPluginId: m.cropPluginId, plantingDate: date })
        });
        if (!res.ok) {
          const out = await res.json();
          plantingError = out.error ?? `HTTP ${res.status}`;
          return;
        }
      }
      advisor = null;
      await invalidateAll();
    } finally {
      advisorBusy = false;
    }
  }

  function dismissAdvisor() {
    advisor = null;
  }

  // Equipment-binding tab removed from /plan. Equipment management lives at
  // /equipment (top nav). Per-crop equipment bindings are surfaced on the
  // crop detail page (/crops/[id]).

  // ─── Schedule tab — wizard state ───────────────────────────────────────
  type PlanningMode = 'plant-on-date' | 'harvest-by-date' | 'staggered' | 'season-fill';
  type WizardStep = 'crop' | 'block' | 'mode' | 'params' | 'preview' | 'committing' | 'done' | null;

  let wizardStep = $state<WizardStep>(null);
  let wCropId = $state('');
  let wBlockId = $state('');
  let wMode = $state<PlanningMode>('plant-on-date');
  let wPlantDate = $state('');
  let wHarvestDate = $state('');
  let wStaggerCount = $state(2);
  let wIntervalDays = $state(14);
  let wPhiMode = $state<'strict' | 'conservative'>('strict');
  let wBlockAssign = $state<'single' | 'round-robin'>('single');
  let wBusy = $state(false);
  let wCommitResults = $state<Array<{ blockId: string; plantMs: number; ok: boolean; error?: string }>>([]);

  function wMeta(): ScheduleCatalogItem | undefined {
    return data.scheduleCatalog?.find((c) => c.pluginId === wCropId);
  }

  function computeSuccessionDates(): Array<{ plantingDateMs: number; targetHarvestMs: number }> {
    const meta = wMeta();
    if (!meta?.daysToMaturity) return [];
    const dtmAvg = Math.round((meta.daysToMaturity.min + meta.daysToMaturity.max) / 2);
    if (wMode === 'plant-on-date') {
      const p = wPlantDate ? new Date(wPlantDate).getTime() : 0;
      if (!p) return [];
      return [{ plantingDateMs: p, targetHarvestMs: p + dtmAvg * DAY_MS }];
    }
    if (wMode === 'harvest-by-date') {
      const h = wHarvestDate ? new Date(wHarvestDate).getTime() : 0;
      if (!h) return [];
      return [{ plantingDateMs: h - dtmAvg * DAY_MS, targetHarvestMs: h }];
    }
    if (wMode === 'staggered') {
      const base = wHarvestDate ? new Date(wHarvestDate).getTime() : 0;
      if (!base) return [];
      return Array.from({ length: wStaggerCount }, (_, i) => {
        const h = base + i * wIntervalDays * DAY_MS;
        return { plantingDateMs: h - dtmAvg * DAY_MS, targetHarvestMs: h };
      });
    }
    if (wMode === 'season-fill') {
      const rows: Array<{ plantingDateMs: number; targetHarvestMs: number }> = [];
      let p = FROST.lastSpringFrostMs;
      while (p + dtmAvg * DAY_MS <= FROST.firstFallFrostMs) {
        rows.push({ plantingDateMs: p, targetHarvestMs: p + dtmAvg * DAY_MS });
        p += dtmAvg * DAY_MS;
      }
      return rows;
    }
    return [];
  }

  const wPreviewRows = $derived.by(() => {
    if (wizardStep !== 'preview' && wizardStep !== 'committing') return [];
    const dates = computeSuccessionDates();
    const meta = wMeta();
    if (!meta || dates.length === 0) return [];
    const targetBlock = data.blocks.find((b) => b.id === wBlockId);
    if (!targetBlock) return [];

    return dates.map((d, i) => {
      const blockId =
        wBlockAssign === 'round-robin'
          ? (data.blocks[i % data.blocks.length]?.id ?? wBlockId)
          : wBlockId;
      const block = data.blocks.find((b) => b.id === blockId) ?? targetBlock;
      const synth = {
        id: `preview-${i}`,
        blockId,
        cropPluginId: wCropId,
        varietyDisplayName: meta.displayName,
        plantingDate: d.plantingDateMs
      };
      // Engine is pure TS with no server deps — safe to call in the browser
      const engineEvents = eventsForPlanting(synth, meta as Parameters<typeof eventsForPlanting>[1], {});
      const prepActivities = prepTasksForPlanting(d.plantingDateMs, block.tillageMethod, blockId);
      const phiDays = (meta.preHarvestIntervalDays ?? 0) + (wPhiMode === 'conservative' ? 7 : 0);
      const phiConflict = phiDays > 0 && detectPhiConflict(engineEvents, phiDays);
      const soilTooEarly =
        meta.soilTempMinF !== undefined && d.plantingDateMs < FROST.lastSpringFrostMs + 14 * DAY_MS;
      return { ...d, blockId, block, engineEvents, prepActivities, phiConflict, soilTooEarly };
    });
  });

  async function commitPlan() {
    wBusy = true;
    wizardStep = 'committing';
    wCommitResults = [];
    for (const row of wPreviewRows) {
      try {
        const res = await fetch(`/api/blocks/${encodeURIComponent(row.blockId)}/plantings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cropPluginId: wCropId, plantingDate: row.plantingDateMs })
        });
        const out = await res.json();
        wCommitResults = [
          ...wCommitResults,
          {
            blockId: row.blockId,
            plantMs: row.plantingDateMs,
            ok: res.ok,
            error: res.ok ? undefined : (out.error ?? `HTTP ${res.status}`)
          }
        ];
      } catch (e) {
        wCommitResults = [
          ...wCommitResults,
          {
            blockId: row.blockId,
            plantMs: row.plantingDateMs,
            ok: false,
            error: e instanceof Error ? e.message : String(e)
          }
        ];
      }
    }
    wBusy = false;
    wizardStep = 'done';
    await invalidateAll();
  }

  function resetWizard() {
    wizardStep = null;
    wCropId = '';
    wBlockId = '';
    wMode = 'plant-on-date';
    wPlantDate = '';
    wHarvestDate = '';
    wStaggerCount = 2;
    wIntervalDays = 14;
    wPhiMode = 'strict';
    wBlockAssign = 'single';
    wCommitResults = [];
  }

  // ─── Phase 14 swim-lane state ──────────────────────────────────────────
  type SwimDragPayload =
    | { kind: 'palette'; pluginId: string; cropFamily: string }
    | { kind: 'move'; cropId: string; sourceBlockId: string };

  let swimDragPayload = $state<SwimDragPayload | null>(null);
  let swimKbCarry = $state<SwimDragPayload | null>(null);
  let aiSpendBanner = $state<null | { warn: boolean; spent: number; cap: number }>(null);

  // Phase 14a — seed-to-block auto-assign workspace state.
  type PendingSeed = {
    stockItemId: string;
    cropPluginId: string;
    varietyDisplayName: string;
    quantityValue: number;
    quantityUnit: string;
    quantityPlants: number;
  };
  type PlanAssignment = {
    stockItemId: string;
    cropPluginId: string;
    varietyDisplayName: string;
    blockId: string;
    plants: number;
    score: number;
  };
  type PlanPreview = {
    assignments: PlanAssignment[];
    unplaced: Array<{ stockItemId: string; cropPluginId: string; varietyDisplayName: string }>;
    diagnostics: Array<{ stockItemId: string; cropPluginId: string; reason: string }>;
  };

  let activeSeedModal = $state<null | { stockItemId: string }>(null);
  let pendingSeeds = $state<PendingSeed[]>([]);
  let currentPlan = $state<PlanPreview | null>(null);
  let planning = $state(false);
  let committing = $state(false);
  let showAllocationWizard = $state(false);
  // Phase 21a polish — when the Overview tab shows an existing Season
  // Setup chip, this toggles back to the inline form so the operator can
  // edit in place (no navigation to /settings/season).
  let editingSeason = $state(false);
  function handleSeasonSaved(setup: SeasonSetup) {
    editingSeason = false;
    void setup;
    // Re-fetch the loader so the chip + downstream tabs see the new state.
    invalidateAll();
  }
  // Phase 15 — planting-group wizard + inspector state.
  let showGroupWizard = $state(false);
  /** Phase 21b follow-up — Optimize Schedule sidebar (right rail).
   *  Replaces the previous "Auto Schedule / Optimize" modal as the
   *  primary AI-driven schedule refinement surface. The group wizard
   *  state is kept around because companion-group suggestion is still
   *  useful, but it's no longer the default entry point. */
  let showOptimizerSidebar = $state(false);
  let optimizerApplyBusy = $state(false);
  let openGroupId = $state<string | null>(null);

  // Phase 15d — swim-lane selection lives at the parent so the schedule
  // header card can render the action row inline.
  let swimSelection = $state<Set<string>>(new Set());

  // Phase 15d — Schedule field/block filter. Persists in localStorage so
  // navigating away + back keeps the operator's scope. `selectedFieldId =
  // null` means "all fields"; an empty selectedBlockIds Set means "all
  // blocks within the field scope".
  type ScheduleFilter = { fieldId: string | null; blockIds: string[] };
  const FILTER_LS_KEY = 'cropcard:schedule-filter:v1';
  let selectedFieldId = $state<string | null>(null);
  let selectedBlockIds = $state<Set<string>>(new Set());
  let filterLoaded = $state(false);

  $effect(() => {
    if (filterLoaded || typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(FILTER_LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ScheduleFilter;
        selectedFieldId = typeof parsed.fieldId === 'string' ? parsed.fieldId : null;
        selectedBlockIds = new Set(Array.isArray(parsed.blockIds) ? parsed.blockIds : []);
      }
    } catch {
      // bad JSON; fall through with defaults
    }
    filterLoaded = true;
  });

  function persistFilter() {
    if (typeof window === 'undefined') return;
    const payload: ScheduleFilter = {
      fieldId: selectedFieldId,
      blockIds: [...selectedBlockIds]
    };
    try {
      window.localStorage.setItem(FILTER_LS_KEY, JSON.stringify(payload));
    } catch {
      // quota / private mode — ignore
    }
  }

  /** Block ids that pass the filter — what the swim-lane renders and what
   *  the auto-ops operate on. Empty selectedBlockIds Set within a field
   *  scope means "all blocks in that field". */
  const visibleBlockIds = $derived.by(() => {
    const allBlocks = data.swimBlocks ?? [];
    let pool = allBlocks;
    if (selectedFieldId) {
      // Look up which blocks belong to the selected field via data.blocks
      // (same id space; data.blocks carries fieldId).
      const fieldBlockIds = new Set(
        (data.blocks ?? []).filter((b) => b.fieldId === selectedFieldId).map((b) => b.id)
      );
      pool = pool.filter((b) => fieldBlockIds.has(b.id));
    }
    if (selectedBlockIds.size === 0) {
      return new Set(pool.map((b) => b.id));
    }
    // Intersect explicit selection with the field pool so stale ids from
    // other fields don't leak in.
    const poolIds = new Set(pool.map((b) => b.id));
    return new Set([...selectedBlockIds].filter((id) => poolIds.has(id)));
  });

  const filteredSwimBlocks = $derived(
    (data.swimBlocks ?? []).filter((b) => visibleBlockIds.has(b.id))
  );
  const filteredSwimPlantings = $derived(
    (data.swimPlantings ?? []).filter((p) => visibleBlockIds.has(p.blockId))
  );
  const filteredUnscheduled = $derived(
    (data.unscheduled ?? []).filter((u) => visibleBlockIds.has(u.blockId))
  );

  function toggleField(fieldId: string | null) {
    selectedFieldId = fieldId;
    selectedBlockIds = new Set(); // reset block multi-select when field changes
    persistFilter();
  }

  function toggleBlock(blockId: string) {
    const next = new Set(selectedBlockIds);
    if (next.has(blockId)) next.delete(blockId);
    else next.add(blockId);
    selectedBlockIds = next;
    persistFilter();
  }

  function clearBlockSelection() {
    selectedBlockIds = new Set();
    persistFilter();
  }

  /** Blocks shown as chips under the field row — scoped to selectedFieldId
   *  when set, otherwise all blocks. */
  const filterableBlocks = $derived.by(() => {
    const all = data.swimBlocks ?? [];
    if (!selectedFieldId) return all;
    const fieldBlockIds = new Set(
      (data.blocks ?? []).filter((b) => b.fieldId === selectedFieldId).map((b) => b.id)
    );
    return all.filter((b) => fieldBlockIds.has(b.id));
  });

  function toggleSwimSelect(cropId: string, additive: boolean) {
    const next = new Set(swimSelection);
    if (additive) {
      if (next.has(cropId)) next.delete(cropId);
      else next.add(cropId);
    } else {
      if (next.has(cropId) && next.size === 1) next.clear();
      else {
        next.clear();
        next.add(cropId);
      }
    }
    swimSelection = next;
  }

  function clearSwimSelection() {
    if (swimSelection.size > 0) swimSelection = new Set();
  }

  // Phase 15d — deterministic auto-schedule. Hits the engine-only endpoint
  // and refreshes; no Claude call, no approve cards.
  let autoScheduleBusy = $state(false);
  let clearBusy = $state(false);
  /** Guards the page-load auto-schedule effect so it fires at most once
   *  per session-load of the schedule tab. resetSchedule manually flips it
   *  back to true after its own auto-run so the effect doesn't double-fire. */
  let autoRanForLoad = $state(false);

  async function resetSchedule() {
    if (clearBusy || autoScheduleBusy) return;
    const visibleIds = [...visibleBlockIds];
    const isFiltered = visibleIds.length !== (data.swimBlocks?.length ?? 0);
    const scopeNote = isFiltered
      ? `Only the ${visibleIds.length} visible block${visibleIds.length === 1 ? '' : 's'} will be reset; hidden blocks stay as-is. `
      : '';
    const ok = confirm(
      `Reset the schedule? ${scopeNote}` +
        'This unschedules every crop on visible blocks (back to drafts), disbands their groups, ' +
        'removes materialized tasks (till / fert / scout / etc.), and then immediately re-runs the ' +
        'deterministic auto-schedule so every draft lands on its earliest soil-temp + frost-safe date. ' +
        'Harvested / archived crops are untouched. This cannot be undone.'
    );
    if (!ok) return;
    clearBusy = true;
    try {
      const r = await fetch('/api/plan/schedule/clear', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blockIds: visibleIds })
      });
      const j = await r.json();
      if (!r.ok) {
        alert(j.error ?? `reset failed (${r.status})`);
        return;
      }
      await invalidateAll();
    } finally {
      clearBusy = false;
    }
    autoRanForLoad = true;
    await autoScheduleDrafts();
  }
  /** Auto-run the deterministic auto-schedule when the operator lands on
   *  the schedule tab with drafts attached but nothing scheduled yet —
   *  most natural path is "I just bound seeds to blocks on Crops, now show
   *  me a placement". Silent (no alert on success), one-shot per load. */
  let autoRanQuiet = $state(false);
  async function autoRunDeterministic() {
    if (autoScheduleBusy) return;
    autoScheduleBusy = true;
    autoRanQuiet = true;
    try {
      const r = await fetch('/api/plan/groups/auto-schedule', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blockIds: [...visibleBlockIds] })
      });
      if (r.ok) await invalidateAll();
      // Silent: no alert. If the engine couldn't place every draft, the
      // unscheduled count remains visible on the next render.
    } finally {
      autoScheduleBusy = false;
      // Fade the banner after a short delay so the operator sees it.
      setTimeout(() => { autoRanQuiet = false; }, 4000);
    }
  }

  $effect(() => {
    if (data.tab !== 'schedule') return;
    if (!data.canEdit) return;
    if (!filterLoaded) return; // wait for localStorage filter restore
    if (autoRanForLoad) return;
    if (autoScheduleBusy || clearBusy) return;
    const unscheduledCount = filteredUnscheduled.length;
    const scheduledCount = filteredSwimPlantings.length;
    if (unscheduledCount > 0 && scheduledCount === 0) {
      autoRanForLoad = true;
      void autoRunDeterministic();
    }
  });

  async function autoScheduleDrafts() {
    if (autoScheduleBusy) return;
    autoScheduleBusy = true;
    try {
      const r = await fetch('/api/plan/groups/auto-schedule', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blockIds: [...visibleBlockIds] })
      });
      const j = await r.json();
      if (!r.ok) {
        alert(j.error ?? `auto-schedule failed (${r.status})`);
        return;
      }
      const summary = `Auto-scheduled ${j.committed.groups} group${j.committed.groups === 1 ? '' : 's'} + ${j.committed.singletons} singleton${j.committed.singletons === 1 ? '' : 's'}.`;
      const failures: string[] = j.failures ?? [];
      const unscheduled: { reason: string }[] = j.unscheduled ?? [];
      if (failures.length > 0 || unscheduled.length > 0) {
        const parts = [summary];
        if (unscheduled.length > 0) parts.push(`${unscheduled.length} draft${unscheduled.length === 1 ? '' : 's'} not placed (no viable window).`);
        if (failures.length > 0) parts.push('Failures:\n' + failures.join('\n'));
        alert(parts.join('\n'));
      }
      await invalidateAll();
    } finally {
      autoScheduleBusy = false;
    }
  }

  /** Selection is groupable iff ≥2 plantings on the same block. Returns
   *  null when not groupable (single, or selection spans multiple blocks). */
  const groupableSwimSelection = $derived.by(() => {
    if (swimSelection.size < 2) return null;
    const ids = [...swimSelection];
    const ps = ids
      .map((id) => data.swimPlantings?.find((p) => p.cropId === id))
      .filter((p): p is NonNullable<typeof p> => !!p);
    if (ps.length !== ids.length) return null;
    const blockId = ps[0].blockId;
    if (ps.some((p) => p.blockId !== blockId)) return null;
    const families = new Set(ps.map((p) => p.cropFamily));
    const isThreeSisters =
      ps.length === 3 && families.has('corn') && families.has('legume') && families.has('cucurbit');
    return {
      blockId,
      cropIds: ids,
      hint: (isThreeSisters ? 'three-sisters' : 'manual') as 'three-sisters' | 'manual'
    };
  });

  function commitSelectionGroup() {
    const sel = groupableSwimSelection;
    if (!sel) return;
    handleManualGroup(sel.blockId, sel.cropIds, sel.hint);
    clearSwimSelection();
  }

  function commitSelectionEdit() {
    if (swimSelection.size !== 1) return;
    const cropId = [...swimSelection][0];
    openEditCrop(cropId);
  }

  /** Phase 21b follow-up — open the split-count popup for the
   *  single-selected bar. Separate from the edit modal so the
   *  operator can split without traversing the full edit form. */
  function commitSelectionSplit() {
    if (swimSelection.size !== 1) return;
    const cropId = [...swimSelection][0];
    splitTargetCropId = cropId;
    splitCount = 2;
    splitError = null;
  }

  function commitSelectionDelete() {
    if (swimSelection.size === 0) return;
    openDeleteCrops([...swimSelection]);
    clearSwimSelection();
  }

  // Phase 15c — edit + delete modals for swim-lane bars.
  let editCropId = $state<string | null>(null);
  let editForm = $state<{
    varietyDisplayName: string;
    shortName: string;
    shortNameOriginal: string;
    stockItemId: string | null;
    plantingDate: string;
    plantingDateOriginal: string;
    quantityPlanted: string;
    quantityUnit: string;
    /** Phase 21b follow-up — operator's chosen harvest use cases.
     *  Set inside openEditCrop from the planting's current filter
     *  (defaults to every option when no filter is set). */
    harvestUseCases: string[];
    harvestUseCasesOriginal: string[];
    availableHarvestUseCases: string[];
  }>({
    varietyDisplayName: '',
    shortName: '',
    shortNameOriginal: '',
    stockItemId: null,
    plantingDate: '',
    plantingDateOriginal: '',
    quantityPlanted: '',
    quantityUnit: '',
    harvestUseCases: [],
    harvestUseCasesOriginal: [],
    availableHarvestUseCases: []
  });
  let editBusy = $state(false);
  let editError = $state<string | null>(null);
  // Phase 21b follow-up — split-into-N popup state. Now a separate
  // modal triggered from the selection action bar (Split… button next
  // to Edit), so the operator can split without traversing the full
  // edit form. splitBusy guards against double-submit; on success the
  // popup closes and invalidateAll() refetches so the stacked bars
  // become visible on the swim-lane.
  let splitTargetCropId = $state<string | null>(null);
  let splitCount = $state(2);
  let splitBusy = $state(false);
  let splitError = $state<string | null>(null);
  let deleteCropIds = $state<string[]>([]);
  let deleteBusy = $state(false);

  function msToDateInput(ms: number | null | undefined): string {
    if (ms == null) return '';
    return new Date(ms).toISOString().slice(0, 10);
  }

  function openEditCrop(cropId: string) {
    const planting = data.swimPlantings?.find((p) => p.cropId === cropId);
    if (!planting) return;
    const dateStr = msToDateInput(planting.plantingDateMs);
    const sn = planting.shortName ?? '';
    editCropId = cropId;
    // Phase 21b follow-up — surface the operator's saved harvest-use-case
    // filter (default to every option the plugin offers) so the modal can
    // pre-check the right boxes.
    const available = planting.availableHarvestUseCases ?? [];
    const saved = planting.harvestUseCases ?? null;
    const currentSelection = saved && saved.length > 0 ? saved.slice() : available.slice();
    editForm = {
      varietyDisplayName: planting.varietyDisplayName,
      shortName: sn,
      shortNameOriginal: sn,
      stockItemId: planting.stockItemId ?? null,
      plantingDate: dateStr,
      plantingDateOriginal: dateStr,
      // Pre-fill quantity + unit from the planting so the operator
      // can see and tweak the current numbers. Unit is rendered
      // read-only in the template — the unit is set at planting time
      // by addPlanting() and shouldn't be retyped here.
      quantityPlanted:
        planting.quantityPlanted != null ? String(planting.quantityPlanted) : '',
      quantityUnit: planting.quantityUnit ?? '',
      harvestUseCases: currentSelection,
      harvestUseCasesOriginal: currentSelection.slice(),
      availableHarvestUseCases: available
    };
    editError = null;
  }

  async function commitEdit() {
    if (!editCropId) return;
    editBusy = true;
    editError = null;
    try {
      // Step 1 — set-schedule if the operator changed the start date. Goes
      // through the same path as drag-to-move so reanchorPluginPrePost runs
      // and dependent tasks shift.
      if (editForm.plantingDate && editForm.plantingDate !== editForm.plantingDateOriginal) {
        const newMs = new Date(editForm.plantingDate).getTime();
        if (!Number.isFinite(newMs)) {
          editError = 'Planting date is invalid';
          editBusy = false;
          return;
        }
        const planting = data.swimPlantings?.find((p) => p.cropId === editCropId);
        const snapped = planting?.cropPluginId
          ? snapPlantingDate(planting.cropPluginId, newMs)
          : newMs;
        const r = await fetch(`/api/crops/${encodeURIComponent(editCropId)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'set-schedule', plantingDate: snapped })
        });
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          editError = e.error ?? `date update failed (${r.status})`;
          return;
        }
      }

      // Step 2 — edit-details for variety + quantity, only if any of those
      // fields was actually filled in.
      const detailsBody: Record<string, unknown> = { action: 'edit-details' };
      let hasDetails = false;
      const newName = editForm.varietyDisplayName.trim();
      const planting = data.swimPlantings?.find((p) => p.cropId === editCropId);
      if (newName && newName !== planting?.varietyDisplayName) {
        detailsBody.varietyDisplayName = newName;
        hasDetails = true;
      }
      if (editForm.quantityPlanted.trim()) {
        const n = Number(editForm.quantityPlanted);
        if (!Number.isFinite(n) || n < 0) {
          editError = 'Quantity must be a non-negative number';
          editBusy = false;
          return;
        }
        // Only send when the value actually changed from the
        // pre-populated original (avoids no-op PATCHes).
        const original = planting?.quantityPlanted;
        if (original == null || Math.abs(original - n) > 1e-6) {
          detailsBody.quantityPlanted = n;
          hasDetails = true;
        }
      }
      // Unit is rendered read-only in the modal now (the value is set at
      // planting time and locked here); never sent in the PATCH.
      // Phase 21b follow-up — harvest use case filter. Only PATCH when
      // the selection changed from what was saved. Sending an empty
      // array would persist as "show nothing" (semantically valid but
      // never useful); we send null to clear when the operator's
      // selection covers every available option.
      const origUses = [...editForm.harvestUseCasesOriginal].sort();
      const newUses = [...editForm.harvestUseCases].sort();
      const usesChanged =
        origUses.length !== newUses.length ||
        origUses.some((u, i) => u !== newUses[i]);
      if (usesChanged) {
        // "Every option selected" → null (means: show all, no filter).
        const allSelected =
          newUses.length > 0 &&
          newUses.length === editForm.availableHarvestUseCases.length;
        detailsBody.harvestUseCases = allSelected ? null : newUses;
        hasDetails = true;
      }
      if (hasDetails) {
        const r = await fetch(`/api/crops/${encodeURIComponent(editCropId)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(detailsBody)
        });
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          editError = e.error ?? `details update failed (${r.status})`;
          return;
        }
      }

      // Step 3 — short name (lives on the matching stock item, not the crop).
      // Only fires when the operator actually changed it AND we have a
      // stockItemId to PATCH against. Empty string clears the override.
      const newShort = editForm.shortName.trim();
      if (newShort !== editForm.shortNameOriginal && editForm.stockItemId) {
        const r = await fetch(`/api/stock/${encodeURIComponent(editForm.stockItemId)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ shortName: newShort || null })
        });
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          editError = e.error ?? `short-name update failed (${r.status})`;
          return;
        }
      }

      editCropId = null;
      await invalidateAll();
    } finally {
      editBusy = false;
    }
  }

  /** Phase 21b follow-up — split the popup's target crop into N
   *  copies on the same block + date. Hits PATCH /api/crops/[id]
   *  with action='split'; on success closes the popup so the operator
   *  sees the N stacked bars and can drag each to its target date. */
  async function commitSplit() {
    if (!splitTargetCropId) return;
    splitError = null;
    if (!Number.isInteger(splitCount) || splitCount < 2 || splitCount > 12) {
      splitError = 'Parts must be an integer between 2 and 12.';
      return;
    }
    splitBusy = true;
    try {
      const r = await fetch(`/api/crops/${encodeURIComponent(splitTargetCropId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'split', parts: splitCount })
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        splitError = e.error ?? `split failed (${r.status})`;
        return;
      }
      splitTargetCropId = null;
      splitCount = 2;
      clearSwimSelection();
      await invalidateAll();
    } finally {
      splitBusy = false;
    }
  }

  /** Phase 21b follow-up — write each proposed-schedule row from the
   *  optimizer sidebar to the DB. Reuses the existing per-row
   *  set-schedule PATCH so the kernel snap + drift-policy code path
   *  is identical to drag-and-drop. The sidebar diff badge already
   *  warned the operator how many rows differ, so we don't double-
   *  confirm here. */
  async function applyOptimizerProposal(
    rows: Array<{
      stockItemId: string;
      blockId: string;
      cropPluginId: string;
      plantingDateMs: number;
    }>
  ): Promise<void> {
    optimizerApplyBusy = true;
    try {
      // Map (stockItemId, blockId) → cropId via the current
      // swimPlantings. Rows that don't match a known planting are
      // skipped (the AI sometimes proposes a slot for an assignment
      // that's already been removed from the swim-lane).
      const cropIdLookup = new Map<string, string>();
      for (const p of data.swimPlantings ?? []) {
        const key = `${p.stockItemId ?? p.cropId}:${p.blockId}`;
        cropIdLookup.set(key, p.cropId);
      }
      const failures: string[] = [];
      for (const r of rows) {
        const cropId = cropIdLookup.get(`${r.stockItemId}:${r.blockId}`);
        if (!cropId) continue;
        const res = await fetch(`/api/crops/${encodeURIComponent(cropId)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'set-schedule',
            plantingDate: r.plantingDateMs,
            blockId: r.blockId
          })
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          failures.push(e.error ?? `HTTP ${res.status}`);
        }
      }
      if (failures.length > 0) {
        throw new Error(
          `${failures.length} row${failures.length === 1 ? '' : 's'} failed to apply: ${failures.slice(0, 3).join('; ')}`
        );
      }
      await invalidateAll();
    } finally {
      optimizerApplyBusy = false;
    }
  }

  function openDeleteCrops(cropIds: string[]) {
    deleteCropIds = cropIds;
  }

  /** Phase 15d — un-schedule from the Schedule tab does NOT delete the crop
   *  record. It just nulls plantingDate, disbands any group binding, and
   *  cascade-deletes materialized tasks. The crop stays attached to its
   *  block as a draft so auto-schedule / wizard / drag can re-place it.
   *  Permanent deletion lives on the Crops tab. */
  async function commitDelete() {
    if (deleteCropIds.length === 0) return;
    deleteBusy = true;
    const failures: string[] = [];
    for (const id of deleteCropIds) {
      try {
        const r = await fetch(`/api/crops/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'unschedule' })
        });
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          failures.push(`${id}: ${e.error ?? r.statusText}`);
        }
      } catch (err) {
        failures.push(`${id}: ${err instanceof Error ? err.message : 'unschedule failed'}`);
      }
    }
    deleteBusy = false;
    deleteCropIds = [];
    if (failures.length > 0) {
      alert(`Some un-schedule operations failed:\n${failures.join('\n')}`);
    }
    await invalidateAll();
  }

  type GroupInspectorData = {
    groupId: string;
    systemKind: 'three-sisters' | 'succession' | 'manual';
    members: Array<{
      cropId: string;
      cropPluginId: string;
      varietyDisplayName: string;
      cropFamily: string;
      plantingDateMs: number | null;
      role: 'anchor' | 'companion';
      offsetDays?: number;
    }>;
    tasks: Array<{
      id: string;
      title: string;
      cropId: string | null;
      scheduledForMs: number;
      completedAtMs?: number;
      pluginTemplateKey?: string;
      isCompanionCheck?: boolean;
      staleAnchor?: boolean;
    }>;
  };
  let groupInspectorData = $state<GroupInspectorData | null>(null);

  async function fetchGroupForInspector(groupId: string): Promise<void> {
    const r = await fetch(`/api/plantings/groups/${encodeURIComponent(groupId)}`);
    if (!r.ok) {
      groupInspectorData = null;
      openGroupId = null;
      return;
    }
    const j = await r.json();
    const memberCrops: GroupInspectorData['members'] = (j.members ?? []).map((c: {
      id: string;
      cropPluginId: string;
      varietyDisplayName: string;
      plantingDate: number | null;
      groupRole?: 'anchor' | 'companion';
      groupOffsetDays?: number;
    }) => {
      const planting = data.swimPlantings?.find((p) => p.cropId === c.id);
      return {
        cropId: c.id,
        cropPluginId: c.cropPluginId,
        varietyDisplayName: c.varietyDisplayName,
        cropFamily: planting?.cropFamily ?? '',
        plantingDateMs: c.plantingDate,
        role: c.groupRole ?? 'companion',
        offsetDays: c.groupOffsetDays
      };
    });
    const memberCropIds = new Set(memberCrops.map((m) => m.cropId));
    const groupTasks = (data.taskPips ?? [])
      .filter((p) => p.cropId && memberCropIds.has(p.cropId))
      .map((p, i) => ({
        id: `${p.cropId}:${p.scheduledForMs}:${i}`,
        title: p.title,
        cropId: p.cropId,
        scheduledForMs: p.scheduledForMs,
        isCompanionCheck: p.category === 'companion-check',
        staleAnchor: !!p.stale
      }));
    groupInspectorData = {
      groupId,
      systemKind: (memberCrops[0] && data.swimPlantings?.find((p) => p.cropId === memberCrops[0].cropId)?.groupSystemKind) ?? 'manual',
      members: memberCrops,
      tasks: groupTasks
    };
  }

  async function handleNudgeCompanion(cropId: string, deltaDays: number) {
    if (!openGroupId || deltaDays === 0) return;
    const r = await fetch(`/api/plantings/groups/${encodeURIComponent(openGroupId)}/nudge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ companionCropId: cropId, deltaDays })
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      alert(`Nudge failed: ${e.error ?? r.statusText}`);
      return;
    }
    await invalidateAll();
    await fetchGroupForInspector(openGroupId);
  }

  async function handleDisbandGroup() {
    if (!openGroupId) return;
    const r = await fetch(`/api/plantings/groups/${encodeURIComponent(openGroupId)}`, {
      method: 'DELETE'
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      alert(`Disband failed: ${e.error ?? r.statusText}`);
      return;
    }
    openGroupId = null;
    groupInspectorData = null;
    await invalidateAll();
  }

  async function handleManualGroup(blockId: string, cropIds: string[], hint: 'three-sisters' | 'manual') {
    // Multi-select on the swim-lane → open inspector after server commits.
    // For v1 we route through the wizard's commit endpoint with an anchor
    // chosen by the operator; the simplest UX is to pre-fill the wizard.
    void blockId;
    void cropIds;
    void hint;
    // Manual grouping happens via the wizard for now — open it pre-seeded.
    showGroupWizard = true;
  }

  const seedStockData = $derived((data.seedStock ?? []) as Array<{
    stockItemId: string;
    cropPluginId: string | null;
    displayName: string;
    shortName?: string;
    onHand: number;
    defaultUnit: string;
    cropFamily: string | null;
  }>);

  const seedStockById = $derived(
    new Map(seedStockData.map((s) => [s.stockItemId, s]))
  );

  const pluginById = $derived(
    new Map((data.cropCatalog ?? []).map((c) => [c.pluginId, c]))
  );

  const blockNameById = $derived(
    new Map(((data.swimBlocks ?? data.blocks ?? []) as Array<{ id: string; name: string; blockLabel?: string | null }>).map((b) => [
      b.id,
      b.blockLabel ? `${b.name} (${b.blockLabel})` : b.name
    ]))
  );

  const FAMILY_ICON: Record<string, string> = {
    allium: '🧅', apiaceae: '🥕', bramble: '🫐', brassica: '🥦',
    'broadleaf-companion': '🌸', 'cereal-grain': '🌾', corn: '🌽',
    'cover-grass': '🌿', 'cover-legume': '🌿', cucurbit: '🎃',
    forage: '🌾', 'herb-culinary': '🌿', 'leafy-green': '🥬',
    legume: '🫘', orchard: '🍎', root: '🥕', 'small-fruit': '🍓',
    solanaceae: '🍅', 'stone-fruit': '🍑', 'vine-fruit': '🍇'
  };
  function familyIconFor(stockItemId: string): string {
    const s = seedStockById.get(stockItemId);
    const fam = s?.cropFamily ?? null;
    if (!fam) return '🌱';
    return FAMILY_ICON[fam] ?? '🌱';
  }

  /** Block-id → emoji string showing what's planted on the block. Used by
   *  the BlockMap on the Crops tab. Multiple distinct families on one block
   *  are concatenated (e.g. corn + legume + cucurbit → 🌽🫘🎃). */
  const blockBadges = $derived.by(() => {
    const out: Record<string, string> = {};
    for (const b of data.blocks) {
      const families = new Set<string>();
      for (const p of b.plantings) {
        const fam = pluginById.get(p.cropPluginId)?.cropFamily;
        if (fam) families.add(fam);
      }
      if (families.size === 0) continue;
      out[b.id] = [...families].map((f) => FAMILY_ICON[f] ?? '🌱').join('');
    }
    return out;
  });

  // ─── Crops-tab block reorder (within each field group) ────────────────
  let cropsTabOrder = $state<string[] | null>(null);
  let cropsReorderDragId = $state<string | null>(null);
  let cropsReorderOverId = $state<string | null>(null);
  let fieldDropOverId = $state<string | null>(null);

  // ─── Seed → Block drag state (Phase 14c, Crops tab manual mode) ───────
  type CropsSeedPayload = {
    stockItemId: string;
    cropPluginId: string;
    displayName: string;
    onHand: number;
    defaultUnit: string;
    cropFamily: string | null;
  };
  let cropsSeedDrag = $state<CropsSeedPayload | null>(null);
  let cropsSeedDropBlockId = $state<string | null>(null);
  /** Tracks which block-row is currently a seed drop target so we can render
   *  a different highlight from the reorder-drop highlight. */
  let cropsSeedHoverBlockId = $state<string | null>(null);
  /** Block id pending a manual planting — set when the modal opens via a
   *  seed-on-block drop, cleared on confirm/cancel. */
  let manualDropBlockId = $state<string | null>(null);

  // ─── Crop move drag (Phase 14d) — drag a crop-item onto a different
  //     block-row to reassign its blockId via PATCH /api/crops/:id, or onto
  //     the Seed Stock rail to delete the crop + restore the seed stock.
  let cropMoveDragId = $state<string | null>(null);
  let cropMoveOverBlockId = $state<string | null>(null);
  let cropMoveOverRail = $state(false);

  function onCropItemDragStart(ev: DragEvent, cropId: string) {
    cropMoveDragId = cropId;
    if (ev.dataTransfer) {
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('application/x-cropcard-crop-id', cropId);
      ev.dataTransfer.setData('text/plain', cropId);
    }
  }
  function onCropItemDragEnd() {
    cropMoveDragId = null;
    cropMoveOverBlockId = null;
    cropMoveOverRail = false;
  }

  function onRailDragOver(ev: DragEvent) {
    if (!cropMoveDragId) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    cropMoveOverRail = true;
  }
  function onRailDragLeave() {
    cropMoveOverRail = false;
  }
  async function onRailDrop(ev: DragEvent) {
    if (!cropMoveDragId) return;
    ev.preventDefault();
    const cropId = cropMoveDragId;
    cropMoveDragId = null;
    cropMoveOverRail = false;
    cropMoveOverBlockId = null;
    try {
      const r = await fetch(`/api/crops/${encodeURIComponent(cropId)}`, { method: 'DELETE' });
      if (r.ok) await invalidateAll();
      else {
        const j = await r.json().catch(() => ({}));
        plantingError = j?.error ?? `failed to remove crop (${r.status})`;
      }
    } catch (err) {
      plantingError = err instanceof Error ? err.message : 'network error';
    }
  }

  function onSeedRailDragStart(ev: DragEvent, seed: {
    stockItemId: string;
    cropPluginId: string | null;
    displayName: string;
    onHand: number;
    defaultUnit: string;
    cropFamily: string | null;
  }) {
    if (!seed.cropPluginId) {
      ev.preventDefault();
      return;
    }
    cropsSeedDrag = {
      stockItemId: seed.stockItemId,
      cropPluginId: seed.cropPluginId,
      displayName: seed.displayName,
      onHand: seed.onHand,
      defaultUnit: seed.defaultUnit,
      cropFamily: seed.cropFamily
    };
    if (ev.dataTransfer) {
      ev.dataTransfer.effectAllowed = 'copy';
      ev.dataTransfer.setData('application/x-cropcard-seed-id', seed.stockItemId);
      ev.dataTransfer.setData('text/plain', seed.displayName);
    }
  }
  function onSeedRailDragEnd() {
    cropsSeedDrag = null;
    cropsSeedHoverBlockId = null;
    cropsSeedDropBlockId = null;
  }

  $effect(() => {
    cropsTabOrder = loadBlockOrder();
  });

  function onCropsHeaderDragStart(ev: DragEvent, blockId: string) {
    cropsReorderDragId = blockId;
    if (ev.dataTransfer) {
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('application/x-cropcard-block-id', blockId);
      ev.dataTransfer.setData('text/plain', blockId);
    }
  }
  function onCropsHeaderDragOver(ev: DragEvent, blockId: string) {
    if (cropMoveDragId) {
      // Highlight only when the target is a *different* block from the crop's
      // current home — dropping on the same block is a no-op.
      const cropBlockId = data.blocks
        .flatMap((b) => b.plantings.map((p) => ({ pid: p.id, bid: b.id })))
        .find((x) => x.pid === cropMoveDragId)?.bid;
      if (cropBlockId === blockId) return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
      cropMoveOverBlockId = blockId;
      return;
    }
    if (cropsSeedDrag) {
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
      cropsSeedHoverBlockId = blockId;
      return;
    }
    if (!cropsReorderDragId) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    cropsReorderOverId = blockId;
  }
  function onCropsHeaderDragLeave(blockId: string) {
    if (cropsReorderOverId === blockId) cropsReorderOverId = null;
    if (cropsSeedHoverBlockId === blockId) cropsSeedHoverBlockId = null;
    if (cropMoveOverBlockId === blockId) cropMoveOverBlockId = null;
  }
  async function onCropsHeaderDrop(ev: DragEvent, targetId: string, currentIds: string[]) {
    // Crop move (Phase 14d). PATCH the crop's blockId to the target.
    if (cropMoveDragId) {
      ev.preventDefault();
      const cropId = cropMoveDragId;
      cropMoveDragId = null;
      cropMoveOverBlockId = null;
      const crop = data.blocks
        .flatMap((b) => b.plantings)
        .find((p) => p.id === cropId);
      if (!crop || crop.blockId === targetId) return;
      try {
        const r = await fetch(`/api/crops/${encodeURIComponent(cropId)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'set-schedule',
            plantingDate: crop.plantingDate,
            blockId: targetId
          })
        });
        if (r.ok) await invalidateAll();
        else {
          const j = await r.json().catch(() => ({}));
          plantingError = j?.error ?? `failed to move crop (${r.status})`;
        }
      } catch (err) {
        plantingError = err instanceof Error ? err.message : 'network error';
      }
      return;
    }

    // Manual seed → block drop (Phase 14c). Open the quantity modal with
    // this block pre-bound; the planting is created on confirm.
    if (cropsSeedDrag) {
      ev.preventDefault();
      const seed = cropsSeedDrag;
      cropsSeedDrag = null;
      cropsSeedHoverBlockId = null;
      manualDropBlockId = targetId;
      activeSeedModal = { stockItemId: seed.stockItemId };
      return;
    }
    if (!cropsReorderDragId) return;
    ev.preventDefault();
    const sourceId = cropsReorderDragId;
    cropsReorderDragId = null;
    cropsReorderOverId = null;
    if (sourceId === targetId) return;

    const sourceBlock = data.blocks.find((b) => b.id === sourceId);
    const targetBlock = data.blocks.find((b) => b.id === targetId);
    if (!sourceBlock || !targetBlock) return;

    const isCrossField = sourceBlock.fieldId !== targetBlock.fieldId;

    if (isCrossField && targetBlock.fieldId) {
      // Cross-field move: PATCH the block's fieldId, then invalidate so the
      // page reflects the new parent. Update the saved order first so the
      // block lands at the target's position in the destination field.
      const baseOrder = cropsTabOrder ?? data.blocks.map((b) => b.id);
      const filtered = baseOrder.filter((id) => id !== sourceId);
      const targetIdx = filtered.indexOf(targetId);
      const newOrder =
        targetIdx === -1
          ? [...filtered, sourceId]
          : [...filtered.slice(0, targetIdx), sourceId, ...filtered.slice(targetIdx)];
      cropsTabOrder = newOrder;
      saveBlockOrder(newOrder);

      try {
        const r = await fetch(`/api/blocks/${encodeURIComponent(sourceId)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ fieldId: targetBlock.fieldId })
        });
        if (r.ok) await invalidateAll();
      } catch {
        // network error — order is still saved locally; user can retry
      }
      return;
    }

    // Intra-field reorder (cosmetic only).
    const next = reorderOnDrop(currentIds, sourceId, targetId);
    if (!next) return;
    const merged = mergeFieldOrder(cropsTabOrder, currentIds, next);
    cropsTabOrder = merged;
    saveBlockOrder(merged);
  }
  function onCropsHeaderDragEnd() {
    cropsReorderDragId = null;
    cropsReorderOverId = null;
    fieldDropOverId = null;
  }

  function onFieldRowDragOver(ev: DragEvent, fieldId: string) {
    if (!cropsReorderDragId) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    fieldDropOverId = fieldId;
  }
  function onFieldRowDragLeave(fieldId: string) {
    if (fieldDropOverId === fieldId) fieldDropOverId = null;
  }
  async function onFieldRowDrop(ev: DragEvent, fieldId: string) {
    if (!cropsReorderDragId) return;
    ev.preventDefault();
    const sourceId = cropsReorderDragId;
    cropsReorderDragId = null;
    cropsReorderOverId = null;
    fieldDropOverId = null;

    const sourceBlock = data.blocks.find((b) => b.id === sourceId);
    if (!sourceBlock) return;
    if (sourceBlock.fieldId === fieldId) return; // same field — no-op

    // Reposition source at end of saved order so it lands at the bottom of
    // the destination field group after refresh.
    const baseOrder = cropsTabOrder ?? data.blocks.map((b) => b.id);
    const filtered = baseOrder.filter((id) => id !== sourceId);
    const newOrder = [...filtered, sourceId];
    cropsTabOrder = newOrder;
    saveBlockOrder(newOrder);

    try {
      const r = await fetch(`/api/blocks/${encodeURIComponent(sourceId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fieldId })
      });
      if (r.ok) await invalidateAll();
    } catch {
      // network error — order is still saved locally; user can retry
    }
  }

  /** Replace the slots occupied by `oldGroupIds` (in saved order) with the
   *  reordered `newGroupIds`, preserving every other id's absolute slot. */
  function mergeFieldOrder(
    saved: string[] | null,
    oldGroupIds: string[],
    newGroupIds: string[]
  ): string[] {
    const groupSet = new Set(oldGroupIds);
    const base = saved ?? [];
    // Indices in `base` that belong to this field group; non-group ids keep
    // their original positions in the output.
    const out: string[] = [];
    let cursor = 0;
    for (const id of base) {
      if (groupSet.has(id)) {
        // Drop the next id from newGroupIds in this slot.
        if (cursor < newGroupIds.length) {
          out.push(newGroupIds[cursor]);
          cursor++;
        }
        // If saved had more group ids than newGroupIds (shouldn't happen
        // for same-set reorder), the extra slots are just dropped.
      } else {
        out.push(id);
      }
    }
    // Append any group ids not yet placed (e.g., if saved didn't contain
    // them — the very first reorder for a brand-new block).
    for (; cursor < newGroupIds.length; cursor++) {
      if (!out.includes(newGroupIds[cursor])) out.push(newGroupIds[cursor]);
    }
    return out;
  }

  function openSeedModal(stockItemId: string) {
    activeSeedModal = { stockItemId };
  }

  async function confirmSeedQuantity(input: { quantity: number; unit: string; quantityPlants: number }) {
    if (!activeSeedModal) return;
    const stock = seedStockById.get(activeSeedModal.stockItemId);
    if (!stock || !stock.cropPluginId) {
      activeSeedModal = null;
      manualDropBlockId = null;
      return;
    }
    const cropPluginId = stock.cropPluginId;
    const varietyDisplayName = pluginById.get(cropPluginId)?.displayName ?? stock.displayName;

    // Manual seed → block flow (Phase 14c). Drop on a block pre-binds the
    // target id; on confirm, POST a single planted-status crop and refresh.
    if (manualDropBlockId) {
      const blockId = manualDropBlockId;
      manualDropBlockId = null;
      activeSeedModal = null;
      try {
        const r = await fetch(`/api/blocks/${encodeURIComponent(blockId)}/plantings`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            cropPluginId,
            varietyDisplayName,
            plantingDate: null,
            quantityPlanted: input.quantity,
            quantityUnit: input.unit,
            stockItemId: stock.stockItemId
          })
        });
        if (r.ok) await invalidateAll();
        else {
          const j = await r.json().catch(() => ({}));
          plantingError = j?.error ?? `failed to add planting (${r.status})`;
        }
      } catch (err) {
        plantingError = err instanceof Error ? err.message : 'network error';
      }
      return;
    }

    // AI-assisted preview-then-commit flow (kept for future AI mode).
    pendingSeeds = [
      ...pendingSeeds.filter((p) => p.stockItemId !== stock.stockItemId),
      {
        stockItemId: stock.stockItemId,
        cropPluginId,
        varietyDisplayName,
        quantityValue: input.quantity,
        quantityUnit: input.unit,
        quantityPlants: input.quantityPlants
      }
    ];
    activeSeedModal = null;
    await requestPlan();
  }

  async function requestPlan() {
    if (pendingSeeds.length === 0) {
      currentPlan = null;
      return;
    }
    planning = true;
    try {
      const r = await fetch('/api/crops/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          seeds: pendingSeeds.map((p) => ({
            stockItemId: p.stockItemId,
            cropPluginId: p.cropPluginId,
            varietyDisplayName: p.varietyDisplayName,
            quantityPlants: p.quantityPlants
          }))
        })
      });
      if (!r.ok) {
        currentPlan = null;
        return;
      }
      currentPlan = await r.json();
    } finally {
      planning = false;
    }
  }

  function removePendingSeed(stockItemId: string) {
    pendingSeeds = pendingSeeds.filter((p) => p.stockItemId !== stockItemId);
    void requestPlan();
  }

  async function commitSeedPlan() {
    if (pendingSeeds.length === 0) return;
    committing = true;
    try {
      const r = await fetch('/api/crops/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          seeds: pendingSeeds.map((p) => ({
            stockItemId: p.stockItemId,
            cropPluginId: p.cropPluginId,
            varietyDisplayName: p.varietyDisplayName,
            quantityPlants: p.quantityPlants,
            quantityValue: p.quantityValue,
            quantityUnit: p.quantityUnit
          }))
        })
      });
      if (r.ok) {
        pendingSeeds = [];
        currentPlan = null;
        await invalidateAll();
      }
    } finally {
      committing = false;
    }
  }

  const assignmentsByBlock = $derived.by(() => {
    const m = new Map<string, PlanAssignment[]>();
    for (const a of currentPlan?.assignments ?? []) {
      const list = m.get(a.blockId) ?? [];
      list.push(a);
      m.set(a.blockId, list);
    }
    return m;
  });

  function snapPlantingDate(pluginId: string, droppedMs: number): number {
    const sb = data.snapBoundaries;
    if (!sb) return droppedMs;
    const earliest = sb.soilTempEarliestByCrop?.[pluginId] ?? null;
    return Math.max(droppedMs, sb.lastSpringFrostMs ?? 0, earliest ?? 0);
  }

  async function handleSwimDrop(blockId: string, droppedMs: number, payload: SwimDragPayload) {
    if (payload.kind === 'palette') {
      const snapped = snapPlantingDate(payload.pluginId, droppedMs);
      const r = await fetch(`/api/blocks/${encodeURIComponent(blockId)}/plantings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cropPluginId: payload.pluginId,
          plantingDate: snapped
        })
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        alert(`Could not place crop: ${e.error ?? r.statusText}`);
        return;
      }
    } else if (payload.kind === 'move') {
      const planting = data.swimPlantings?.find((p) => p.cropId === payload.cropId);
      const pluginId = planting?.cropPluginId;
      const snapped = pluginId ? snapPlantingDate(pluginId, droppedMs) : droppedMs;
      const r = await fetch(`/api/crops/${encodeURIComponent(payload.cropId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'set-schedule',
          plantingDate: snapped,
          blockId
        })
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        alert(`Could not move planting: ${e.error ?? r.statusText}`);
        return;
      }
    }
    await invalidateAll();
  }

  // Build the palette card list from data.scheduleCatalog (server-side).
  const paletteCards = $derived(
    (data.scheduleCatalog ?? []).map((c) => ({
      pluginId: c.pluginId,
      displayName: c.displayName,
      cropFamily: c.cropFamily,
      dtmMin: c.daysToMaturity?.min,
      dtmMax: c.daysToMaturity?.max,
      shadeCasting: c.cropFamily === 'corn' || c.cropFamily === 'small-grain'
    }))
  );

  // ─── Layout tab — interactive map (Phase 13b) ──────────────────────────
  type Geom = { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };

  /** Save (or clear) geometry on an existing block. */
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

  /** Create a brand-new block with a polygon drawn on the map. */
  let blockMap = $state<{ currentDraftName: () => string; currentDraftFieldId: () => string } | null>(
    null
  );
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

  /** Save (or clear) a field's boundary polygon. */
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

  /** Create a new field with a boundary drawn on the map. */
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

  /** Create a shade source from the BlockMap draft. */
  async function createShadeSource(input: {
    name: string;
    kind: 'tree-row' | 'tree-grove' | 'tree-single' | 'hedge' | 'building' | 'fence' | 'structure' | 'other';
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
    const res = await fetch(`/api/shade-sources/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const out = await res.json().catch(() => ({}));
      alert(out.error ?? `HTTP ${res.status}`);
      return;
    }
    await invalidateAll();
  }

  /** Persist a moved/reshaped shade-source polygon or polyline. */
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

  // Advanced GeoJSON paste form (kept for power users / QGIS imports).
  let pasteBlockId = $state(untrack(() => data.blocks[0]?.id ?? ''));
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
        if (!res.ok) { geomError = out.error ?? 'failed'; return; }
        geomMessage = 'Geometry saved.';
        pasteText = '';
        await invalidateAll();
        return;
      }

      // ── FeatureCollection mode ──────────────────────────────────────────
      if (parsed.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) {
        geomError = 'Expected a FeatureCollection with a features array.';
        return;
      }
      const results: typeof pasteResults = [];
      for (const feat of parsed.features as Array<{ type: string; geometry: unknown; properties: Record<string, string> | null }>) {
        const props = feat.properties ?? {};
        const kind = props['type'];
        const name = props['name'];
        if (!name) { results.push({ name: '(unnamed)', kind: kind ?? '?', status: 'skipped — no name' }); continue; }
        const geom = feat.geometry ?? feat;

        if (kind === 'field') {
          const field = data.fields.find((f) => f.name === name);
          if (!field) { results.push({ name, kind: 'field', status: 'not found' }); continue; }
          const res = await fetch(`/api/fields/${encodeURIComponent(field.id)}/geometry`, {
            method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(geom)
          });
          results.push({ name, kind: 'field', status: res.ok ? 'saved ✓' : `error ${res.status}` });

        } else if (kind === 'block') {
          const fieldName = props['field'];
          const block =
            data.blocks.find((b) => b.name === name && (!fieldName || data.fields.find((f) => f.id === b.fieldId)?.name === fieldName)) ??
            data.blocks.find((b) => b.name === name);
          if (!block) { results.push({ name, kind: 'block', status: 'not found' }); continue; }
          const res = await fetch(`/api/blocks/${encodeURIComponent(block.id)}/geometry`, {
            method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(geom)
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

  function fmt(ts?: number) {
    return ts ? new Date(ts).toLocaleDateString() : '—';
  }

  function fmtShort(ms: number): string {
    return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function dayNum(iso: string) {
    return parseInt(iso.slice(8, 10), 10);
  }

  function calendarFilterUrl(fieldId: string, blockId: string): string {
    const sp = new URLSearchParams($page.url.searchParams);
    sp.set('tab', 'calendar');
    if (fieldId) sp.set('fieldId', fieldId);
    else sp.delete('fieldId');
    if (blockId) sp.set('blockId', blockId);
    else sp.delete('blockId');
    return `/plan?${sp.toString()}`;
  }

  async function changeCalendarFilter(field: string, block: string) {
    await goto(calendarFilterUrl(field, block));
  }
</script>

<!--
  Page heading + lede are visually hidden — the active tab in the
  primary top nav (Phase 21b follow-up styling) carries the same
  information for sighted users. The h1 stays in the DOM so screen
  readers + the document outline still find "Plan" as the page
  heading.
-->
<h1 class="sr-only">Plan</h1>
<p class="sr-only">
  Step 0 of the season — set up your fields, blocks, crops, equipment, and stock so /today knows
  what to surface.
</p>

<nav class="plan-tabs" aria-label="Plan tabs">
  {#each TABS as t (t.id)}
    <a
      aria-current={data.tab === t.id ? 'page' : undefined}
      class:active={data.tab === t.id}
      href={tabHref(t.id)}
    >
      <span aria-hidden="true">{t.icon}</span>
      <span>{t.label}</span>
    </a>
  {/each}
  {#if data.tab === 'calendar'}
    <!-- Calendar view toggle lives in the secondary nav rather than as a
         banner above the content so flipping between Swimlane/Grid doesn't
         shift the layout. Right-justified with a vertical rule that
         separates it visually from the tab list. -->
    <span class="plan-tabs-divider" aria-hidden="true"></span>
    <nav class="plan-tabs-view-toggle" aria-label="Calendar view">
      {#if data.view === 'swimlane'}
        <span class="cv-link cv-active" aria-current="page">📋 Swimlane</span>
        <a class="cv-link" href={calendarHref('grid')}>📅 Grid</a>
      {:else}
        <a class="cv-link" href={calendarHref('swimlane')}>📋 Swimlane</a>
        <span class="cv-link cv-active" aria-current="page">📅 Grid</span>
      {/if}
    </nav>
  {/if}
</nav>

{#if !data.canEdit}
  <section class="card role-notice">
    <p>📚 View only — helper role can browse Plan but cannot create or edit. Sign in as Owner.</p>
  </section>
{/if}

<!-- ────────────────────────── OVERVIEW (Season Setup, stage 1 of 5) ────────────────────────── -->
{#if data.tab === 'overview'}
  <section class="card season-card">
    <header class="season-header">
      <div class="season-headline">
        <span class="season-year">{data.currentYear ?? new Date().getFullYear()}</span>
        <span class="season-title">Planting season</span>
      </div>
      <span class="stage-pill">Stage 1 of 5 · Season setup</span>
    </header>

    {#if data.seasonSetup && !editingSeason}
      <!-- Setup exists: show all 6 settings as a definition list + Edit
           button to swap back to the inline form + Next CTA. -->
      <dl class="season-summary">
        <div class="season-row">
          <dt>Input philosophy</dt>
          <dd>{PHILOSOPHY_LABELS[data.seasonSetup.philosophy]}</dd>
        </div>
        {#if data.seasonSetup.philosophy === 'organic-transitioning' && data.seasonSetup.transitioningStartedYear}
          <div class="season-row">
            <dt>Transition started</dt>
            <dd>{data.seasonSetup.transitioningStartedYear}</dd>
          </div>
        {/if}
        <div class="season-row">
          <dt>Weed strategy</dt>
          <dd>{WEED_LABELS[data.seasonSetup.weedStrategy]}</dd>
        </div>
        <div class="season-row">
          <dt>Pest strategy</dt>
          <dd>{PEST_LABELS[data.seasonSetup.pestStrategy]}</dd>
        </div>
        <div class="season-row">
          <dt>Fertility approach</dt>
          <dd>{FERTILITY_LABELS[data.seasonSetup.fertilityApproach]}</dd>
        </div>
        <div class="season-row">
          <dt>Cover crop intent</dt>
          <dd>{COVER_LABELS[data.seasonSetup.coverCropIntent]}</dd>
        </div>
        <div class="season-row">
          <dt>Spray application capacity</dt>
          <dd>{SPRAY_LABELS[data.seasonSetup.sprayCapacity]}</dd>
        </div>
      </dl>
      {#if data.canEdit}
        <div class="season-meta-row">
          <span class="season-meta">
            Last updated {new Date(data.seasonSetup.setAt).toLocaleString()}
          </span>
          <button
            type="button"
            class="edit-season-btn"
            onclick={() => (editingSeason = true)}
          >
            Edit season settings
          </button>
        </div>
      {/if}
      <div class="stage-cta-row">
        <p class="stage-helper">
          Your {data.currentYear ?? new Date().getFullYear()} season setup is captured.
          Continue to the next stage — define where things are growing.
        </p>
        <a class="next-stage-btn" href={tabHref('layout')}>Next: Layout →</a>
      </div>
    {:else if data.canEdit}
      <!-- No setup yet, or operator chose to edit: show the form inline. -->
      <SeasonSetupStep
        existing={data.seasonSetup ?? null}
        lastYearSetup={data.lastYearSetup ?? null}
        currentYear={data.currentYear ?? new Date().getFullYear()}
        onSave={handleSeasonSaved}
      />
      {#if editingSeason}
        <p class="stage-helper">
          <button type="button" class="cancel-edit-link" onclick={() => (editingSeason = false)}
            >Cancel edits</button
          >
        </p>
      {/if}
    {:else}
      <!-- Helper / read-only viewer. -->
      <p class="stage-helper">
        The owner hasn't completed the season setup for {data.currentYear ??
          new Date().getFullYear()} yet. The planner uses the setup to filter
        which products and tasks to suggest, so downstream stages will fall
        back to conventional defaults until it's set.
      </p>
    {/if}
  </section>
{/if}

<!-- ────────────────────────── LAYOUT ────────────────────────── -->
{#if data.tab === 'layout'}
  {#if data.isFirstRun && data.canEdit}
    <section class="card wizard">
      <h2>👋 Welcome to CropCard</h2>
      <p>Draw your first field on the map below, or use <strong>Add field or block without drawing</strong> at the bottom of this page to get started by name.</p>
    </section>
  {/if}

  {#if browser}
    <BlockMap
      bind:this={blockMap}
      blocks={data.blocks}
      fields={data.fields}
      canEdit={data.canEdit}
      onSaveGeometry={saveGeometry}
      onCreateWithGeometry={createBlockWithGeometry}
      onSaveFieldGeometry={saveFieldGeometry}
      onCreateFieldWithGeometry={createFieldWithGeometry}
      shadeSources={data.shadeSources ?? []}
      onCreateShadeSource={createShadeSource}
      onDeleteShadeSource={deleteShadeSource}
      onUpdateShadeGeometry={updateShadeGeometry}
    />
  {:else}
    <section class="card empty"><p>Loading map…</p></section>
  {/if}

  <section class="card">
    {#if data.fields.length === 0}
      <p class="empty-row">No fields yet. Use ➕ Draw field on the map above.</p>
    {:else}
      {#each data.fields as f (f.id)}
        {@const fieldBlocksRaw = data.blocks.filter((b) => b.fieldId === f.id)}
        {@const fieldBlocks = applyBlockOrder(fieldBlocksRaw, cropsTabOrder)}
        {@const fieldAcresDisplay = f.acres ?? (f.blockAcresTotal > 0 ? f.blockAcresTotal : null)}
        <div class="field-group">
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="field-row"
            class:field-drop-target={fieldDropOverId === f.id && cropsReorderDragId !== null}
            ondragover={(e) => onFieldRowDragOver(e, f.id)}
            ondragleave={() => onFieldRowDragLeave(f.id)}
            ondrop={(e) => onFieldRowDrop(e, f.id)}
          >
            <span class="field-icon">🌾</span>
            <strong class="field-name">{f.name}</strong>
            <span class="field-stats">
              {fieldBlocks.length} block{fieldBlocks.length === 1 ? '' : 's'}
              {#if fieldAcresDisplay !== null}· {fieldAcresDisplay.toFixed(1)} ac{/if}
            </span>
            {#if data.canEdit}
              <button class="row-action" draggable="false" ondragstart={(e) => e.preventDefault()} onclick={() => { addingBlockForFieldId = addingBlockForFieldId === f.id ? null : f.id; newBlockName = ''; newBlockAcres = undefined; blockError = null; }} title="Add block"
                aria-label="Add block to {f.name}">＋</button>
              <button class="row-action" draggable="false" ondragstart={(e) => e.preventDefault()} onclick={() => startEditField(f)} title="Edit field">✏</button>
              <button class="row-action danger" draggable="false" ondragstart={(e) => e.preventDefault()} onclick={() => deleteField(f.id, f.name, fieldBlocks.length)} aria-label="Delete {f.name}" title="Delete field">🗑</button>
            {/if}
          </div>

          {#if editingFieldId === f.id}
            <div class="inline-edit">
              <div class="grid2">
                <label>Name<input type="text" bind:value={editFieldName} /></label>
                <label>Acres<input type="number" min="0" step="0.1" bind:value={editFieldAcres} /></label>
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
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <li
                  class="block-row layout-block-row"
                  class:dragging={cropsReorderDragId === b.id}
                  class:drop-target={cropsReorderOverId === b.id && cropsReorderDragId !== null && cropsReorderDragId !== b.id}
                  draggable={data.canEdit !== false}
                  ondragstart={(e) => onCropsHeaderDragStart(e, b.id)}
                  ondragover={(e) => onCropsHeaderDragOver(e, b.id)}
                  ondragleave={() => onCropsHeaderDragLeave(b.id)}
                  ondrop={(e) => onCropsHeaderDrop(e, b.id, fieldBlocks.map((x) => x.id))}
                  ondragend={onCropsHeaderDragEnd}
                  title="Drag to reorder, or drop on another field row to move"
                >
                  <span class="grip" aria-hidden="true">⋮⋮</span>
                  <span class="block-icon">▪</span>
                  <span class="block-name">{b.name}</span>
                  <span class="block-stats">
                    {#if acresDisplay}{acresDisplay}{/if}
                    {#if b.plantings.length > 0}
                      {acresDisplay ? ' · ' : ''}
                      <span class="plantings-tip" data-tip={b.plantings.map((p) => p.varietyDisplayName).join(' · ')}
                        >{b.plantings.length} planting{b.plantings.length === 1 ? '' : 's'}</span>
                    {/if}
                    {#if !b.geometryGeojson}<span class="not-drawn">not drawn</span>{/if}
                  </span>
                  {#if data.canEdit}
                    <button class="row-action" draggable="false" ondragstart={(e) => e.preventDefault()} onclick={() => startEditBlock(b)} title="Edit block">✏</button>
                    <button class="row-action danger" draggable="false" ondragstart={(e) => e.preventDefault()} onclick={() => deleteBlock(b.id, b.name, b.plantings.length)} aria-label="Delete {b.name}" title="Delete block">🗑</button>
                  {/if}
                </li>
                {#if editingBlockId === b.id}
                  <li class="inline-edit-row">
                    <div class="inline-edit">
                      <div class="grid2">
                        <label>Name<input type="text" bind:value={editBlockName} /></label>
                        <label>Acres<input type="number" min="0" step="0.1" bind:value={editBlockAcres} /></label>
                        {#if data.fields.length > 1}
                          <label class="full">Move to field
                            <select bind:value={editBlockFieldId}>
                              {#each data.fields as ff (ff.id)}<option value={ff.id}>{ff.name}</option>{/each}
                            </select>
                          </label>
                        {/if}
                        <label class="full">Tillage method
                          <select bind:value={editBlockTillage}>
                            <option value="conventional">Conventional (plow/disk)</option>
                            <option value="reduced-till">Reduced-till (single pass)</option>
                            <option value="no-till">No-till (burndown only)</option>
                          </select>
                        </label>
                        <label>Slope (%)
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.5"
                            placeholder="0"
                            bind:value={editBlockSlopePercent}
                          />
                        </label>
                        <label>Slope aspect (° downhill)
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
                        Slope inputs are optional. Leave both blank for flat
                        terrain. The shade model uses these to lengthen / shorten
                        projected shadows along the downhill axis.
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

          {#if data.canEdit && addingBlockForFieldId === f.id}
            <div class="add-block-inline">
              <input type="text" placeholder="Block name" bind:value={newBlockName} />
              <input type="number" placeholder="ac" min="0" step="0.1" bind:value={newBlockAcres} class="acres-input" />
              <button class="primary small" onclick={() => createBlock(f.id)} disabled={creatingBlock || !newBlockName.trim()}>
                {creatingBlock ? '…' : 'Add'}
              </button>
              <button class="small" onclick={() => { addingBlockForFieldId = null; newBlockName = ''; newBlockAcres = undefined; }}>✕</button>
            </div>
            {#if blockError}<p class="error" style="padding-left:1.5rem">{blockError}</p>{/if}
          {/if}

          {#if (data.shadeSources ?? []).some((s) => s.fieldId === f.id)}
            {@const fieldShades = (data.shadeSources ?? []).filter((s) => s.fieldId === f.id)}
            <ul class="block-list-flat">
              {#each fieldShades as s (s.id)}
                <li class="block-row shade-row">
                  <span class="block-icon">{shadeKindEmoji(s.kind)}</span>
                  <span class="block-name">{s.name}</span>
                  <span class="block-stats">
                    {s.kind} · {s.heightFt} ft
                    {#if s.isDeciduous} · deciduous{/if}
                    {#if !s.geometryGeojson}<span class="not-drawn">not drawn</span>{/if}
                  </span>
                  {#if data.canEdit}
                    <button class="row-action" onclick={() => startEditShade(s)} title="Edit shade source">✏</button>
                    <button class="row-action danger" onclick={() => deleteShadeSource(s.id, s.name)} aria-label="Delete {s.name}" title="Delete shade source">🗑</button>
                  {/if}
                </li>
                {#if editingShadeId === s.id}
                  <li class="inline-edit-row">
                    <div class="inline-edit">
                      <div class="grid2">
                        <label>Name<input type="text" bind:value={editShadeName} /></label>
                        <label>Kind
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
                        <label>Height (ft)<input type="number" min="1" max="200" step="1" bind:value={editShadeHeightFt} /></label>
                        <label>Opacity (0–1)<input type="number" min="0" max="1" step="0.05" bind:value={editShadeOpacity} /></label>
                        {#if data.fields.length > 0}
                          <label class="full">Field
                            <select bind:value={editShadeFieldId}>
                              <option value="">— Farm-wide (no field) —</option>
                              {#each data.fields as ff (ff.id)}<option value={ff.id}>{ff.name}</option>{/each}
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
                          <label>Leaf-on (day of year)<input type="number" min="1" max="366" bind:value={editShadeLeafOnDoy} /></label>
                          <label>Leaf-off (day of year)<input type="number" min="1" max="366" bind:value={editShadeLeafOffDoy} /></label>
                        </div>
                      {/if}
                      <div class="row">
                        <button class="primary" onclick={saveEditShade}>Save</button>
                        <button onclick={() => (editingShadeId = null)}>Cancel</button>
                      </div>
                    </div>
                  </li>
                {/if}
              {/each}
            </ul>
          {/if}
        </div>
      {/each}

      {#if (data.shadeSources ?? []).some((s) => !s.fieldId || !data.fields.some((f) => f.id === s.fieldId))}
        {@const unscopedShades = (data.shadeSources ?? []).filter((s) => !s.fieldId || !data.fields.some((f) => f.id === s.fieldId))}
        <div class="field-group">
          <div class="field-row">
            <span class="field-icon">🌐</span>
            <strong class="field-name">Farm-wide shade sources</strong>
            <span class="field-stats">{unscopedShades.length} entr{unscopedShades.length === 1 ? 'y' : 'ies'}</span>
          </div>
          <ul class="block-list-flat">
            {#each unscopedShades as s (s.id)}
              <li class="block-row shade-row">
                <span class="block-icon">{shadeKindEmoji(s.kind)}</span>
                <span class="block-name">{s.name}</span>
                <span class="block-stats">
                  {s.kind} · {s.heightFt} ft
                  {#if s.isDeciduous} · deciduous{/if}
                  {#if !s.geometryGeojson}<span class="not-drawn">not drawn</span>{/if}
                </span>
                {#if data.canEdit}
                  <button class="row-action" onclick={() => startEditShade(s)} title="Edit shade source">✏</button>
                  <button class="row-action danger" onclick={() => deleteShadeSource(s.id, s.name)} aria-label="Delete {s.name}" title="Delete shade source">🗑</button>
                {/if}
              </li>
              {#if editingShadeId === s.id}
                <li class="inline-edit-row">
                  <div class="inline-edit">
                    <div class="grid2">
                      <label>Name<input type="text" bind:value={editShadeName} /></label>
                      <label>Kind
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
                      <label>Height (ft)<input type="number" min="1" max="200" step="1" bind:value={editShadeHeightFt} /></label>
                      <label>Opacity (0–1)<input type="number" min="0" max="1" step="0.05" bind:value={editShadeOpacity} /></label>
                      {#if data.fields.length > 0}
                        <label class="full">Field
                          <select bind:value={editShadeFieldId}>
                            <option value="">— Farm-wide (no field) —</option>
                            {#each data.fields as ff (ff.id)}<option value={ff.id}>{ff.name}</option>{/each}
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
                        <label>Leaf-on (day of year)<input type="number" min="1" max="366" bind:value={editShadeLeafOnDoy} /></label>
                        <label>Leaf-off (day of year)<input type="number" min="1" max="366" bind:value={editShadeLeafOffDoy} /></label>
                      </div>
                    {/if}
                    <div class="row">
                      <button class="primary" onclick={saveEditShade}>Save</button>
                      <button onclick={() => (editingShadeId = null)}>Cancel</button>
                    </div>
                  </div>
                </li>
              {/if}
            {/each}
          </ul>
        </div>
      {/if}
      <!-- Blocks with no field assignment (shouldn't happen post-migration) -->
      {@const orphans = data.blocks.filter((b) => !b.fieldId || !data.fields.some((f) => f.id === b.fieldId))}
      {#if orphans.length > 0}
        <div class="field-group">
          <div class="field-row">
            <span class="field-icon">⚠️</span>
            <strong class="field-name">Unassigned</strong>
          </div>
          <ul class="block-list-flat">
            {#each orphans as b (b.id)}
              <li class="block-row">
                <span class="block-icon">▪</span>
                <span class="block-name">{b.name}</span>
                <span class="block-stats">
                  {#if b.acres !== undefined}{b.acres.toFixed(1)} ac{/if}
                  {#if !b.geometryGeojson}<span class="not-drawn">not drawn</span>{/if}
                </span>
                {#if data.canEdit}
                  <button class="row-action danger" onclick={() => deleteBlock(b.id, b.name, b.plantings.length)} aria-label="Delete {b.name}">🗑</button>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    {/if}
  </section>

  {#if data.canEdit}
    <details class="card advanced">
      <summary>Add without drawing</summary>
      <p class="lede">
        Add a field, block, tree row, grove, building, or other shade source by name only.
        Geometry is optional — draw it later on the map above by selecting the matching tool.
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
            <label>Name<input type="text" placeholder="e.g. North Field" bind:value={newFieldName} /></label>
            <label>Acres (optional)<input type="number" min="0" step="0.1" bind:value={newFieldAcres} /></label>
            <label class="full">Notes (optional)<input type="text" placeholder="Lease info, address, etc." bind:value={newFieldNotes} /></label>
          </div>
          <button class="primary" onclick={createField} disabled={creatingField || !newFieldName.trim()}>
            {creatingField ? '…' : 'Add field'}
          </button>
          {#if fieldError}<p class="error">{fieldError}</p>{/if}
        </div>
      {:else if addKind === 'block'}
        {#if data.fields.length === 0}
          <p class="error">Add a field first — every block belongs to one.</p>
        {:else}
          <div class="add-form-section">
            <div class="grid2">
              <label>Name<input type="text" placeholder="e.g. Corn Block A" bind:value={newBlockName} /></label>
              <label>Acres (optional)<input type="number" min="0" step="0.1" bind:value={newBlockAcres} /></label>
              <label class="full">Field
                <select bind:value={newBlockFieldId}>
                  {#each data.fields as ff (ff.id)}<option value={ff.id}>{ff.name}</option>{/each}
                </select>
              </label>
            </div>
            <button class="primary" onclick={() => createBlock()} disabled={creatingBlock || !newBlockName.trim()}>
              {creatingBlock ? '…' : 'Add block'}
            </button>
            {#if blockError}<p class="error">{blockError}</p>{/if}
          </div>
        {/if}
      {:else}
        <div class="add-form-section">
          <div class="grid2">
            <label>Name<input type="text" placeholder="e.g. North maple windbreak" bind:value={addShadeName} /></label>
            <label>Height (ft)<input type="number" min="1" max="200" step="1" bind:value={addShadeHeightFt} /></label>
            <label>Opacity (0–1)<input type="number" min="0" max="1" step="0.05" bind:value={addShadeOpacity} /></label>
            <label class="full">Field (optional — leave blank for farm-wide)
              <select bind:value={addShadeFieldId}>
                <option value="">— Farm-wide (no field) —</option>
                {#each data.fields as ff (ff.id)}<option value={ff.id}>{ff.name}</option>{/each}
              </select>
            </label>
          </div>
          <label class="checkbox-line">
            <input type="checkbox" bind:checked={addShadeIsDeciduous} />
            Deciduous (leaves drop in winter)
          </label>
          {#if addShadeIsDeciduous}
            <div class="grid2">
              <label>Leaf-on (day of year)<input type="number" min="1" max="366" bind:value={addShadeLeafOnDoy} /></label>
              <label>Leaf-off (day of year)<input type="number" min="1" max="366" bind:value={addShadeLeafOffDoy} /></label>
            </div>
          {/if}
          <button class="primary" onclick={addShadeWithoutGeometry} disabled={addingShade || !addShadeName.trim()}>
            {addingShade ? '…' : `Add ${addKind}`}
          </button>
          {#if addShadeError}<p class="error">{addShadeError}</p>{/if}
          <p class="muted" style="margin-top:0.4rem">
            Without geometry the shade source won't project shadows — draw it on the map after to wire up shading.
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
          onclick={() => { pasteMode = 'block'; pasteResults = []; geomError = null; geomMessage = null; }}
          type="button"
        >Single block</button>
        <button
          class:active={pasteMode === 'collection'}
          onclick={() => { pasteMode = 'collection'; geomError = null; geomMessage = null; }}
          type="button"
        >Fields + Blocks (FeatureCollection)</button>
      </div>

      <form onsubmit={savePaste}>
        {#if pasteMode === 'block'}
          <label>
            Block
            <select bind:value={pasteBlockId}>
              {#each data.blocks as b (b.id)}
                <option value={b.id}>
                  {b.name}{b.geometryGeojson ? ' (has geometry)' : ''}
                </option>
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
            <code>properties.type</code> of <code>"field"</code> or <code>"block"</code>,
            and <code>properties.name</code> matching an existing field or block name.
            Block features may also include <code>properties.field</code> to disambiguate when
            the same block name exists in multiple fields.
          </p>
          <details class="example-collapse">
            <summary>Show example</summary>
            <pre class="geojson-example">{`{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Polygon", "coordinates": [[...]] },
      "properties": { "type": "field", "name": "Home Field" }
    },
    {
      "type": "Feature",
      "geometry": { "type": "Polygon", "coordinates": [[...]] },
      "properties": { "type": "block", "name": "Corn Block A", "field": "Home Field" }
    }
  ]
}`}</pre>
          </details>
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

{/if}

<!-- ────────────────────────── CROPS ────────────────────────── -->
{#if data.tab === 'crops'}
  {#if browser && (data.fields.some((f) => f.geometryGeojson) || data.blocks.some((b) => b.geometryGeojson))}
    <BlockMap
      blocks={data.blocks}
      fields={data.fields}
      canEdit={false}
      blockBadges={blockBadges}
      shadeSources={data.shadeSources ?? []}
      onSaveGeometry={saveGeometry}
      onCreateWithGeometry={createBlockWithGeometry}
      onSaveFieldGeometry={saveFieldGeometry}
      onCreateFieldWithGeometry={createFieldWithGeometry}
    />
  {/if}

  {#if data.fields.length === 0}
    <section class="card empty">
      <p>Add a field on the Layout tab to get started.</p>
    </section>
  {:else}
    <div class="crops-tab-layout">
    <section class="card crops-card">
      {#each data.fields as f (f.id)}
        {@const fieldBlocksRaw = data.blocks.filter((b) => b.fieldId === f.id)}
        {@const fieldBlocks = applyBlockOrder(fieldBlocksRaw, cropsTabOrder)}
        {@const fieldBlockIds = fieldBlocks.map((b) => b.id)}
        {@const totalCrops = fieldBlocks.reduce((n, b) => n + b.plantings.length, 0)}
        <div class="field-group">
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="field-row"
            class:field-drop-target={fieldDropOverId === f.id && cropsReorderDragId !== null}
            ondragover={(e) => onFieldRowDragOver(e, f.id)}
            ondragleave={() => onFieldRowDragLeave(f.id)}
            ondrop={(e) => onFieldRowDrop(e, f.id)}
          >
            <span class="field-icon">🌾</span>
            <strong class="field-name">{f.name}</strong>
            <span class="field-stats">
              {fieldBlocks.length} block{fieldBlocks.length === 1 ? '' : 's'}
              {#if totalCrops > 0}· {totalCrops} crop{totalCrops === 1 ? '' : 's'}{/if}
            </span>
          </div>

          {#if fieldBlocks.length === 0}
            <p class="empty-row-indent">No blocks — add them on the Layout tab.</p>
          {:else}
            {#each fieldBlocks as block (block.id)}
              {@const blockAcresDisplay = block.acres !== undefined ? `${block.acres.toFixed(2)} ac` : null}
              <div
                class="crop-block"
                class:dragging={cropsReorderDragId === block.id}
                class:drop-target={cropsReorderOverId === block.id && cropsReorderDragId !== null && cropsReorderDragId !== block.id}
                class:seed-drop-target={cropsSeedHoverBlockId === block.id && cropsSeedDrag !== null}
                class:crop-drop-target={cropMoveOverBlockId === block.id && cropMoveDragId !== null}
              >
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  class="block-row"
                  draggable="true"
                  ondragstart={(e) => onCropsHeaderDragStart(e, block.id)}
                  ondragover={(e) => onCropsHeaderDragOver(e, block.id)}
                  ondragleave={() => onCropsHeaderDragLeave(block.id)}
                  ondrop={(e) => onCropsHeaderDrop(e, block.id, fieldBlockIds)}
                  ondragend={onCropsHeaderDragEnd}
                  title="Drag to reorder blocks in this field"
                >
                  <span class="grip" aria-hidden="true">⋮⋮</span>
                  <span class="block-icon">▪</span>
                  <span class="block-name">{block.name}</span>
                  <span class="block-stats">
                    {block.plantings.length} crop{block.plantings.length === 1 ? '' : 's'}
                    {#if blockAcresDisplay} · {blockAcresDisplay}{/if}
                  </span>
                  {#if data.canEdit}
                    <button
                      class="row-action crop-add-btn"
                      draggable="false"
                      ondragstart={(e) => e.preventDefault()}
                      onclick={(e) => { e.stopPropagation(); pickerBlockId = block.id; }}
                      title="Add crop to {block.name}"
                    >＋ crop</button>
                  {/if}
                </div>

                {#if block.plantings.length > 0}
                  <ul class="crop-list">
                    {#each block.plantings as p (p.id)}
                      {@const guide = data.plantingGuides[p.cropPluginId]}
                      {@const catalogItem = data.cropCatalog.find((c) => c.pluginId === p.cropPluginId)}
                      {@const cropDtm = catalogItem?.daysToMaturity}
                      {@const fam = pluginById.get(p.cropPluginId)?.cropFamily}
                      {@const familyEmoji = (fam && FAMILY_ICON[fam]) || '🌱'}
                      {@const guideTip = [
                        cropDtm ? 'DTM: ' + (cropDtm.min === cropDtm.max ? cropDtm.min : cropDtm.min + '–' + cropDtm.max) + ' d' : '',
                        guide?.soilTempMinF !== undefined ? 'Soil min: ' + guide.soilTempMinF + '°F' : '',
                        guide?.rowSpacingIn !== undefined ? 'Row spacing: ' + guide.rowSpacingIn + ' in' : '',
                        guide?.inRowSpacingIn ? 'In-row: ' + guide.inRowSpacingIn.min + '–' + guide.inRowSpacingIn.max + ' in' : '',
                        guide?.seedDepthIn ? 'Seed depth: ' + guide.seedDepthIn.min + '–' + guide.seedDepthIn.max + ' in' : '',
                        guide?.seedsPerAcre !== undefined ? 'Seeds/acre: ' + guide.seedsPerAcre.toLocaleString() : ''
                      ].filter(Boolean).join('\n') || 'No guide available'}
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <li
                        class="crop-item"
                        class:dragging={cropMoveDragId === p.id}
                        draggable={data.canEdit !== false}
                        ondragstart={(e) => onCropItemDragStart(e, p.id)}
                        ondragend={onCropItemDragEnd}
                        title="Drag onto another block to move this crop"
                      >
                        <div class="crop-item-row">
                          <span class="grip" aria-hidden="true">⋮⋮</span>
                          <span class="crop-name-group">
                            <span class="crop-family-emoji" aria-hidden="true">{familyEmoji}</span>
                            <a
                              href="/crops/{p.id}"
                              class="crop-name"
                              draggable="false"
                              ondragstart={(e) => e.preventDefault()}
                              title={p.varietyDisplayName}
                            >{data.seedShortNameByDisplay?.[p.varietyDisplayName] ?? p.varietyDisplayName}</a>
                            {#if p.quantityPlanted !== undefined && p.quantityUnit}
                              <span class="crop-qty">{p.quantityPlanted} {p.quantityUnit}</span>
                            {/if}
                            <button
                              class="guide-tip"
                              class:open={openGuides.has(p.id)}
                              data-tip={guideTip}
                              draggable="false"
                              ondragstart={(e) => e.preventDefault()}
                              onclick={(e) => { e.stopPropagation(); toggleGuide(p.id); }}
                            >ⓘ</button>
                          </span>
                          {#if p.plantingDate}
                            <span class="crop-date">{new Date(p.plantingDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                          {/if}
                        </div>
                        {#if openGuides.has(p.id)}
                          <dl class="guide-dl">
                            {#if catalogItem?.daysToMaturity}
                              {@const dtm = catalogItem.daysToMaturity}
                              <dt>Days to maturity</dt><dd>{dtm.min === dtm.max ? dtm.min : `${dtm.min}–${dtm.max}`} d</dd>
                            {/if}
                            {#if guide?.soilTempMinF !== undefined}<dt>Soil temp min</dt><dd>{guide.soilTempMinF}°F</dd>{/if}
                            {#if guide?.rowSpacingIn !== undefined}<dt>Row spacing</dt><dd>{guide.rowSpacingIn} in</dd>{/if}
                            {#if guide?.inRowSpacingIn}<dt>In-row spacing</dt><dd>{guide.inRowSpacingIn.min}–{guide.inRowSpacingIn.max} in</dd>{/if}
                            {#if guide?.seedDepthIn}<dt>Seed depth</dt><dd>{guide.seedDepthIn.min}–{guide.seedDepthIn.max} in</dd>{/if}
                            {#if guide?.seedsPerAcre !== undefined}<dt>Seeds / acre</dt><dd>{guide.seedsPerAcre.toLocaleString()}</dd>{/if}
                            {#if !catalogItem?.daysToMaturity && !guide}
                              <dt>Info</dt><dd>No guide available</dd>
                            {/if}
                          </dl>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
            {/each}
          {/if}
        </div>
      {/each}
    </section>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <aside
      class="crops-seed-rail"
      class:return-target={cropMoveOverRail && cropMoveDragId !== null}
      ondragover={onRailDragOver}
      ondragleave={onRailDragLeave}
      ondrop={onRailDrop}
      aria-label="Seed stock"
    >
      {#if cropMoveDragId !== null}
        <div class="rail-drop-banner">↩ Drop here to remove the crop and restore stock</div>
      {/if}
      <h3>Seed Stock <span class="count">({(data.seedStock ?? []).length})</span></h3>
      {#if data.canEdit && (data.seedStock ?? []).length > 0 && data.blocks.length > 0}
        <button
          type="button"
          class="ai-allocate-btn"
          onclick={() => (showAllocationWizard = true)}
          title="Plan plantings from your seed stock — AI picks blocks and dates"
        >
          ✨ Plan Plantings
        </button>
      {/if}
      {#if (data.seedStock ?? []).length === 0}
        <p class="seed-rail-empty">No seed stock with on-hand &gt; 0. Add seeds via <a href="/stock">Stock</a>.</p>
      {:else}
        {@const groupsByFamily = (() => {
          type SS = NonNullable<typeof data.seedStock>[number];
          const seeds = (data.seedStock ?? []) as SS[];
          const m = new Map<string, SS[]>();
          for (const s of seeds) {
            const key = s.cropFamily ?? '';
            const list = m.get(key) ?? [];
            list.push(s);
            m.set(key, list);
          }
          return [...m.entries()]
            .map(([family, items]) => ({
              family: family || null,
              items: [...items].sort((a, b) => a.displayName.localeCompare(b.displayName))
            }))
            .sort((a, b) => (a.family ?? 'zz').localeCompare(b.family ?? 'zz'));
        })()}
        {#each groupsByFamily as g (g.family ?? '__unc__')}
          <div class="seed-family">
            <div class="seed-family-head">
              <span aria-hidden="true">{(g.family && FAMILY_ICON[g.family]) || '🌱'}</span>
              <span>{g.family ?? 'Unclassified'}</span>
              <span class="count">({g.items.length})</span>
            </div>
            <ul class="seed-list">
              {#each g.items as s (s.stockItemId)}
                {@const empty = s.onHand <= 0}
                {@const canDrag = data.canEdit !== false && !!s.cropPluginId && !empty}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <li
                  class="seed-card"
                  class:disabled={!canDrag}
                  class:empty
                  draggable={canDrag}
                  ondragstart={(e) => onSeedRailDragStart(e, s)}
                  ondragend={onSeedRailDragEnd}
                  title={
                    empty
                      ? `Out of stock — restock in /stock to plant\n${s.displayName}`
                      : !s.cropPluginId
                        ? `No crop plugin linked — set one in /stock\n${s.displayName}`
                        : `Drag onto a block to plant\n${s.displayName}`
                  }
                >
                  <span class="seed-name">{s.shortName ?? s.displayName}</span>
                  <span class="seed-meta">
                    {s.onHand} {s.defaultUnit}
                    {#if empty} · empty{/if}
                  </span>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      {/if}
    </aside>
    </div>
    {#if plantingError}<p class="error">{plantingError}</p>{/if}

    <!-- Livestock placeholder -->
    <section class="card livestock-placeholder">
      <div class="livestock-header">
        <span class="livestock-icon">🐄</span>
        <h2 class="livestock-title">Livestock</h2>
        <span class="coming-soon-badge">Coming soon</span>
      </div>
      <p>Assign livestock to fields, track grazing rotations, and integrate pasture management with crop planning and spray buffer zones.</p>
      <p class="feature-note">📋 Feature request: animal records, grazing schedules, pasture rotation, headcount tracking, and integration with spray buffer and field rest periods.</p>
    </section>
  {/if}
{/if}

{#if pickerBlockId}
  {@const pickerBlock = data.blocks.find((b) => b.id === pickerBlockId)}
  {#if pickerBlock}
    <CropPickerModal
      catalog={data.cropCatalog}
      blockName={pickerBlock.name}
      onSelect={(pluginId, date) => {
        const bid = pickerBlockId!;
        pickerBlockId = null;
        addPlanting(bid, pluginId, date);
      }}
      onClose={() => { pickerBlockId = null; }}
    />
  {/if}
{/if}

{#if activeSeedModal}
  {@const s = seedStockById.get(activeSeedModal.stockItemId)}
  {#if s}
    <SeedQuantityModal
      stock={{
        stockItemId: s.stockItemId,
        displayName: s.displayName,
        onHand: s.onHand,
        defaultUnit: s.defaultUnit,
        cropPluginId: s.cropPluginId ?? '',
        cropFamily: s.cropFamily ?? null
      }}
      plugin={s.cropPluginId ? (pluginById.get(s.cropPluginId) as unknown as import('$lib/plugins/schemas').CropPlugin) : undefined}
      onConfirm={confirmSeedQuantity}
      onClose={() => { activeSeedModal = null; manualDropBlockId = null; }}
    />
  {/if}
{/if}

{#if showAllocationWizard}
  <AllocationWizard
    seedStock={(data.seedStock ?? []).map((s) => ({
      stockItemId: s.stockItemId,
      displayName: s.displayName,
      shortName: s.shortName,
      onHand: s.onHand,
      defaultUnit: s.defaultUnit,
      cropPluginId: s.cropPluginId,
      cropFamily: s.cropFamily ?? null
    }))}
    blocks={data.blocks.map((b) => ({
      id: b.id,
      name: b.name,
      blockLabel: b.blockLabel,
      acres: b.acres,
      sunExposure: b.sunExposure,
      plantings: b.plantings.map((p) => ({ varietyDisplayName: p.varietyDisplayName }))
    }))}
    plantingGuides={data.plantingGuides}
    cropCatalog={data.cropCatalog}
    seasonSetup={data.seasonSetup ?? null}
    lastYearSetup={data.lastYearSetup ?? null}
    currentYear={data.currentYear ?? new Date().getFullYear()}
    onClose={() => { showAllocationWizard = false; }}
    onCommitted={async () => {
      showAllocationWizard = false;
      await invalidateAll();
    }}
    onRefreshParent={async () => {
      // Reload /plan loader data without closing the wizard. Used by the
      // Start Over flow inside the wizard so the cleared-plan state lands
      // in the modal's props on the next render.
      await invalidateAll();
    }}
  />
{/if}

<!-- ──── SCHEDULE swim-lane payload (Phase 14) — renders under the
     Schedule tab (legacy URL) OR under Calendar tab when view=swimlane
     (Phase 21b follow-up). Shared template; same loader data. ───── -->
{#if data.tab === 'schedule' || (data.tab === 'calendar' && data.view === 'swimlane')}
  <section class="card schedule-header-card">
    <div class="schedule-action-row">
      <!-- LEFT: field + block filter chips. Same chips on swimlane + grid
           views so toggling between them doesn't shuffle the affordance. -->
      {#if (data.fields?.length ?? 0) > 1 || (data.swimBlocks?.length ?? 0) > 4}
        <span class="filter-inline" role="group" aria-label="Field and block filter">
          <span class="filter-line">
            <span class="filter-label">Field:</span>
            <button
              type="button"
              class="chip-mini"
              class:active={selectedFieldId === null}
              onclick={() => toggleField(null)}
              title="Show all fields"
            >All</button>
            {#each data.fields ?? [] as f (f.id)}
              {@const fieldBlockCount = (data.blocks ?? []).filter((b) => b.fieldId === f.id).length}
              {#if fieldBlockCount > 0}
                <button
                  type="button"
                  class="chip-mini"
                  class:active={selectedFieldId === f.id}
                  onclick={() => toggleField(f.id)}
                  title="Field: {f.name}"
                >{f.name}</button>
              {/if}
            {/each}
          </span>
          {#if filterableBlocks.length > 1}
            <span class="filter-line">
              <span class="filter-label">Blocks:</span>
              <button
                type="button"
                class="chip-mini chip-mini-block"
                class:active={selectedBlockIds.size === 0}
                onclick={clearBlockSelection}
                title="Show all blocks in this scope"
              >All</button>
              {#each filterableBlocks as b (b.id)}
                <button
                  type="button"
                  class="chip-mini chip-mini-block"
                  class:active={selectedBlockIds.has(b.id)}
                  onclick={() => toggleBlock(b.id)}
                  title="Block: {b.blockLabel ?? b.name}"
                >{b.blockLabel ?? b.name}</button>
              {/each}
            </span>
          {/if}
        </span>
      {/if}

      <!-- MIDDLE: selection actions (Edit / Split / Un-schedule / Cancel)
           when a bar is picked, OR the deterministic auto-schedule shortcut
           when there are unscheduled drafts. Right-justified next to the
           Optimize stack via `margin-left: auto`. Separator divider on both
           sides so the section reads as a distinct group. -->
      {#if swimSelection.size > 0 || (data.canEdit && filteredUnscheduled.length > 0)}
        <span class="action-divider" aria-hidden="true"></span>
        <div class="action-middle">
          {#if swimSelection.size === 0}
            <button
              type="button"
              class="action-btn action-btn-tight"
              onclick={autoScheduleDrafts}
              disabled={autoScheduleBusy || clearBusy}
              title="Deterministic engine — places every unscheduled draft on visible blocks at the earliest soil-temp + frost-safe date, no AI call"
            >
              {autoScheduleBusy ? 'Scheduling…' : `Auto-schedule ${filteredUnscheduled.length} draft${filteredUnscheduled.length === 1 ? '' : 's'}`}
            </button>
          {:else}
            <span class="action-counter">
              {swimSelection.size} selected
            </span>
            {#if swimSelection.size === 1}
              <button type="button" class="action-btn action-btn-tight" onclick={commitSelectionEdit}>Edit</button>
              <button
                type="button"
                class="action-btn action-btn-tight"
                onclick={commitSelectionSplit}
                title="Split this planting into N stacked copies; drag each to its target date."
              >Split…</button>
            {/if}
            {#if groupableSwimSelection}
              <button type="button" class="action-btn action-btn-primary action-btn-tight" onclick={commitSelectionGroup}>
                {groupableSwimSelection.hint === 'three-sisters' ? 'Group 3 Sisters' : 'Group'}
              </button>
            {/if}
            <button
              type="button"
              class="action-btn action-btn-tight"
              onclick={commitSelectionDelete}
              title="Pull selected planting(s) off the schedule. Crops stay attached to their blocks as drafts; permanent deletion lives on the Crops tab."
            >
              Un-schedule
            </button>
            <button type="button" class="action-btn action-btn-cancel action-btn-tight" onclick={clearSwimSelection}>
              Cancel
            </button>
          {/if}
        </div>
      {/if}

      <!-- RIGHT: Optimize + Clear stack. Right-justified. The whole stack
           is the same overall height as the Field / Blocks filter pair on
           the left so the action row reads as one balanced strip. -->
      {#if data.canEdit}
        <span class="action-divider" aria-hidden="true"></span>
        <div class="action-right">
          <button
            type="button"
            class="action-btn action-btn-primary action-btn-tight"
            onclick={() => (showOptimizerSidebar = true)}
            disabled={autoScheduleBusy || clearBusy}
            title="Open the AI optimizer — chat to re-arrange dates, accept the proposal when you like it"
          >
            ✨ Optimize Schedule
          </button>
          <button
            type="button"
            class="action-link action-link-under"
            onclick={resetSchedule}
            disabled={autoScheduleBusy || clearBusy}
            title="Unschedule every crop, disband groups, remove materialized tasks, then immediately re-run the deterministic auto-schedule. Harvested / archived crops untouched."
          >
            {clearBusy ? 'Resetting…' : 'Clear schedule'}
          </button>
        </div>
      {/if}
    </div>
    {#if autoRanQuiet}
      <div class="auto-run-banner" role="status" aria-live="polite">
        ✨ Auto-scheduled drafts on the earliest soil-safe + frost-safe dates. Drag bars to adjust.
      </div>
    {/if}
    {#if aiSpendBanner}
      <div class="ai-spend-banner" class:warn={aiSpendBanner.warn} role="status" aria-live="polite">
        AI spend this month: ${aiSpendBanner.spent.toFixed(2)} of ${aiSpendBanner.cap.toFixed(2)}.
        {#if aiSpendBanner.warn}<strong>Approaching cap — adjust on Settings.</strong>{/if}
      </div>
    {/if}
  </section>

  {#if !data.swimBlocks || data.swimBlocks.length === 0}
    <section class="card empty">
      <p>
        No blocks yet. Add one on the
        <a href={tabHref('layout')}>Layout tab</a>, then return here.
      </p>
    </section>
  {:else}
    <section class="card swim-grid">
      <div class="swim-pane">
        <BlockSwimlane
          blocks={filteredSwimBlocks}
          plantings={filteredSwimPlantings}
          shadeMarkers={data.shadeMarkers ?? []}
          overlaps={data.conflicts?.sameTime ?? []}
          rotations={data.conflicts?.rotation ?? []}
          year={data.year ?? new Date().getFullYear()}
          dragPayload={swimDragPayload}
          kbCarry={swimKbCarry}
          onDrop={(blockId, dayMs, payload) => {
            swimDragPayload = null;
            handleSwimDrop(blockId, dayMs, payload);
          }}
          onKbCommit={(blockId, dayMs, payload) => {
            swimKbCarry = null;
            handleSwimDrop(blockId, dayMs, payload);
          }}
          onKbCancel={() => (swimKbCarry = null)}
          taskPips={data.taskPips ?? []}
          onGroupOpen={(gid) => {
            openGroupId = gid;
            fetchGroupForInspector(gid);
          }}
          onBarDragStart={data.canEdit
            ? (cropId, sourceBlockId) => (swimDragPayload = { kind: 'move', cropId, sourceBlockId })
            : undefined}
          onBarDragEnd={() => (swimDragPayload = null)}
          selectedCropIds={swimSelection}
          onToggleSelect={data.canEdit ? toggleSwimSelect : undefined}
          snapDate={(dayMs, payload) => {
            // Mirror what the drop handler does so the preview line lands
            // on the same day the persisted plantingDate will. Move
            // payloads carry the cropId; we look up the pluginId from the
            // existing planting. Palette payloads carry pluginId directly.
            let pluginId: string | undefined;
            if (payload.kind === 'palette') {
              pluginId = payload.pluginId;
            } else {
              const p = data.swimPlantings?.find((x) => x.cropId === payload.cropId);
              pluginId = p?.cropPluginId;
            }
            return pluginId ? snapPlantingDate(pluginId, dayMs) : dayMs;
          }}
        />
      </div>
      {#if groupInspectorData && openGroupId}
        <div class="palette-pane">
          <GroupInspector
            groupId={groupInspectorData.groupId}
            systemKind={groupInspectorData.systemKind}
            members={groupInspectorData.members}
            tasks={groupInspectorData.tasks}
            onClose={() => { openGroupId = null; groupInspectorData = null; }}
            onDisband={handleDisbandGroup}
            onNudgeCompanion={handleNudgeCompanion}
          />
        </div>
      {/if}
    </section>

    {#if showGroupWizard}
      <PlantingGroupWizard
        blockLabels={filteredSwimBlocks.map((b) => ({
          id: b.id,
          label: b.blockLabel ?? b.name
        }))}
        blockIds={[...visibleBlockIds]}
        onClose={() => (showGroupWizard = false)}
        onCommitted={async (committedGroupIds) => {
          showGroupWizard = false;
          await invalidateAll();
          if (committedGroupIds.length > 0) {
            openGroupId = committedGroupIds[0];
            await fetchGroupForInspector(committedGroupIds[0]);
          }
        }}
      />
    {/if}

    {#if showOptimizerSidebar}
      <ScheduleOptimizerSidebar
        plantings={filteredSwimPlantings.map((p) => ({
          cropId: p.cropId,
          blockId: p.blockId,
          cropPluginId: p.cropPluginId,
          stockItemId: p.stockItemId,
          varietyDisplayName: p.varietyDisplayName,
          plantingDateMs: p.plantingDateMs,
          endMs: p.endMs
        }))}
        blocks={filteredSwimBlocks.map((b) => ({
          id: b.id,
          name: b.blockLabel ?? b.name
        }))}
        extraFacts={(() => {
          const f: string[] = [];
          const counts = data.conflicts ?? null;
          if (counts && counts.sameTime && counts.sameTime.length > 0) {
            f.push(`${counts.sameTime.length} same-time overlap${counts.sameTime.length === 1 ? '' : 's'} flagged on the swim-lane.`);
          }
          if (counts && counts.rotation && counts.rotation.length > 0) {
            f.push(`${counts.rotation.length} rotation conflict${counts.rotation.length === 1 ? '' : 's'} flagged.`);
          }
          return f;
        })()}
        onClose={() => (showOptimizerSidebar = false)}
        onApply={applyOptimizerProposal}
      />
    {/if}

    {#if editCropId}
      <div class="bar-edit-backdrop" role="dialog" aria-modal="true" aria-label="Edit planting">
        <div class="bar-edit">
          <header class="bar-edit-head">
            <h3>Edit planting</h3>
            <button type="button" class="close" onclick={() => (editCropId = null)} aria-label="Close">×</button>
          </header>
          <div class="bar-edit-body">
            <label>
              Short name
              <small class="field-hint">Shown on schedule bars. Persists on the stock item.</small>
              <input
                type="text"
                bind:value={editForm.shortName}
                disabled={editBusy || !editForm.stockItemId}
                maxlength="40"
                placeholder={editForm.stockItemId
                  ? 'e.g., Cinderella Pumpkin (≤40 chars)'
                  : 'No matching stock item — edit on Crops tab'}
              />
            </label>
            <label>
              Variety name
              <small class="field-hint">Full label stored on the planting record.</small>
              <input
                type="text"
                bind:value={editForm.varietyDisplayName}
                disabled={editBusy}
                maxlength="160"
              />
            </label>
            <label>
              Start date
              <input
                type="date"
                bind:value={editForm.plantingDate}
                disabled={editBusy}
              />
            </label>
            <div class="qty-row">
              <label class="qty-amount">
                Quantity planted
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  bind:value={editForm.quantityPlanted}
                  disabled={editBusy}
                  placeholder="(none recorded)"
                />
              </label>
              <label class="qty-unit">
                Unit
                <input
                  type="text"
                  value={editForm.quantityUnit || '—'}
                  readonly
                  tabindex="-1"
                  aria-readonly="true"
                  title="The unit was set when this planting was committed and isn't editable here. Change it on the Crops tab if you need a different unit."
                  class="qty-unit-readonly"
                />
              </label>
            </div>
            <p class="hint">
              Date changes snap to the soil-temp + last-frost floor and re-anchor dependent tasks.
              To move to a different block, drag the bar on the swim-lane. To change the crop
              plugin, disband any group first and use the Crops tab.
            </p>

            <fieldset class="harvest-uses">
              <legend>Harvest windows to surface</legend>
              {#if editForm.availableHarvestUseCases.length === 0}
                <p class="hint hint-tight">
                  This crop's plugin doesn't declare any tagged harvest windows yet, so there's
                  nothing to filter. The swim-lane will surface every harvest target from the
                  plugin's growth-stage table as-is.
                </p>
              {:else}
                <p class="hint hint-tight">
                  Tick which harvest windows you actually plan to take. Unticked windows are hidden
                  from the swim-lane bar so it shows just the ones you care about (e.g. pick
                  fresh-eating only on dual-purpose corn to hide the dent / grain window). Single-
                  window crops still show the toggle so you can hide the window entirely if you
                  don't intend to harvest this season.
                </p>
                <div class="harvest-use-list">
                  {#each editForm.availableHarvestUseCases as u (u)}
                    <label class="harvest-use-pill">
                      <input
                        type="checkbox"
                        checked={editForm.harvestUseCases.includes(u)}
                        onchange={(ev) => {
                          const target = ev.currentTarget as HTMLInputElement;
                          if (target.checked) {
                            if (!editForm.harvestUseCases.includes(u)) {
                              editForm.harvestUseCases = [...editForm.harvestUseCases, u];
                            }
                          } else {
                            editForm.harvestUseCases = editForm.harvestUseCases.filter(
                              (x) => x !== u
                            );
                          }
                        }}
                        disabled={editBusy}
                      />
                      <span>{u.replace(/-/g, ' ')}</span>
                    </label>
                  {/each}
                </div>
              {/if}
            </fieldset>

            {#if editError}<p class="bar-edit-error">{editError}</p>{/if}
          </div>
          <footer class="bar-edit-foot">
            <button type="button" class="btn-secondary" onclick={() => (editCropId = null)} disabled={editBusy}>
              Cancel
            </button>
            <button type="button" class="btn-primary" onclick={commitEdit} disabled={editBusy}>
              {editBusy ? 'Saving…' : 'Save'}
            </button>
          </footer>
        </div>
      </div>
    {/if}

    {#if splitTargetCropId}
      <div class="bar-edit-backdrop" role="dialog" aria-modal="true" aria-label="Split planting">
        <div class="bar-edit bar-edit-compact">
          <header class="bar-edit-head">
            <h3>Split into N copies</h3>
            <button
              type="button"
              class="close"
              onclick={() => (splitTargetCropId = null)}
              aria-label="Close"
              disabled={splitBusy}
            >×</button>
          </header>
          <div class="bar-edit-body">
            <p class="hint">
              Creates {splitCount} stacked copies on the same date + block. Seeds divide evenly
              across the splits (largest-remainder rounding). Drag each new bar to its target
              date once the popup closes.
            </p>
            <label class="split-count">
              Parts (2–12)
              <input
                type="number"
                min="2"
                max="12"
                step="1"
                bind:value={splitCount}
                disabled={splitBusy}
                autofocus
              />
            </label>
            {#if splitError}<p class="bar-edit-error">{splitError}</p>{/if}
          </div>
          <footer class="bar-edit-foot">
            <button
              type="button"
              class="btn-secondary"
              onclick={() => (splitTargetCropId = null)}
              disabled={splitBusy}
            >Cancel</button>
            <button
              type="button"
              class="btn-primary"
              onclick={commitSplit}
              disabled={splitBusy || splitCount < 2 || splitCount > 12}
            >
              {splitBusy ? 'Splitting…' : `Split into ${splitCount}`}
            </button>
          </footer>
        </div>
      </div>
    {/if}

    {#if deleteCropIds.length > 0}
      <div class="bar-edit-backdrop" role="dialog" aria-modal="true" aria-label="Un-schedule plantings">
        <div class="bar-edit">
          <header class="bar-edit-head">
            <h3>Un-schedule {deleteCropIds.length} planting{deleteCropIds.length === 1 ? '' : 's'}?</h3>
          </header>
          <div class="bar-edit-body">
            <p>
              Pulls the selected planting{deleteCropIds.length === 1 ? '' : 's'} off the schedule
              (clears the date, disbands any group binding, removes materialized tasks).
              The crop record{deleteCropIds.length === 1 ? '' : 's'} stay{deleteCropIds.length === 1 ? 's' : ''}
              attached to {deleteCropIds.length === 1 ? 'its' : 'their'} block as a draft.
            </p>
            <ul class="delete-list">
              {#each deleteCropIds as id (id)}
                {@const planting = data.swimPlantings?.find((p) => p.cropId === id)}
                <li>{planting?.varietyDisplayName ?? id}</li>
              {/each}
            </ul>
            <p class="hint">To permanently delete a crop, use the Crops tab.</p>
          </div>
          <footer class="bar-edit-foot">
            <button type="button" class="btn-secondary" onclick={() => (deleteCropIds = [])} disabled={deleteBusy}>
              Cancel
            </button>
            <button type="button" class="btn-primary" onclick={commitDelete} disabled={deleteBusy}>
              {deleteBusy ? 'Un-scheduling…' : `Un-schedule ${deleteCropIds.length}`}
            </button>
          </footer>
        </div>
      </div>
    {/if}

    <p class="shade-footnote">
      <strong>Shade model:</strong> simplified for v1 — morning shadow → west neighbor, afternoon shadow → east neighbor; north-south impact ignored. Proper sun-path math is deferred.
    </p>
  {/if}

{/if}

<!-- Equipment tab removed from /plan — equipment management still lives at /equipment in the top nav. -->

<!-- ────────────────────────── CALENDAR (grid view) ────────────────────────── -->
{#if data.tab === 'calendar' && data.view === 'grid'}
  <section class="card">
    <div class="calendar-toolbar">
      <!-- Match the swimlane's field-chip styling + position so flipping
           between views doesn't shuffle the filter affordance. -->
      {#if data.fields && data.fields.length > 0}
        <span class="filter-inline" role="group" aria-label="Field filter">
          <span class="filter-line">
            <span class="filter-label">Field:</span>
            <button
              type="button"
              class="chip-mini"
              class:active={!data.filterFieldId}
              onclick={() => changeCalendarFilter('', data.filterBlockId ?? '')}
              title="Show all fields"
            >All</button>
            {#each data.fields as f (f.id)}
              <button
                type="button"
                class="chip-mini"
                class:active={data.filterFieldId === f.id}
                onclick={() => changeCalendarFilter(f.id, '')}
                title="Field: {f.name}"
              >{f.name}</button>
            {/each}
          </span>
        </span>
      {:else}
        <span class="filter-inline" aria-hidden="true"></span>
      {/if}

      <nav class="month-nav" aria-label="Month navigation">
        {#if data.prev}
          <a href={calendarHref('grid') + '&ym=' + data.prev}>← Prev</a>
        {/if}
        <strong>{data.monthLabel}</strong>
        {#if data.next}
          <a href={calendarHref('grid') + '&ym=' + data.next}>Next →</a>
        {/if}
      </nav>
    </div>

    {#if data.eventCountTotal === 0}
      <p>Empty calendar. Add a crop to populate.</p>
    {:else}
      <div class="cal-grid" role="grid" aria-label={data.monthLabel}>
        {#each dayLabels as d (d)}
          <div class="day-label" role="columnheader">{d}</div>
        {/each}
        {#each data.calendarGrid ?? [] as cell (cell.iso)}
          <div
            class="cell"
            class:in-month={cell.inMonth}
            class:out-of-month={!cell.inMonth}
            class:today={cell.isToday}
            role="gridcell"
          >
            <div class="num">{dayNum(cell.iso)}</div>
            {#if cell.events.length > 0}
              <ul class="events">
                {#each cell.events.slice(0, 3) as e (e.kind + e.cropPluginId + e.startMs)}
                  <li class="event {e.kind}" title="{e.title} — {e.varietyDisplayName}">
                    <span class="dot" aria-hidden="true"></span>
                    <span class="label">{e.title}</span>
                  </li>
                {/each}
                {#if cell.events.length > 3}
                  <li class="event more">+{cell.events.length - 3} more</li>
                {/if}
              </ul>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>
{/if}

{#if advisor}
  <div
    class="advisor-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="advisor-title"
    onclick={(e) => e.target === e.currentTarget && dismissAdvisor()}
    onkeydown={(e) => e.key === 'Escape' && dismissAdvisor()}
    tabindex="-1"
  >
    <div class="advisor-modal">
      <h2 id="advisor-title">🌽 Companion Advisor</h2>
      {#each advisor.suggestions as s (s.systemName)}
        <div class="suggestion">
          <h3>Add {s.systemName} companions?</h3>
          <p class="benefit">{s.systemBenefit}</p>
          <ul class="members">
            {#each s.members as m (m.cropPluginId)}
              <li>
                <strong>{m.displayName}</strong>
                <span class="role">{m.role}</span>
                <span class="offset">+{m.plantingOffsetDays} days</span>
              </li>
            {/each}
          </ul>
          <div class="actions">
            <button
              type="button"
              class="primary"
              disabled={advisorBusy}
              onclick={() => acceptCompanions(s)}
            >
              {advisorBusy ? 'Adding…' : `Add all ${s.members.length} companions`}
            </button>
            <button type="button" onclick={dismissAdvisor}>No thanks</button>
          </div>
        </div>
      {/each}
    </div>
  </div>
{/if}

{#if wizardStep !== null}
  <div
    class="advisor-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="wizard-title"
    onclick={(e) => e.target === e.currentTarget && resetWizard()}
    onkeydown={(e) => e.key === 'Escape' && resetWizard()}
    tabindex="-1"
  >
    <div class="advisor-modal wizard-modal">
      {#if wizardStep === 'crop'}
        <h2 id="wizard-title">Generate Plan — Select Crop</h2>
        <label class="wizard-label">
          Crop
          <select bind:value={wCropId} class="wizard-select">
            <option value="">Choose…</option>
            {#each data.scheduleCatalog ?? [] as c (c.pluginId)}
              <option value={c.pluginId}>{c.displayName} ({c.cropFamily})</option>
            {/each}
          </select>
        </label>
        {#if wCropId && wMeta()}
          {@const m = wMeta()!}
          <dl class="wizard-meta">
            {#if m.daysToMaturity}<dt>Days to maturity</dt><dd>{m.daysToMaturity.min}–{m.daysToMaturity.max} d</dd>{/if}
            {#if m.preHarvestIntervalDays}<dt>Pre-harvest interval</dt><dd>{m.preHarvestIntervalDays} d</dd>{/if}
            {#if m.soilTempMinF !== undefined}<dt>Min soil temp</dt><dd>{m.soilTempMinF}°F</dd>{/if}
          </dl>
        {/if}
        <div class="actions">
          <button class="primary" disabled={!wCropId || !wMeta()?.daysToMaturity} onclick={() => { wizardStep = 'block'; }}>Next →</button>
          <button onclick={resetWizard}>Cancel</button>
        </div>

      {:else if wizardStep === 'block'}
        <h2 id="wizard-title">Generate Plan — Select Block</h2>
        <label class="wizard-label">
          Block
          <select bind:value={wBlockId} class="wizard-select">
            <option value="">Choose…</option>
            {#each data.blocks as b (b.id)}
              {@const bf = data.fields.find((f) => f.id === b.fieldId)}
              <option value={b.id}>{bf ? bf.name + ' › ' : ''}{b.name} [{b.tillageMethod}]</option>
            {/each}
          </select>
        </label>
        <div class="actions">
          <button class="primary" disabled={!wBlockId} onclick={() => { wizardStep = 'mode'; }}>Next →</button>
          <button onclick={() => { wizardStep = 'crop'; }}>← Back</button>
        </div>

      {:else if wizardStep === 'mode'}
        <h2 id="wizard-title">Generate Plan — Planning Mode</h2>
        <div class="mode-options">
          <label class="mode-option" class:selected={wMode === 'plant-on-date'}>
            <input type="radio" bind:group={wMode} value="plant-on-date" />
            <strong>Plant on date</strong>
            <span>Set a planting date; harvest window computed from DTM.</span>
          </label>
          <label class="mode-option" class:selected={wMode === 'harvest-by-date'}>
            <input type="radio" bind:group={wMode} value="harvest-by-date" />
            <strong>Harvest by date</strong>
            <span>Set a target harvest date; planting date back-computed from DTM.</span>
          </label>
          <label class="mode-option" class:selected={wMode === 'staggered'}>
            <input type="radio" bind:group={wMode} value="staggered" />
            <strong>Staggered harvest</strong>
            <span>Multiple successions spaced apart for continuous harvest.</span>
          </label>
          <label class="mode-option" class:selected={wMode === 'season-fill'}>
            <input type="radio" bind:group={wMode} value="season-fill" />
            <strong>Season fill</strong>
            <span>Auto-fill Apr 15–Oct 15 with back-to-back successions.</span>
          </label>
        </div>
        <div class="actions">
          <button class="primary" onclick={() => { wizardStep = 'params'; }}>Next →</button>
          <button onclick={() => { wizardStep = 'block'; }}>← Back</button>
        </div>

      {:else if wizardStep === 'params'}
        <h2 id="wizard-title">Generate Plan — Parameters</h2>
        {#if wMode === 'plant-on-date'}
          <label class="wizard-label">Planting date<input type="date" bind:value={wPlantDate} /></label>
        {:else if wMode === 'harvest-by-date'}
          <label class="wizard-label">Target harvest date<input type="date" bind:value={wHarvestDate} /></label>
        {:else if wMode === 'staggered'}
          <label class="wizard-label">First harvest date<input type="date" bind:value={wHarvestDate} /></label>
          <div class="param-row">
            <label class="wizard-label">Successions<input type="number" min="2" max="10" bind:value={wStaggerCount} /></label>
            <label class="wizard-label">Days apart<input type="number" min="7" max="90" bind:value={wIntervalDays} /></label>
          </div>
        {:else if wMode === 'season-fill'}
          <p class="wizard-hint">Frost window: Apr 15 – Oct 15 (Loudoun County, VA). Successions computed automatically.</p>
        {/if}
        <details class="wizard-advanced">
          <summary>Advanced options</summary>
          <label class="wizard-label" style="margin-top:0.5rem">PHI enforcement
            <select bind:value={wPhiMode}>
              <option value="strict">Strict (plugin PHI only)</option>
              <option value="conservative">Conservative (PHI + 7 day buffer)</option>
            </select>
          </label>
          {#if wMode === 'staggered' && wStaggerCount > 1}
            <label class="wizard-label">Block assignment
              <select bind:value={wBlockAssign}>
                <option value="single">All to selected block</option>
                <option value="round-robin">Round-robin across all blocks</option>
              </select>
            </label>
          {/if}
        </details>
        {@const canPreview = (wMode === 'plant-on-date' && !!wPlantDate) || (wMode === 'harvest-by-date' && !!wHarvestDate) || (wMode === 'staggered' && !!wHarvestDate) || wMode === 'season-fill'}
        <div class="actions">
          <button class="primary" disabled={!canPreview} onclick={() => { wizardStep = 'preview'; }}>Preview →</button>
          <button onclick={() => { wizardStep = 'mode'; }}>← Back</button>
        </div>

      {:else if wizardStep === 'preview'}
        <h2 id="wizard-title">Generate Plan — Preview</h2>
        {#if wPreviewRows.length === 0}
          <p class="wizard-hint">No successions could be computed. Check your crop and dates.</p>
        {:else}
          <p class="wizard-hint">{wPreviewRows.length} succession{wPreviewRows.length === 1 ? '' : 's'} planned.</p>
          <div class="preview-rows">
            {#each wPreviewRows as row, i (i)}
              <div class="preview-card" class:has-conflict={row.phiConflict || row.soilTooEarly}>
                <div class="preview-card-header">
                  <strong>Succession {i + 1}</strong>
                  <span class="sched-chip chip-plant">Plant {new Date(row.plantingDateMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  <span class="sched-chip chip-harvest">Harvest by {new Date(row.targetHarvestMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  {#if row.phiConflict}<span class="phi-badge">⚠ PHI conflict</span>{/if}
                  {#if row.soilTooEarly}<span class="warn">⚠ Soil may be cold</span>{/if}
                </div>
                {#if row.prepActivities.length > 0}
                  <ul class="prep-list compact">
                    {#each row.prepActivities as act (act.title)}
                      <li class="prep-item">
                        <span class="prep-dates">{new Date(act.startMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}–{new Date(act.endMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        <span class="prep-title">{act.title}</span>
                      </li>
                    {/each}
                  </ul>
                {/if}
                {#if sprayWindows(row.engineEvents).length > 0}
                  <ul class="sched-events">
                    {#each sprayWindows(row.engineEvents) as s (s.startMs)}
                      <li class="sched-event">
                        <span class="sched-dot spray-window"></span>
                        <span>{s.title}: {new Date(s.startMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}–{new Date(s.endMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
        <div class="actions">
          <button class="primary" disabled={wPreviewRows.length === 0} onclick={commitPlan}>Commit {wPreviewRows.length} planting{wPreviewRows.length === 1 ? '' : 's'}</button>
          <button onclick={() => { wizardStep = 'params'; }}>← Back</button>
          <button onclick={resetWizard}>Cancel</button>
        </div>

      {:else if wizardStep === 'committing'}
        <h2 id="wizard-title">Committing…</h2>
        {#if wBusy}<p class="wizard-hint">Saving plantings…</p>{/if}
        <ul class="commit-results">
          {#each wCommitResults as r, i (i)}
            <li class={r.ok ? 'result-ok' : 'result-warn'}>
              {r.ok ? '✓' : '✗'}
              {data.blocks.find((b) => b.id === r.blockId)?.name ?? r.blockId}
              — Plant {new Date(r.plantMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              {#if !r.ok && r.error}<span class="error"> ({r.error})</span>{/if}
            </li>
          {/each}
        </ul>

      {:else if wizardStep === 'done'}
        <h2 id="wizard-title">Plan Committed</h2>
        <p class="wizard-hint">
          {wCommitResults.filter((r) => r.ok).length} of {wCommitResults.length} planting{wCommitResults.length === 1 ? '' : 's'} saved.
        </p>
        <ul class="commit-results">
          {#each wCommitResults as r, i (i)}
            <li class={r.ok ? 'result-ok' : 'result-warn'}>
              {r.ok ? '✓' : '✗'}
              {data.blocks.find((b) => b.id === r.blockId)?.name ?? r.blockId}
              — Plant {new Date(r.plantMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              {#if !r.ok && r.error}<span class="error"> ({r.error})</span>{/if}
            </li>
          {/each}
        </ul>
        <div class="actions">
          <button class="primary" onclick={resetWizard}>Close</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .block-slope-hint {
    font-size: 0.75rem;
    color: #6b7280;
    margin: 0.25rem 0 0.5rem;
  }
  .shade-row .block-icon {
    font-size: 1rem;
  }
  .shade-row {
    background: rgba(134, 239, 172, 0.08);
  }
  .checkbox-line {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.4rem 0;
  }
  .nested-advanced {
    margin-top: 1rem;
    padding: 0.6rem 0.8rem;
    border-left: 3px solid #d1d5db;
    background: rgba(243, 244, 246, 0.5);
    border-radius: 0 0.25rem 0.25rem 0;
  }
  .nested-advanced > summary {
    cursor: pointer;
    font-weight: 600;
    color: #4b5563;
    font-size: 0.9rem;
  }
  h1 {
    margin: 0 0 0.25rem;
  }
  .lede {
    color: #555;
    margin: 0 0 1rem;
  }
  .plan-tabs {
    display: flex;
    align-items: stretch;
    gap: 0;
    /* Tightened top margin — the layout's main padding-block-start
     * already supplies a small breathing strip; the page H1 used to
     * occupy this space but is now sr-only. */
    margin: 0 0 1rem;
    border-bottom: 2px solid #1f5e3a;
    overflow-x: auto;
  }
  /* Calendar view toggle docked at the right edge of the tab row when
   * the Calendar tab is active. The divider provides visual separation
   * from the primary tabs so the toggle reads as a separate control. */
  .plan-tabs-divider {
    margin-left: auto;
    align-self: center;
    width: 1px;
    height: 1.5rem;
    background: #cbd5e1;
    margin-right: 0.6rem;
    flex: 0 0 auto;
  }
  .plan-tabs-view-toggle {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    align-self: center;
    padding: 0.2rem;
    background: #f4f6fa;
    border-radius: 8px;
    flex: 0 0 auto;
  }
  .plan-tabs-view-toggle .cv-link {
    padding: 0.35rem 0.7rem;
    font-size: 0.85rem;
    min-height: 30px;
    border-radius: 6px;
  }
  .plan-tabs a {
    padding: 0.75rem 1rem;
    text-decoration: none;
    color: #555;
    font-weight: 600;
    border-bottom: 4px solid transparent;
    margin-bottom: -2px;
    min-height: 60px;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    white-space: nowrap;
  }
  .plan-tabs a:hover {
    color: #1f5e3a;
    background: #f8fbf9;
  }
  .plan-tabs a.active {
    color: #1f5e3a;
    border-bottom-color: #1f5e3a;
  }
  .card {
    background: white;
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
    border-radius: 8px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .card h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    color: #1f5e3a;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .card h3 {
    font-size: 0.85rem;
    color: #555;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 1rem 0 0.5rem;
  }
  .role-notice {
    border-left: 4px solid #b35900;
    background: #fff8ec;
  }
  .empty {
    text-align: center;
    padding: 2rem;
    color: #555;
  }
  details.advanced {
    padding: 0.75rem 1rem;
  }
  details.advanced > summary {
    cursor: pointer;
    color: #1f5e3a;
    font-weight: 600;
    font-size: 0.95rem;
    padding: 0.5rem 0;
    list-style: revert;
  }
  details.advanced[open] > summary {
    margin-bottom: 0.5rem;
  }
  details.advanced .lede {
    margin: 0.25rem 0 0.75rem;
  }
  .empty-row {
    color: #888;
    font-style: italic;
    margin: 0.5rem 0;
  }
  .row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    align-items: stretch;
  }
  .row.inline {
    margin-top: 0.5rem;
  }
  .row select {
    flex: 1;
    padding: 0.6rem;
    border: 2px solid #d0d7d0;
    border-radius: 4px;
    font-size: 1rem;
    min-height: 48px;
  }
  .grid2 {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }
  .grid2 label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
  }
  .grid2 label.full {
    grid-column: 1 / -1;
  }
  .grid2 input,
  .grid2 select {
    padding: 0.6rem;
    border: 2px solid #d0d7d0;
    border-radius: 4px;
    min-height: 48px;
    font-size: 1rem;
  }
  .primary {
    background: #1f5e3a;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.75rem 1.25rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 48px;
  }
  .primary:disabled {
    background: #999;
    cursor: not-allowed;
  }
  .ghost {
    background: white;
    border: 1px solid #d0d7d0;
    color: #1f5e3a;
    padding: 0.4rem 0.6rem;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    min-height: 36px;
  }
  .delete-btn {
    background: transparent;
    border: 1px solid #d0d7d0;
    color: #b00020;
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
    min-height: 32px;
    min-width: 36px;
  }
  .delete-btn:hover {
    background: #fce4e4;
    border-color: #b00020;
  }
  .error {
    color: #b00020;
  }
  .success {
    background: #e7f1ea;
    color: #1f5e3a;
    padding: 0.6rem;
    border-radius: 4px;
    margin-top: 0.5rem;
  }

  /* Wizard */
  .wizard {
    border-left: 4px solid #1f5e3a;
    background: #f8fbf9;
  }

  /* Field cards */
  .field-card {
    border-left: 4px solid #1f5e3a;
  }
  .field-header {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 0.5rem;
  }
  .notes {
    color: #555;
    font-size: 0.9rem;
    margin: 0.25rem 0 0.5rem;
  }
  .inline-edit {
    background: #f8fbf9;
    border-radius: 6px;
    padding: 0.75rem;
    margin: 0.5rem 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .inline-edit label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
  }
  .inline-edit label.full {
    width: 100%;
  }
  .inline-edit input,
  .inline-edit select {
    padding: 0.5rem;
    border: 2px solid #d0d7d0;
    border-radius: 4px;
    min-height: 44px;
  }

  .block-list {
    list-style: none;
    padding: 0;
    margin: 0.5rem 0 0;
  }
  .add-block {
    margin-top: 0.5rem;
  }

  /* Layout (port from /map) */
  textarea {
    padding: 0.55rem;
    border: 2px solid #d0d7d0;
    border-radius: 4px;
    font-size: 0.95rem;
    font-family: ui-monospace, Menlo, Monaco, monospace;
    min-height: 96px;
    width: 100%;
    box-sizing: border-box;
  }
  .block-list-flat {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  /* Layout tab — field-grouped block list */
  .field-group { margin-bottom: 0.5rem; }

  .field-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.25rem 0.6rem;
    min-height: 32px;
    background: #eaf4ee;
    border-left: 4px solid #1f5e3a;
    border-radius: 0 6px 6px 0;
    margin-bottom: 0.1rem;
  }
  .field-row.field-drop-target {
    background: #dbeafe;
    border-left-color: #2563eb;
    box-shadow: inset 0 0 0 2px #2563eb;
  }
  .field-icon { font-size: 0.95rem; line-height: 1; }
  .field-name { color: #1f5e3a; font-size: 0.95rem; line-height: 1.15; }
  .field-stats { color: #4a7c5e; font-size: 0.8rem; flex: 1; line-height: 1.15; }
  .field-notes { margin: 0.15rem 0.6rem 0.3rem 2rem; color: #666; font-size: 0.8rem; }

  .row-action {
    background: none;
    border: none;
    padding: 0.15rem 0.3rem;
    cursor: pointer;
    font-size: 0.85rem;
    border-radius: 4px;
    min-height: 26px;
    min-width: 26px;
    color: #555;
  }
  .row-action:hover { background: rgba(0,0,0,0.06); }
  .row-action.danger { color: #b00020; }

  .inline-edit {
    background: #f7faf7;
    border: 1px solid #d0e8d4;
    border-radius: 6px;
    padding: 0.75rem;
    margin: 0.25rem 0 0.5rem;
  }
  .inline-edit-row { list-style: none; padding: 0; }

  .add-block-inline {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    padding: 0.3rem 0.6rem 0.4rem 1.5rem;
    border-top: 1px dashed #d0e8d4;
  }
  .add-block-inline input[type='text'] { flex: 1; min-width: 0; }
  .add-block-inline .acres-input { width: 5rem; }
  .small { padding: 0.4rem 0.7rem; font-size: 0.85rem; min-height: 36px; }

  .add-forms { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
  @media (max-width: 600px) { .add-forms { grid-template-columns: 1fr; } }
  .add-form-section { margin: 0.5rem 0; }

  .block-row {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
    padding: 0.2rem 0.5rem;
    min-height: 28px;
    border-top: 1.5px solid #ddeee1;
    border-left: 3px solid #b8d9c0;
    margin-left: 0.5rem;
    font-size: 0.85rem;
  }
  .layout-block-row { cursor: grab; user-select: none; }
  .layout-block-row:active { cursor: grabbing; }
  .layout-block-row.dragging { opacity: 0.4; }
  .layout-block-row.drop-target {
    background: #dbeafe;
    box-shadow: inset 3px 0 0 #2563eb;
  }
  .layout-block-row .grip {
    color: #94a3b8;
    font-weight: 700;
    letter-spacing: -2px;
    margin-right: 0.05rem;
    font-size: 0.85rem;
    flex-shrink: 0;
  }
  .ov-block-row {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.18rem;
    padding: 0.38rem 0.5rem 0.38rem 0.75rem;
    border-top: 1.5px solid #ddeee1;
    border-left: 3px solid #b8d9c0;
    margin-left: 0.5rem;
  }
  .block-summary-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .block-icon { color: #888; font-size: 0.75rem; }
  .block-name { font-weight: 500; font-size: 0.9rem; color: #333; }
  .block-stats { color: #666; font-size: 0.82rem; flex: 1; }
  .block-acres { color: #666; font-size: 0.82rem; }

  .plantings-tip {
    position: relative;
    cursor: help;
    text-decoration: underline dotted #aaa;
  }
  .plantings-tip::after {
    content: attr(data-tip);
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    background: #2d3e2d;
    color: #f0f0f0;
    padding: 0.3rem 0.6rem;
    border-radius: 5px;
    font-size: 0.75rem;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.12s;
    z-index: 100;
    line-height: 1.5;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }
  .plantings-tip:hover::after { opacity: 1; }
  .ov-planting-list {
    list-style: none;
    padding: 0;
    margin: 0 0 0 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .ov-planting-chip {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
  }
  .ov-crop-name { font-size: 0.82rem; color: #2d5a3d; }
  .ov-crop-date { font-size: 0.78rem; color: #6a8a75; }
  .not-drawn {
    display: inline-block;
    background: #fff3cd;
    color: #856404;
    font-size: 0.72rem;
    font-weight: 600;
    padding: 0.05rem 0.4rem;
    border-radius: 8px;
    margin-left: 0.25rem;
  }

  .geo-badge {
    font-size: 0.72rem;
    font-weight: 600;
    padding: 0.1rem 0.45rem;
    border-radius: 10px;
  }
  .geo-badge-field { background: #c8e6c9; color: #1a5c2e; }
  .geo-badge-none  { background: #f0f0f0; color: #777; }
  .no-geo { color: #999; font-style: italic; }
  .empty-row-indent {
    margin: 0.25rem 0 0.5rem 0.75rem;
    color: #777;
    font-size: 0.875rem;
  }
  .paste-mode-tabs {
    display: flex;
    gap: 0.25rem;
    margin-bottom: 1rem;
    border-bottom: 2px solid #e0e0e0;
  }
  .paste-mode-tabs button {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
    padding: 0.4rem 0.75rem;
    cursor: pointer;
    font-size: 0.9rem;
    color: #555;
  }
  .paste-mode-tabs button.active {
    border-bottom-color: #2e7d32;
    color: #2e7d32;
    font-weight: 600;
  }
  .example-collapse { margin: 0.5rem 0; }
  .example-collapse > summary { cursor: pointer; font-size: 0.85rem; color: #555; }
  .geojson-example {
    background: #f5f5f5;
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 0.75rem;
    font-size: 0.78rem;
    overflow-x: auto;
    white-space: pre;
  }
  .paste-results {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
    margin-top: 0.75rem;
  }
  .paste-results th, .paste-results td {
    text-align: left;
    padding: 0.3rem 0.5rem;
    border-bottom: 1px solid #eee;
  }
  .paste-results th { font-weight: 600; background: #f5f5f5; }
  .result-ok td { color: #1a5c2e; }
  .result-warn td { color: #8a4800; }
  .input-hint {
    display: block;
    font-size: 0.8rem;
    color: #777;
    margin-top: 0.2rem;
  }

  /* Crops tab */
  .crops-card { padding-bottom: 0.25rem; }

  .crop-block {
    border-top: 1.5px solid #ddeee1;
    border-left: 3px solid #b8d9c0;
    margin-left: 0.5rem;
  }
  .crop-block.dragging { opacity: 0.4; }
  .crop-block.drop-target {
    background: #f0f7ff;
    box-shadow: inset 0 3px 0 #2563eb;
  }
  .crop-block.seed-drop-target {
    background: #ecfdf5;
    box-shadow: inset 0 0 0 2px #10b981;
  }
  .crop-block.crop-drop-target {
    background: #fef3c7;
    box-shadow: inset 0 0 0 2px #f59e0b;
  }
  .crop-item {
    cursor: grab;
    user-select: none;
  }
  .crop-item:active { cursor: grabbing; }
  .crop-item.dragging { opacity: 0.4; }
  .crop-item .crop-item-row .grip {
    color: #cbd5cb;
    font-weight: 700;
    letter-spacing: -2px;
    margin-right: 0.1rem;
    font-size: 0.85rem;
  }
  .crops-tab-layout {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
  }
  .crops-tab-layout > .crops-card { flex: 1; min-width: 0; }
  .crops-seed-rail {
    width: 240px;
    flex-shrink: 0;
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 0.5rem;
    position: sticky;
    top: 0.5rem;
    max-height: calc(100vh - 1rem);
    overflow-y: auto;
  }
  .crops-seed-rail.return-target {
    background: #ecfeff;
    box-shadow: inset 0 0 0 2px #06b6d4;
  }
  .rail-drop-banner {
    margin: 0 0 0.5rem;
    padding: 0.45rem 0.5rem;
    border-radius: 4px;
    background: #cffafe;
    border-left: 3px solid #0891b2;
    font-size: 0.78rem;
    color: #155e75;
    font-weight: 500;
  }
  .crops-seed-rail h3 {
    margin: 0 0 0.5rem;
    font-size: 0.85rem;
    color: #1f5e3a;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .crops-seed-rail h3 .count { color: #6b7280; font-weight: 400; font-size: 0.75rem; }
  .seed-rail-empty { font-size: 0.8rem; color: #9ca3af; }
  .ai-allocate-btn {
    display: block;
    width: 100%;
    margin: 0.25rem 0 0.6rem;
    padding: 0.55rem 0.75rem;
    background: #1f5e3a;
    color: white;
    border: 1px solid #1f5e3a;
    border-radius: 6px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    text-align: center;
  }
  .ai-allocate-btn:hover { background: #1a4f31; }
  .seed-family { margin-bottom: 0.5rem; }
  .seed-family-head {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.75rem;
    color: #4a5d4a;
    text-transform: capitalize;
    padding: 0.2rem 0;
  }
  .seed-family-head .count { color: #9ca3af; font-size: 0.7rem; }
  .seed-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.3rem; }
  .seed-card {
    border: 1px solid #cbd5cb;
    border-left: 4px solid #1f5e3a;
    border-radius: 4px;
    background: #f0f7f3;
    padding: 0.4rem 0.5rem;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
    cursor: grab;
    user-select: none;
    min-height: 48px;
    text-align: left;
  }
  .seed-card:active { cursor: grabbing; }
  .seed-card.disabled { opacity: 0.5; cursor: not-allowed; background: #f3f4f6; border-left-color: #9ca3af; }
  .seed-card.empty { opacity: 0.45; background: #f3f4f6; border-left-color: #d1d5db; color: #6b7280; }
  .seed-card .seed-name { font-size: 0.85rem; font-weight: 500; align-self: stretch; text-align: left; }
  .seed-card .seed-meta { font-size: 0.7rem; color: #6b7280; align-self: stretch; text-align: left; }
  @media (max-width: 720px) {
    .crops-tab-layout { flex-direction: column; }
    .crops-seed-rail { width: 100%; position: static; max-height: 320px; }
  }
  .crop-block .block-row {
    border-top: none;
    margin-left: 0;
    cursor: grab;
    user-select: none;
  }
  .crop-block .block-row:active { cursor: grabbing; }
  .crop-block .block-row .grip {
    color: #94a3b8;
    font-weight: 700;
    letter-spacing: -2px;
    margin-right: 0.1rem;
  }
  .crop-add-btn {
    font-size: 0.8rem;
    color: #2a7849;
    border-color: #2a7849;
    padding: 0.15rem 0.5rem;
    min-height: 28px;
    min-width: unset;
  }

  .crop-list { list-style: none; padding: 0; margin: 0; }
  .crop-item { border-top: 1.5px solid #ddeee1; }
  .crop-item-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.15rem 0.5rem 0.15rem 0.75rem;
    min-height: 28px;
  }
  .crop-name-group { display: flex; align-items: center; gap: 0.3rem; flex: 1; min-width: 0; }
  .crop-family-emoji { font-size: 0.9rem; line-height: 1; flex-shrink: 0; }
  .crop-qty {
    font-size: 0.72rem;
    color: #4a5d4a;
    background: #e4eee6;
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .crop-name { color: #1f5e3a; text-decoration: none; font-size: 0.88rem; font-weight: 600; min-width: 0; min-height: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.3; }
  .crop-name:hover { text-decoration: underline; }
  .crop-date { color: #999; font-size: 0.75rem; white-space: nowrap; flex-shrink: 0; }

  .livestock-placeholder {
    border-left: 4px solid #a0724a;
    opacity: 0.75;
  }
  .livestock-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .livestock-icon { font-size: 1.3rem; }
  .livestock-title { margin: 0; font-size: 1rem; color: #6b4c2a; }
  .coming-soon-badge {
    background: #f0e4d4;
    color: #8a5a30;
    font-size: 0.72rem;
    font-weight: 700;
    padding: 0.1rem 0.5rem;
    border-radius: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .feature-note {
    font-size: 0.82rem;
    color: #888;
    margin-top: 0.5rem;
    border-top: 1px solid #eee;
    padding-top: 0.5rem;
  }
  .guide-tip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    position: relative;
    cursor: help;
    font-size: 0.82rem;
    color: #4a7c5e;
    background: none;
    border: none;
    border-bottom: 1px dotted #4a7c5e;
    padding: 0;
    min-height: 0;
    min-width: 0;
    font-family: inherit;
    line-height: 1;
  }
  .guide-tip::after {
    content: attr(data-tip);
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    min-width: 160px;
    background: #2d3e2d;
    color: #f0f0f0;
    padding: 0.3rem 0.6rem;
    border-radius: 5px;
    font-size: 0.72rem;
    white-space: pre-line;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.12s;
    z-index: 100;
    line-height: 1.55;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    text-align: left;
  }
  .guide-tip:hover::after { opacity: 1; }
  .guide-tip.open { color: #1f5e3a; border-bottom-color: #1f5e3a; font-weight: 600; }
  .guide-dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.15rem 0.6rem;
    margin: 0 0 0.25rem 0.75rem;
    font-size: 0.78rem;
    padding: 0.2rem 0;
  }
  .guide-dl dt { color: #888; }
  .guide-dl dd { margin: 0; color: #1f5e3a; font-weight: 600; }

  /* Equipment tab */
  .crop-header {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 0.5rem;
  }
  .crop-header h2 {
    margin: 0;
    text-transform: none;
    letter-spacing: normal;
    font-size: 1.1rem;
  }
  .crop-header h2 a {
    color: #1f5e3a;
    text-decoration: none;
  }
  .crop-header small {
    color: #666;
  }
  .bindings {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .bindings li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0 0.4rem 0.75rem;
    border-top: 1.5px solid #ddeee1;
    border-left: 3px solid #b8d9c0;
    margin-left: 0.5rem;
    flex-wrap: wrap;
  }
  .role-badge {
    background: #1f5e3a;
    color: white;
    padding: 0.1rem 0.5rem;
    border-radius: 3px;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
  }
  .eq-type {
    color: #666;
    font-size: 0.85rem;
  }
  .retired {
    color: #888;
    font-style: italic;
    font-size: 0.85rem;
  }
  .bindings .delete-btn {
    margin-left: auto;
  }
  .add-binding {
    margin-top: 0.75rem;
  }

  /* Soil-too-cold pill etc. — Stock-tab specific styles removed (tab now
     deep-links to /stock). */
  .warn {
    background: #fff3cd;
    color: #b35900;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.75rem;
    font-weight: 700;
  }

  /* Calendar tab */
  .calendar-view-toggle {
    display: flex;
    gap: 0.25rem;
    margin: 0 0 0.75rem;
    padding: 0.25rem;
    background: #f4f6fa;
    border-radius: 8px;
    width: fit-content;
  }
  .cv-link {
    padding: 0.45rem 0.9rem;
    border-radius: 6px;
    text-decoration: none;
    color: #466;
    font-weight: 500;
    min-height: 36px;
    display: inline-flex;
    align-items: center;
    cursor: pointer;
  }
  .cv-link:hover {
    background: #e6ebef;
  }
  .cv-link.cv-active {
    background: #1f5e3a;
    color: #fff;
    cursor: default;
  }
  .calendar-toolbar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
    flex-wrap: wrap;
  }
  .calendar-toolbar .filter-chips {
    flex: 1;
    min-width: 12rem;
  }
  .calendar-toolbar .month-nav {
    margin-left: auto;
  }
  .month-nav {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .month-nav a {
    color: #1f5e3a;
    text-decoration: none;
    font-weight: 600;
    padding: 0.5rem 0.75rem;
    border: 2px solid #1f5e3a;
    border-radius: 4px;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
  }
  .month-nav strong {
    font-size: 1.1rem;
    color: #1f5e3a;
  }
  .filter-chips {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
    align-items: center;
  }
  .chip-label {
    color: #555;
    font-weight: 600;
    font-size: 0.85rem;
  }
  .chip {
    background: white;
    border: 2px solid #d0d7d0;
    padding: 0.3rem 0.6rem;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    min-height: 36px;
    font-size: 0.85rem;
  }
  .chip.active {
    background: #1f5e3a;
    color: white;
    border-color: #1f5e3a;
  }
  .cal-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 1px;
    background: #d0d7d0;
    border: 1px solid #d0d7d0;
    border-radius: 6px;
    overflow: hidden;
  }
  .day-label {
    background: #1f5e3a;
    color: white;
    padding: 0.4rem;
    text-align: center;
    font-weight: 600;
    font-size: 0.8rem;
  }
  .cell {
    background: white;
    min-height: 80px;
    padding: 0.3rem;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    overflow: hidden;
  }
  .cell.out-of-month {
    background: #f5f7f4;
    color: #aaa;
  }
  .cell.today {
    background: #fffceb;
    box-shadow: inset 0 0 0 2px #ffd400;
  }
  .num {
    font-size: 0.8rem;
    color: #555;
    font-weight: 600;
  }
  .events {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .event {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.65rem;
    color: #333;
    line-height: 1.2;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .event .label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .event.more {
    color: #888;
    font-style: italic;
  }
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .planting .dot {
    background: #1f5e3a;
  }
  .emergence .dot {
    background: #4d8e36;
  }
  .spray-window .dot {
    background: #b35900;
  }
  .companion-trigger .dot {
    background: #6b3fa0;
  }
  .harvest-window .dot {
    background: #c2185b;
  }
  .orchard-task .dot {
    background: #c45a00;
  }
  .curing-progress .dot {
    background: #d4a017;
  }
  .curing-ready .dot {
    background: #2e7d32;
  }
  .cover-termination .dot {
    background: #777;
  }

  /* Companion Advisor */
  .advisor-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }
  .advisor-modal {
    background: white;
    border-radius: 8px;
    padding: 1.5rem;
    max-width: 540px;
    width: 100%;
    border-top: 6px solid #1f5e3a;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  }
  .advisor-modal h2 {
    margin: 0 0 1rem;
    color: #1f5e3a;
    font-size: 1.3rem;
  }
  .suggestion h3 {
    margin: 0 0 0.5rem;
    color: #1f5e3a;
  }
  .benefit {
    color: #555;
    font-size: 0.9rem;
    margin: 0 0 1rem;
    line-height: 1.5;
  }
  .members {
    list-style: none;
    padding: 0;
    margin: 0 0 1rem;
  }
  .members li {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: #f8fbf9;
    border-radius: 4px;
    margin-bottom: 0.4rem;
    align-items: center;
  }
  .members .role {
    font-size: 0.8rem;
    color: #666;
  }
  .members .offset {
    font-family: monospace;
    color: #1f5e3a;
    font-weight: 700;
    background: white;
    padding: 0.1rem 0.5rem;
    border-radius: 3px;
  }
  .advisor-modal .actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .advisor-modal .actions button {
    flex: 1 1 auto;
    padding: 0.9rem;
    border-radius: 6px;
    border: 2px solid #1f5e3a;
    background: white;
    color: #1f5e3a;
    font-weight: 600;
    cursor: pointer;
    min-height: 56px;
  }
  .advisor-modal .actions .primary {
    background: #1f5e3a;
    color: white;
  }

  /* Overview tab — Season Setup as stage 1 of the planning flow. */
  .season-card {
    border-left: 4px solid #1f5e3a;
    background: linear-gradient(180deg, #f8fbf9 0%, #ffffff 100%);
  }
  .season-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
    margin-bottom: 0.75rem;
  }
  .season-headline {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }
  .season-year {
    font-size: 1.6rem;
    font-weight: 700;
    color: #1f5e3a;
    line-height: 1;
  }
  .season-title {
    font-size: 1rem;
    color: #4a5a4a;
  }
  .stage-pill {
    background: #1f5e3a;
    color: white;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.3rem 0.6rem;
    border-radius: 999px;
  }
  .season-chip-row {
    margin-top: 0.75rem;
  }
  .season-summary {
    margin: 0 0 0.5rem;
    padding: 0;
    display: grid;
    grid-template-columns: minmax(180px, max-content) 1fr;
    column-gap: 1rem;
    row-gap: 0.4rem;
  }
  .season-row {
    display: contents;
  }
  .season-row dt {
    color: #4a5a4a;
    font-weight: 600;
    font-size: 0.88rem;
    line-height: 1.4;
    padding-top: 2px;
  }
  .season-row dd {
    margin: 0;
    color: #1a1a1a;
    font-size: 0.95rem;
    line-height: 1.4;
  }
  .season-meta-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px dashed #e4e9e4;
  }
  .season-meta {
    color: #6a7d6a;
    font-size: 0.82rem;
  }
  .edit-season-btn {
    min-height: 36px;
    padding: 0.35rem 0.85rem;
    background: white;
    color: #1f5e3a;
    border: 1px solid #1f5e3a;
    border-radius: 6px;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .edit-season-btn:hover {
    background: #1f5e3a;
    color: white;
  }
  .edit-season-btn:focus-visible {
    outline: 2px solid #1f5e3a;
    outline-offset: 2px;
  }
  .stage-cta-row {
    margin-top: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding-top: 0.75rem;
    border-top: 1px solid #e4e9e4;
  }
  .stage-helper {
    margin: 0;
    color: #4a5a4a;
    font-size: 0.95rem;
    line-height: 1.45;
  }
  .next-stage-btn {
    align-self: flex-start;
    min-height: 48px;
    padding: 0.6rem 1.25rem;
    background: #1f5e3a;
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 700;
    font-size: 0.95rem;
    text-decoration: none;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
  }
  .next-stage-btn:hover {
    background: #174a2c;
  }
  .next-stage-btn:focus-visible {
    outline: 2px solid #1f5e3a;
    outline-offset: 2px;
  }
  .cancel-edit-link {
    background: none;
    border: none;
    color: #1f5e3a;
    font-size: 0.9rem;
    text-decoration: underline;
    cursor: pointer;
    padding: 0;
  }

  /* Overview tab */
  .overview-stats {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 1rem;
  }
  .stat-box {
    flex: 1;
    min-width: 80px;
    background: #f0f7f2;
    border-left: 4px solid #2a7849;
    border-radius: 0 6px 6px 0;
    padding: 0.6rem 1rem;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.15rem;
  }
  .stat-num { font-size: 1.75rem; font-weight: 700; color: #1f5e3a; line-height: 1; }
  .stat-label { font-size: 0.75rem; color: #555; text-transform: uppercase; letter-spacing: 0.04em; }

  /* Schedule tab */
  .schedule-header-card .schedule-action-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
    min-height: 44px;
  }
  /* Three-section layout: filters left, selection-actions middle
   * (pinned right via margin-left: auto on .action-middle), Optimize
   * stack rightmost. Both middle + right end up bunched on the right
   * so the operator's gaze lands in one place; the filter group is
   * anchored on the left. Vertical-rule .action-divider separates
   * each section so they read as distinct groups. */
  .action-middle {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
    margin-left: auto;
    align-self: center;
  }
  /* Optimize + Clear stack — same overall height as the Field/Blocks
   * filter pair on the left so the whole row reads as a balanced
   * strip. Vertical rhythm is tight: button + link sit flush with
   * just enough air for the underline. */
  .action-right {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: center;
    gap: 0.05rem;
    min-width: 9.5rem;
    line-height: 1.1;
    align-self: center;
  }
  .action-right .action-btn {
    text-align: center;
  }
  .action-link-under {
    align-self: center;
    padding: 0 0.3rem;
    line-height: 1;
    font-size: 0.75rem;
  }
  /* Vertical separator between action-row sections. */
  .action-divider {
    width: 1px;
    height: 32px;
    background: #d4d4d8;
    flex: 0 0 1px;
    align-self: center;
  }
  /* Tight button variant for the middle (selection-action) group and
   * the Optimize stack — slimmer padding + smaller font so the whole
   * row fits inside the height of the Field/Blocks filter on the left. */
  .action-btn-tight {
    padding: 0.25rem 0.6rem;
    font-size: 0.82rem;
    min-height: 28px;
  }
  .action-counter {
    font-weight: 600;
    color: #312e81;
    font-size: 0.82rem;
    padding-right: 0.15rem;
  }
  .action-hint {
    color: #6b7280;
    font-size: 0.85rem;
  }
  .action-btn {
    padding: 0.5rem 0.9rem;
    border-radius: 0.35rem;
    border: 1px solid #c7d2fe;
    background: #fff;
    color: #4338ca;
    font-weight: 600;
    font-size: 0.88rem;
    cursor: pointer;
    min-height: 40px;
  }
  /** Tighter variant for the per-bar quick actions (Edit + Split…)
   *  so the selection action row stays compact when a single bar is
   *  picked. The bigger .action-btn footprint stays on the
   *  multi-select destructive actions where the hit target matters. */
  .action-btn-compact {
    padding: 0.3rem 0.65rem;
    font-size: 0.82rem;
    min-height: 32px;
  }
  .action-btn:hover { background: #eef2ff; }
  .action-btn-primary {
    background: #4338ca;
    border-color: #312e81;
    color: #fff;
  }
  .action-btn-primary:hover { background: #312e81; }
  .action-btn-danger {
    background: #fff;
    border-color: #fecaca;
    color: #b91c1c;
  }
  .action-btn-danger:hover { background: #fee2e2; }
  .action-btn-cancel {
    background: transparent;
    border-color: #cbd5e1;
    color: #475569;
    font-weight: 500;
  }
  .action-spacer { flex: 1 1 auto; }
  .action-link {
    background: transparent;
    border: none;
    color: #6b7280;
    font-size: 0.78rem;
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
    min-height: 28px;
  }
  .action-link:hover { color: #b91c1c; }
  .action-link:disabled { opacity: 0.5; cursor: not-allowed; text-decoration: none; }
  .auto-run-banner {
    margin-top: 0.5rem;
    padding: 0.45rem 0.7rem;
    border-radius: 0.3rem;
    background: #ecfdf5;
    color: #065f46;
    font-size: 0.85rem;
    border: 1px solid #a7f3d0;
  }
  /* Phase 15d — compact inline filter chips in the schedule action row. */
  .filter-divider {
    width: 1px;
    align-self: stretch;
    background: #e2e8f0;
    margin: 0 0.15rem;
  }
  .filter-inline {
    display: inline-flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .filter-line {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.2rem;
  }
  .filter-label {
    font-size: 0.7rem;
    color: #475569;
    font-weight: 600;
    min-width: 42px;
    margin-right: 0.1rem;
  }
  .chip-mini {
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    border: 1px solid #cbd5e1;
    background: #fff;
    color: #475569;
    font-size: 0.7rem;
    line-height: 1.2;
    cursor: pointer;
    min-height: 22px;
  }
  .chip-mini:hover { background: #f1f5f9; }
  .chip-mini.active {
    background: #4338ca;
    border-color: #312e81;
    color: #fff;
  }
  .chip-mini-block.active {
    background: #1f5e3a;
    border-color: #14532d;
    color: #fff;
  }
  .sched-block {
    border-top: 1.5px solid #ddeee1;
    border-left: 3px solid #b8d9c0;
    margin-left: 0.5rem;
    padding: 0.5rem 0 0.5rem 0.75rem;
  }
  .sched-block-header {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.2rem 0;
    margin-bottom: 0.25rem;
  }
  .sched-block-name { font-weight: 600; font-size: 0.9rem; color: #333; }
  .tillage-badge {
    font-size: 0.68rem;
    font-weight: 700;
    padding: 0.1rem 0.5rem;
    border-radius: 8px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .tillage-conventional { background: #e3f2fd; color: #0d4780; }
  .tillage-reduced-till { background: #fff3e0; color: #7c4400; }
  .tillage-no-till      { background: #e8f5e9; color: #1b5e20; }

  .sched-planting { padding: 0.3rem 0 0.3rem 0.75rem; border-top: 1.5px solid #ddeee1; }
  .sched-planting-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
  }
  .sched-crop-name { color: #1f5e3a; text-decoration: none; font-weight: 600; font-size: 0.88rem; }
  .sched-crop-name:hover { text-decoration: underline; }
  .sched-chip {
    font-size: 0.72rem;
    font-weight: 600;
    padding: 0.1rem 0.5rem;
    border-radius: 8px;
    white-space: nowrap;
  }
  .chip-plant   { background: #e8f5e9; color: #1b5e20; }
  .chip-harvest { background: #fce4ec; color: #880e4f; }
  .phi-badge {
    background: #fff3cd;
    color: #7c4400;
    font-size: 0.72rem;
    font-weight: 700;
    padding: 0.1rem 0.5rem;
    border-radius: 8px;
  }
  .sched-events {
    list-style: none;
    padding: 0 0 0 0.5rem;
    margin: 0.2rem 0;
  }
  .sched-event {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.77rem;
    color: #555;
    padding: 0.1rem 0;
  }
  .sched-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .sched-dot.spray-window { background: #b35900; }

  /* Plan wizard */
  .wizard-modal { max-width: 600px; }
  .wizard-modal .wizard-label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.9rem;
    font-weight: 600;
    margin-bottom: 0.75rem;
  }
  .wizard-select,
  .wizard-modal input[type='date'],
  .wizard-modal input[type='number'],
  .wizard-modal .wizard-label select {
    width: 100%;
    padding: 0.6rem;
    border: 2px solid #d0d7d0;
    border-radius: 4px;
    font-size: 1rem;
    min-height: 48px;
    box-sizing: border-box;
    font-family: inherit;
  }
  .wizard-meta {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.2rem 0.6rem;
    font-size: 0.85rem;
    margin: 0.75rem 0;
  }
  .wizard-meta dt { color: #888; }
  .wizard-meta dd { margin: 0; color: #1f5e3a; font-weight: 600; }

  .mode-options { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 1rem; }
  .mode-option {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: auto auto;
    gap: 0.1rem 0.5rem;
    align-items: center;
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    border: 2px solid #d0d7d0;
    cursor: pointer;
  }
  .mode-option.selected { border-color: #1f5e3a; background: #f8fbf9; }
  .mode-option input[type='radio'] { grid-row: 1 / 3; align-self: center; width: 18px; height: 18px; }
  .mode-option strong { font-size: 0.9rem; color: #222; }
  .mode-option span   { font-size: 0.8rem; color: #666; }

  .param-row { display: flex; gap: 0.75rem; flex-wrap: wrap; }
  .param-row .wizard-label { flex: 1; min-width: 120px; }
  .wizard-hint { color: #555; font-size: 0.88rem; margin: 0.5rem 0 1rem; }
  .wizard-advanced {
    margin: 0.5rem 0 1rem;
    font-size: 0.85rem;
  }
  .wizard-advanced > summary { cursor: pointer; color: #555; padding: 0.25rem 0; list-style: revert; }

  .preview-rows {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 0.5rem 0 1rem;
    max-height: 360px;
    overflow-y: auto;
  }
  .preview-card {
    border: 1px solid #d0e8d4;
    border-radius: 6px;
    padding: 0.6rem 0.75rem;
    background: #fafffe;
  }
  .preview-card.has-conflict { border-color: #f5c518; background: #fffef5; }
  .preview-card-header {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-bottom: 0.35rem;
  }
  .preview-card-header strong { font-size: 0.85rem; }

  .commit-results {
    list-style: none;
    padding: 0;
    margin: 0.5rem 0;
    font-size: 0.9rem;
  }
  .commit-results li { padding: 0.3rem 0; border-top: 1px solid #eee; }
  .commit-results .result-ok   { color: #1a5c2e; }
  .commit-results .result-warn { color: #8a4800; }

  /* Phase 14 swim-lane layout */
  .swim-grid {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
  }
  .swim-pane {
    flex: 1 1 auto;
    min-width: 0;
  }
  .palette-pane {
    flex: 0 0 280px;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .schedule-cta {
    border: 1px dashed #c7d2fe;
    background: #f5f3ff;
    border-radius: 0.4rem;
    padding: 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    align-items: center;
  }
  .cta-text {
    margin: 0;
    font-size: 0.8rem;
    color: #4338ca;
    font-weight: 500;
  }
  .cta-btn {
    width: 100%;
    padding: 0.5rem 0.7rem;
    border-radius: 0.3rem;
    border: 1px solid #4338ca;
    background: #4338ca;
    color: #fff;
    font-weight: 600;
    cursor: pointer;
    min-height: 40px;
  }
  @media (max-width: 720px) {
    .swim-grid {
      flex-direction: column;
    }
    .palette-pane {
      flex: 1 1 auto;
      width: 100%;
    }
  }
  .ai-spend-banner {
    margin-top: 0.5rem;
    padding: 0.4rem 0.6rem;
    border-radius: 0.25rem;
    background: #ecfdf5;
    color: #065f46;
    font-size: 0.85rem;
  }
  .ai-spend-banner.warn {
    background: #fef3c7;
    color: #92400e;
  }
  .shade-footnote {
    font-size: 0.75rem;
    color: #6b7280;
    margin-top: 0.5rem;
  }
  .seed-plan-summary {
    margin-top: 0.75rem;
    padding: 0.75rem;
    border: 1px solid #cbd5cb;
    border-radius: 6px;
    background: #f8fbf9;
    width: 240px;
  }
  .pending-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .pending-row {
    border-left: 3px solid #1f5e3a;
    padding: 0.4rem 0.5rem;
    background: white;
    border-radius: 4px;
    font-size: 0.8rem;
  }
  .pending-row.unplaced { border-left-color: #d97706; background: #fef3c7; }
  .pending-head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .pending-qty { color: #6b7280; font-size: 0.7rem; }
  .pending-remove {
    margin-left: auto;
    background: none;
    border: 0;
    color: #6b7280;
    cursor: pointer;
    min-width: 32px;
    min-height: 32px;
  }
  .pending-assn {
    list-style: none;
    padding: 0;
    margin: 0.25rem 0 0;
    font-size: 0.75rem;
    color: #4a5d4a;
  }
  .pending-reason {
    margin-top: 0.25rem;
    font-size: 0.75rem;
    color: #92400e;
  }
  .seed-plan-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.5rem;
  }
  .commit-btn {
    min-height: 40px;
    padding: 0 1rem;
    border-radius: 6px;
    border: 0;
    background: #1f5e3a;
    color: white;
    font-weight: 600;
    cursor: pointer;
  }
  .commit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  /* Phase 15c — bar edit + delete modals. */
  .bar-edit-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 60;
  }
  .bar-edit {
    background: #fff;
    border-radius: 0.5rem;
    width: min(480px, 92vw);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
    display: flex;
    flex-direction: column;
  }
  .bar-edit-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.7rem 1rem;
    border-bottom: 1px solid #e5e7eb;
  }
  .bar-edit-head h3 { margin: 0; font-size: 1rem; }
  .bar-edit-head .close {
    background: transparent;
    border: none;
    font-size: 1.4rem;
    cursor: pointer;
    line-height: 1;
  }
  .bar-edit-body {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }
  .bar-edit-body label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
  }
  .bar-edit-body .field-hint {
    color: #6b7280;
    font-size: 0.72rem;
    line-height: 1.2;
    font-weight: 400;
  }
  .bar-edit-body input {
    padding: 0.45rem 0.55rem;
    border: 1px solid #cbd5e1;
    border-radius: 0.25rem;
    min-height: 40px;
    font-size: 0.9rem;
  }
  .qty-row { display: flex; gap: 0.5rem; }
  .qty-unit-readonly {
    background: #f4f4f5;
    color: #525252;
    cursor: not-allowed;
  }
  .harvest-uses {
    margin-top: 1rem;
    padding: 0.75rem;
    border: 1px solid #d4d4d8;
    border-radius: 6px;
  }
  .harvest-uses legend {
    padding: 0 0.4rem;
    font-weight: 600;
    color: #1f5e3a;
    font-size: 0.95rem;
  }
  .hint-tight {
    margin-top: 0.25rem;
    margin-bottom: 0.5rem;
  }
  .harvest-use-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .harvest-use-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.6rem;
    border-radius: 999px;
    background: #f4f6fa;
    font-size: 0.85rem;
    text-transform: capitalize;
    cursor: pointer;
    user-select: none;
  }
  .harvest-use-pill input[type='checkbox'] {
    margin: 0;
  }
  .harvest-use-pill:hover {
    background: #e6ebef;
  }
  .qty-row .qty-amount { flex: 2; }
  .qty-row .qty-unit { flex: 1; }
  /** Split-popup compact modal — narrower than the edit modal since
   *  it only carries a single number input. Same backdrop, smaller
   *  card. */
  .bar-edit-compact {
    max-width: 360px;
  }
  .split-count {
    display: flex;
    flex-direction: column;
    font-size: 0.85rem;
    color: #555;
  }
  .split-count input {
    width: 6rem;
    padding: 0.5rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-size: 1.05rem;
    margin-top: 0.25rem;
  }
  .bar-edit-body .hint {
    margin: 0;
    font-size: 0.78rem;
    color: #6b7280;
  }
  .bar-edit-error {
    margin: 0;
    padding: 0.5rem 0.7rem;
    background: #fef2f2;
    color: #b91c1c;
    border: 1px solid #fecaca;
    border-radius: 0.3rem;
    font-size: 0.85rem;
  }
  .delete-list {
    margin: 0;
    padding-left: 1.2rem;
    font-size: 0.85rem;
    max-height: 220px;
    overflow-y: auto;
  }
  .bar-edit-foot {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding: 0.7rem 1rem;
    border-top: 1px solid #e5e7eb;
    background: #f9fafb;
    border-bottom-left-radius: 0.5rem;
    border-bottom-right-radius: 0.5rem;
  }
  .bar-edit-foot .btn-primary,
  .bar-edit-foot .btn-secondary {
    padding: 0.5rem 1rem;
    border-radius: 0.3rem;
    cursor: pointer;
    min-height: 40px;
    font-weight: 600;
    font-size: 0.88rem;
  }
  .bar-edit-foot .btn-primary { background: #4338ca; color: #fff; border: 1px solid #312e81; }
  .bar-edit-foot .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .bar-edit-foot .btn-secondary { background: #fff; color: #4338ca; border: 1px solid #c7d2fe; }
  .bar-edit-foot .btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
