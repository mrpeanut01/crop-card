<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { ALL_STOCK_UNITS, type StockUnit } from '$lib/stock/units';
  import BarcodeScanner from '$lib/components/BarcodeScanner.svelte';
  import LabelCapture from '$lib/components/LabelCapture.svelte';
  import type { StockItemWithBalance } from '$lib/db/stock';
  import type { TaxonomyTerm } from '$lib/db/taxonomy';

  export type InventoryViewItem = StockItemWithBalance & {
    typeId?: string | null;
    typeName?: string;
  };

  export interface InventoryViewData {
    items: InventoryViewItem[];
    catalogPlugins: Array<{
      pluginId: string;
      displayName: string;
      category: string;
      meta: Record<string, unknown>;
    }>;
    taxonomy: TaxonomyTerm[];
    canEdit: boolean;
  }

  let { data }: { data: InventoryViewData } = $props();

  type Category = 'herbicide' | 'insecticide' | 'fungicide' | 'fertilizer' | 'seed' | 'adjuvant' | 'fuel' | 'part';
  const allCategories: Category[] = ['herbicide','insecticide','fungicide','fertilizer','seed','adjuvant','fuel','part'];

  const CATEGORY_ICON: Record<Category, string> = {
    seed: '🌱', herbicide: '🧪', insecticide: '🐛', fungicide: '🍄',
    fertilizer: '🌿', adjuvant: '💧', fuel: '⛽', part: '🔧'
  };

  /** Icon per taxonomy Type name. Mirrors the FAMILY_ICON in CropPalette
   *  but keyed by the human-readable Type label so we can paint it in front
   *  of subcat headers like "Corn" / "Cucurbits" on the inventory list. */
  const TYPE_ICON: Record<string, string> = {
    Corn: '🌽',
    Cucurbits: '🎃',
    Brassicas: '🥦',
    Alliums: '🧅',
    'Leafy greens': '🥬',
    'Root crops': '🥕',
    Apiaceae: '🥕',
    Solanaceae: '🍅',
    'Cereal grain': '🌾',
    Forage: '🌾',
    'Culinary herbs': '🌿',
    Legumes: '🫘',
    'Cover crop — grass': '🌿',
    'Cover crop — legume': '🌿',
    'Stone fruit': '🍑',
    'Vine fruit': '🍇',
    Brambles: '🫐',
    'Small fruit': '🍓',
    Orchard: '🍎',
    'Broadleaf companion': '🌸',
    // Common non-seed types so the subcat headers look consistent.
    Burndown: '☠️',
    'Pre-emergent': '🌱',
    'Post-emergent': '🌿',
    Selective: '🎯',
    Contact: '✋',
    Systemic: '💉',
    'Bt / biological': '🦠',
    Protectant: '🛡️',
    Granular: '⚪',
    Liquid: '💧',
    'Compost / manure': '🍂'
  };

  // ─── Search + accordion ──────────────────────────────────────────────────
  let searchQuery = $state('');
  let openCategories = $state(new Set<string>(allCategories));
  let closedSubcats = $state(new Set<string>());

  function toggleCategory(cat: string) {
    const next = new Set(openCategories);
    if (next.has(cat)) next.delete(cat); else next.add(cat);
    openCategories = next;
  }

  function isSubcatOpen(key: string) { return !closedSubcats.has(key); }

  function toggleSubcat(key: string) {
    const next = new Set(closedSubcats);
    if (next.has(key)) next.delete(key); else next.add(key);
    closedSubcats = next;
  }

  function groupItemsByType(items: typeof data.items) {
    const groups = new Map<string, { typeName: string; items: typeof data.items }>();
    for (const it of items) {
      const key = it.typeId ?? '_other';
      const label = it.typeName ?? 'Other / unclassified';
      const bucket = groups.get(key) ?? { typeName: label, items: [] };
      bucket.items.push(it);
      groups.set(key, bucket);
    }
    return [...groups.entries()]
      .map(([key, bucket]) => ({ key, typeName: bucket.typeName, items: bucket.items }))
      .sort((a, b) => {
        if (a.key === '_other') return 1;
        if (b.key === '_other') return -1;
        return a.typeName.localeCompare(b.typeName);
      });
  }

  function typesForCategory(cat: Category) {
    const domain = `inventory:${cat}`;
    return data.taxonomy.filter((t) => t.domain === domain);
  }

  const lowItems = $derived(data.items.filter((i) => i.isLow));

  const searchFiltered = $derived(
    searchQuery.trim()
      ? data.items.filter((i) => i.displayName.toLowerCase().includes(searchQuery.trim().toLowerCase()))
      : data.items
  );

  function itemsForCategory(cat: Category) {
    return searchFiltered.filter((i) => i.category === cat);
  }

  function itemSubtitle(item: typeof data.items[0]): string {
    if (item.category === 'seed' && item.metadataJson) {
      try {
        const m = JSON.parse(item.metadataJson);
        const parts: string[] = [];
        if (m.daysToMaturity) parts.push(`${m.daysToMaturity} DTM`);
        if (m.sunRequirement) parts.push((m.sunRequirement as string).replace(/-/g, ' '));
        return parts.join(' · ');
      } catch { /* fall through */ }
    }
    return item.notes ? item.notes.slice(0, 60) : '';
  }

  // ─── Scan state ──────────────────────────────────────────────────────────
  let scannerOpen = $state(false);
  let labelCaptureOpen = $state(false);
  let scanLoading = $state(false);
  let scanSource = $state<'openfoodfacts' | 'claude' | 'claude-vision' | 'none' | null>(null);
  let scanError = $state<string | null>(null);
  let guessedFields = $state(new Set<string>());
  // Phase 17 (Track 2) — AI-extracted formulation data captured by the
  // label scan. Persisted to stockItems.{activeIngredientsJson,formulationJson}
  // on save, after the operator confirms the form.
  let scannedActiveIngredients = $state<unknown[] | null>(null);
  let scannedFormulation = $state<Record<string, unknown> | null>(null);
  // Phase 17 follow-up — track explicit operator intent to CLEAR loaded data.
  // Without this, "Discard" only nulls local state and saveEdit's "send only
  // when non-empty" rule treats it as no-change → existing DB value survives.
  let activeIngredientsCleared = $state(false);
  let formulationCleared = $state(false);

  function isGuessed(field: string) { return guessedFields.has(field); }

  function hasScannedFormulationData(): boolean {
    return (scannedActiveIngredients?.length ?? 0) > 0 || scannedFormulation !== null;
  }

  function applyScanResult(result: Record<string, unknown>) {
    if (result.displayName) newDisplayName = result.displayName as string;
    if (result.shortName) newShortName = result.shortName as string;
    if (result.category) newCategory = result.category as Category;
    if (result.defaultUnit) newDefaultUnit = result.defaultUnit as StockUnit;
    // Reorder level stays off by default — pre-fill the suggested threshold
    // so flipping the toggle on shows a sensible number, but don't auto-enable.
    if (result.reorderThreshold != null) newReorder = result.reorderThreshold as number;
    if (result.notes) newNotes = result.notes as string;
    const m = result.seedMeta as Record<string, unknown> | undefined;
    if (m) {
      if (m.daysToMaturity != null) newDtm = m.daysToMaturity as number;
      if (m.plantingTempMinF != null) newTempMin = m.plantingTempMinF as number;
      if (m.plantingTempMaxF != null) newTempMax = m.plantingTempMaxF as number;
      if (m.spacingInches != null) newSpacing = m.spacingInches as number;
      if (m.depthInches != null) newDepth = m.depthInches as number;
      if (m.sunRequirement) newSun = m.sunRequirement as string;
      if (m.seedsPerPacket != null) newSeedsPerPacket = m.seedsPerPacket as number;
    }
    // Package quantity from the label drives Initial qty. Fall back to
    // seedsPerPacket for seeds when packageQuantity wasn't read directly.
    const pkgQty = (result.packageQuantity as number | undefined)
      ?? (m?.seedsPerPacket as number | undefined);
    if (pkgQty != null && pkgQty > 0) newInitialQty = pkgQty;
    // Phase 17 (Track 2) — capture AI-extracted formulation data; surface
    // a read-only summary in the form (block below) and persist to the
    // new stockItems columns on save.
    scannedActiveIngredients = Array.isArray(result.activeIngredients)
      ? (result.activeIngredients as unknown[])
      : null;
    scannedFormulation =
      result.formulation && typeof result.formulation === 'object'
        ? (result.formulation as Record<string, unknown>)
        : null;
    guessedFields = new Set(Array.isArray(result.guessed) ? (result.guessed as string[]) : []);
    const matches = (result.cropPluginMatches ?? []) as Array<{ pluginId: string; displayName: string; score: number }>;
    cropPluginMatches = matches;
    // Only auto-link when the top match is high confidence. Below that, show
    // the suggestion dropdown but let the user pick — fuzzy token overlap
    // can match unrelated cultivars (e.g., "Oxacana Green Dent" → "Bloody
    // Butcher Dent Corn" both share "dent" + "corn", score 0.5).
    if (matches.length > 0 && matches[0].score >= 0.75) newPluginId = matches[0].pluginId;
    // When auto-linked, derive Type from the linked plugin's cropFamily —
    // it's authoritative. Otherwise fall back to Claude's free-text guess.
    const linked = newPluginId
      ? data.catalogPlugins.find((p) => p.pluginId === newPluginId)
      : undefined;
    const linkedFamily = linked?.meta?.cropFamily as string | undefined;
    const familyTypeName = linkedFamily ? CROP_FAMILY_TO_TYPE_NAME[linkedFamily] : undefined;
    const sugg = result.suggestedType as { name?: string; isNew?: boolean; matchedTypeId?: string } | undefined;
    if (familyTypeName) {
      newTypeName = familyTypeName;
    } else if (sugg?.name) {
      newTypeName = sugg.name;
      // The "new" badge in the form already signals to the user; the save
      // flow's confirm() prompts before persisting an unrecognized name.
    }
    scanSource = (result.source ?? null) as typeof scanSource;
  }

  async function onBarcodeDetected(rawValue: string, _format: string) {
    scannerOpen = false;
    scanLoading = true;
    scanError = null;
    guessedFields = new Set();
    try {
      const res = await fetch('/api/scan-barcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode: rawValue })
      });
      const result = await res.json();
      if (!res.ok) { scanError = result.message ?? `Lookup failed (${res.status})`; return; }
      if (result.existingStockItemId) {
        if (handleExistingMatch(result.existingStockItemId)) return;
      }
      newBarcode = rawValue;
      applyScanResult(result);
      if (!result.found) scanError = 'Barcode not found — try "✨ Scan label" to read the packaging.';
    } catch (e) {
      scanError = e instanceof Error ? e.message : 'Scan lookup failed';
    } finally {
      scanLoading = false;
    }
  }

  async function onLabelCaptured(base64jpeg: string) {
    labelCaptureOpen = false;
    scanLoading = true;
    scanError = null;
    try {
      const res = await fetch('/api/scan-label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64jpeg, barcode: newBarcode || undefined })
      });
      const result = await res.json();
      if (!res.ok) { scanError = result.message ?? `Label read failed (${res.status})`; return; }
      if (!result.found) { scanError = 'Could not read the label clearly — try again with better lighting.'; return; }
      if (result.existingStockItemId) {
        if (handleExistingMatch(result.existingStockItemId)) return;
      }
      applyScanResult(result);
    } catch (e) {
      scanError = e instanceof Error ? e.message : 'Label read failed';
    } finally {
      scanLoading = false;
    }
  }

  /** When a scan resolves to an existing inventory SKU, ask the operator
   *  whether to open it (to add stock) or proceed with a new entry. Returns
   *  true if we routed away from the create flow. */
  function handleExistingMatch(itemId: string): boolean {
    const existing = data.items.find((i) => i.id === itemId);
    if (!existing) return false;
    const ok = confirm(
      `You already have "${existing.displayName}" in inventory ` +
      `(${existing.onHand} ${existing.defaultUnit} on hand).\n\n` +
      `OK = open it and add stock\n` +
      `Cancel = keep filling out a new entry`
    );
    if (!ok) return false;
    modalMode = null;
    openEdit(existing);
    modalAddStockOpen = true;
    return true;
  }

  // ─── Modal state ─────────────────────────────────────────────────────────
  type ModalMode = 'add' | 'edit' | null;
  let modalMode = $state<ModalMode>(null);
  let editTarget = $state<typeof data.items[0] | null>(null);

  // ─── Quick inline "+" per row ─────────────────────────────────────────────
  let quickAddId = $state<string | null>(null);
  let quickAddQty = $state<number | string>(1);
  let quickAdding = $state(false);
  let quickAddError = $state<string | null>(null);

  // ─── Edit modal add-stock sub-panel ──────────────────────────────────────
  let modalAddStockOpen = $state(false);
  let modalAddQty = $state<number | string>(1);
  let modalAddingLot = $state(false);
  let modalLotError = $state<string | null>(null);

  // ─── Edit modal set-quantity (overwrite) sub-panel ───────────────────────
  let modalSetQtyOpen = $state(false);
  let modalSetQty = $state<number | string>('');
  let modalSettingQty = $state(false);
  let modalSetQtyError = $state<string | null>(null);

  // ─── Add / Edit form fields ───────────────────────────────────────────────
  let newCategory = $state<Category>('seed');
  let newDisplayName = $state('');
  let newShortName = $state('');
  let newDefaultUnit = $state<StockUnit>('count');
  let newPluginId = $state('');
  let newTypeName = $state('');
  let pendingNewTypeName = $state<string | null>(null);
  let newBarcode = $state('');
  let newNotes = $state('');
  let enableReorder = $state(false);
  let newReorder = $state<number>(2);
  let newInitialQty = $state<number | string>('');
  let newDtm = $state<number | undefined>(undefined);
  let newTempMin = $state<number | undefined>(undefined);
  let newTempMax = $state<number | undefined>(undefined);
  let newSpacing = $state<number | undefined>(undefined);
  let newDepth = $state<number | undefined>(undefined);
  let newSun = $state('');
  let newSeedsPerPacket = $state<number | undefined>(undefined);
  let creating = $state(false);
  let createError = $state<string | null>(null);
  let cropPluginMatches = $state<Array<{ pluginId: string; displayName: string; score: number }>>([]);
  let catalogFields = $state(new Set<string>());

  const isSeed = $derived(newCategory === 'seed');

  type CatalogPlugin = typeof data.catalogPlugins[0];
  const linkedPlugin = $derived<CatalogPlugin | null>(
    newPluginId ? data.catalogPlugins.find((p) => p.pluginId === newPluginId) ?? null : null
  );
  const catalogSuggestions = $derived(
    data.catalogPlugins.filter((p) => p.category === newCategory)
  );

  function isCatalogField(field: string) { return catalogFields.has(field); }

  function applyCatalogMeta(p: CatalogPlugin) {
    const m = p.meta as Record<string, unknown>;
    const filled = new Set<string>();
    if (m.daysToMaturity != null) { newDtm = m.daysToMaturity as number; filled.add('daysToMaturity'); }
    if (m.plantingTempMinF != null) { newTempMin = m.plantingTempMinF as number; filled.add('plantingTempMinF'); }
    if (m.spacingInches != null) { newSpacing = m.spacingInches as number; filled.add('spacingInches'); }
    if (m.depthInches != null) { newDepth = m.depthInches as number; filled.add('depthInches'); }
    catalogFields = filled;
  }

  function linkCatalog(p: CatalogPlugin) {
    newPluginId = p.pluginId;
    newDisplayName = p.displayName;
    newCategory = p.category as Category;
    applyCatalogMeta(p);
  }

  function unlinkCatalog() {
    newPluginId = '';
    catalogFields = new Set();
  }

  /** Explicit user-initiated unlink (the form's "Unlink" button). In edit
   *  mode this also persists pluginId=null so subsequent operations like
   *  save-to-catalog see a consistent DB state. */
  async function onUnlinkClick() {
    unlinkCatalog();
    if (modalMode === 'edit' && editTarget) {
      try {
        await fetch(`/api/stock/${editTarget.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pluginId: null })
        });
        await invalidateAll();
        const refreshed = data.items.find((i) => i.id === editTarget!.id);
        if (refreshed) editTarget = refreshed;
      } catch (e) {
        createError = e instanceof Error ? e.message : String(e);
      }
    }
  }

  function onProductNameInput() {
    const trimmed = newDisplayName.trim().toLowerCase();
    if (!trimmed) { unlinkCatalog(); return; }
    const match = data.catalogPlugins.find(
      (p) => p.category === newCategory && p.displayName.toLowerCase() === trimmed
    );
    if (match) linkCatalog(match);
    else if (linkedPlugin && linkedPlugin.displayName.toLowerCase() !== trimmed) unlinkCatalog();
  }

  function onCategoryChange() {
    if (linkedPlugin && linkedPlugin.category !== newCategory) unlinkCatalog();
  }

  function resetForm() {
    newDisplayName = ''; newShortName = ''; newPluginId = ''; newBarcode = ''; newNotes = '';
    enableReorder = false; newReorder = 2; newInitialQty = '';
    newTypeName = ''; pendingNewTypeName = null;
    newDtm = undefined; newTempMin = undefined; newTempMax = undefined;
    newSpacing = undefined; newDepth = undefined; newSun = ''; newSeedsPerPacket = undefined;
    scanSource = null; cropPluginMatches = []; guessedFields = new Set(); catalogFields = new Set();
    scannedActiveIngredients = null; scannedFormulation = null;
    activeIngredientsCleared = false; formulationCleared = false;
    scanError = null; createError = null;
  }

  function openAdd(category: Category) {
    resetForm();
    newCategory = category;
    editTarget = null;
    modalMode = 'add';
  }

  function openEdit(item: typeof data.items[0]) {
    resetForm();
    editTarget = item;
    newCategory = item.category as Category;
    newDisplayName = item.displayName;
    newShortName = item.shortName ?? '';
    newDefaultUnit = item.defaultUnit as StockUnit;
    enableReorder = item.reorderThreshold != null;
    newReorder = item.reorderThreshold ?? 2;
    newNotes = item.notes ?? '';
    newPluginId = item.pluginId ?? '';
    newBarcode = item.barcode ?? '';
    newTypeName = item.typeName ?? '';
    if (newPluginId) {
      const linked = data.catalogPlugins.find((p) => p.pluginId === newPluginId);
      if (linked) catalogFields = new Set(Object.keys(linked.meta ?? {}));
    }
    if (item.metadataJson) {
      try {
        const m = JSON.parse(item.metadataJson);
        newDtm = m.daysToMaturity;
        newTempMin = m.plantingTempMinF;
        newTempMax = m.plantingTempMaxF;
        newSpacing = m.spacingInches;
        newDepth = m.depthInches;
        newSun = m.sunRequirement ?? '';
        newSeedsPerPacket = m.seedsPerPacket;
      } catch { /* ignore malformed JSON */ }
    }
    // Phase 17 (Track 2 + AI Refresh) — load existing AI-extracted formulation
    // data into the same state vars the summary card reads, so opening an
    // edit modal on a chem/fertilizer item surfaces what's already in the
    // row. Without this, the data sits in SQLite invisible to the UI.
    if (item.activeIngredientsJson) {
      try {
        const a = JSON.parse(item.activeIngredientsJson);
        if (Array.isArray(a)) scannedActiveIngredients = a;
      } catch { /* ignore malformed JSON */ }
    }
    if (item.formulationJson) {
      try {
        const f = JSON.parse(item.formulationJson);
        if (f && typeof f === 'object') scannedFormulation = f as Record<string, unknown>;
      } catch { /* ignore malformed JSON */ }
    }
    modalAddQty = 1;
    modalAddStockOpen = false;
    modalLotError = null;
    modalSetQtyOpen = false;
    modalSetQty = '';
    modalSetQtyError = null;
    modalMode = 'edit';
  }

  // Map default seed Type names → cropFamily enum required by the plugin
  // schema. Used to gate the "Save to catalog" prompt.
  const TYPE_NAME_TO_CROP_FAMILY: Record<string, string> = {
    'Corn': 'corn',
    'Cucurbits': 'cucurbit',
    'Legumes': 'legume',
    'Broadleaf companion': 'broadleaf-companion',
    'Orchard': 'orchard',
    'Cover crop — grass': 'cover-grass',
    'Cover crop — legume': 'cover-legume',
    'Solanaceae': 'solanaceae',
    'Brassicas': 'brassica',
    'Alliums': 'allium',
    'Leafy greens': 'leafy-green',
    'Root crops': 'root',
    'Apiaceae': 'apiaceae',
    'Small fruit': 'small-fruit',
    'Brambles': 'bramble',
    'Vine fruit': 'vine-fruit',
    'Stone fruit': 'stone-fruit',
    'Cereal grain': 'cereal-grain',
    'Forage': 'forage',
    'Culinary herbs': 'herb-culinary'
  };

  function isCatalogEligible(typeName: string): boolean {
    return !!TYPE_NAME_TO_CROP_FAMILY[typeName];
  }

  const CROP_FAMILY_TO_TYPE_NAME: Record<string, string> = Object.fromEntries(
    Object.entries(TYPE_NAME_TO_CROP_FAMILY).map(([k, v]) => [v, k])
  );

  async function saveToCatalog(itemId: string) {
    try {
      const res = await fetch(`/api/stock/${itemId}/save-to-catalog`, { method: 'POST' });
      const out = await res.json();
      if (!res.ok) {
        // Surface failures (validation, etc.) so the user knows the save
        // didn't land — but don't block the inventory-creation flow.
        console.error('[save-to-catalog] failed:', out.error);
        alert(`Catalog save failed: ${out.error ?? res.status}`);
        return;
      }
      // Reflect the new link in the open modal immediately. Without this,
      // newPluginId stays empty and the next form Save would post pluginId:null
      // and undo the link we just persisted server-side.
      newPluginId = out.pluginId as string;
      await invalidateAll();
      const refreshed = data.items.find((i) => i.id === itemId);
      if (refreshed) editTarget = refreshed;
    } catch (e) {
      console.error('[save-to-catalog] error:', e);
      alert(`Catalog save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Resolve newTypeName → typeId, prompting to add a new term if it doesn't
   *  match an existing one for this category. Returns { ok: false } when the
   *  user cancels the prompt or the create fails (caller should bail). */
  async function resolveTypeId(): Promise<{ ok: boolean; typeId: string | null }> {
    const name = newTypeName.trim();
    if (!name) return { ok: true, typeId: null };
    const domain = `inventory:${newCategory}`;
    const existing = data.taxonomy.find(
      (t) => t.domain === domain && t.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) return { ok: true, typeId: existing.id };
    const confirmed = confirm(
      `"${name}" isn't in your ${newCategory} Type list yet.\n\nAdd it as a new Type?`
    );
    if (!confirmed) return { ok: false, typeId: null };
    const res = await fetch('/api/types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, name })
    });
    const out = await res.json();
    if (!res.ok) {
      createError = `Failed to add type: ${out.error ?? res.status}`;
      return { ok: false, typeId: null };
    }
    return { ok: true, typeId: out.type.id as string };
  }

  async function createItem() {
    if (!newDisplayName.trim()) return;
    // Defense-in-depth duplicate check. The scan endpoints catch this for
    // recognized products, but manual + autocomplete-typed entries fall
    // through to here. If an existing SKU already links to the same plugin,
    // offer to add stock to it instead of creating a parallel row.
    if (newPluginId) {
      const dup = data.items.find((i) => i.pluginId === newPluginId);
      if (dup) {
        const ok = confirm(
          `"${dup.displayName}" is already in your inventory ` +
          `(${dup.onHand} ${dup.defaultUnit} on hand).\n\n` +
          `OK = open it and add stock\n` +
          `Cancel = create a separate entry anyway`
        );
        if (ok) {
          modalMode = null;
          openEdit(dup);
          modalAddStockOpen = true;
          return;
        }
      }
    }
    creating = true; createError = null;
    try {
      const typeRes = await resolveTypeId();
      if (!typeRes.ok) { creating = false; return; }
      const seedMeta = isSeed ? {
        daysToMaturity: newDtm, plantingTempMinF: newTempMin, plantingTempMaxF: newTempMax,
        spacingInches: newSpacing, depthInches: newDepth,
        sunRequirement: newSun || undefined, seedsPerPacket: newSeedsPerPacket
      } : undefined;
      // Phase 17 (Track 2) — only persist scanned formulation data on
      // chem + fertilizer categories; for seeds and parts these fields
      // are meaningless and would just bloat the row.
      const persistFormulation =
        newCategory === 'herbicide' ||
        newCategory === 'insecticide' ||
        newCategory === 'fungicide' ||
        newCategory === 'fertilizer';
      const aiJson = persistFormulation && (scannedActiveIngredients?.length ?? 0) > 0
        ? JSON.stringify(scannedActiveIngredients)
        : undefined;
      const formJson = persistFormulation && scannedFormulation
        ? JSON.stringify(scannedFormulation)
        : undefined;

      const res = await fetch('/api/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: newCategory, displayName: newDisplayName.trim(),
          shortName: newShortName.trim() || undefined,
          defaultUnit: newDefaultUnit,
          pluginId: newPluginId || undefined, reorderThreshold: enableReorder ? newReorder : undefined,
          notes: newNotes || undefined, barcode: newBarcode || undefined,
          typeId: typeRes.typeId || undefined,
          metadataJson: seedMeta ? JSON.stringify(seedMeta) : undefined,
          activeIngredientsJson: aiJson,
          formulationJson: formJson
        })
      });
      const out = await res.json();
      if (!res.ok) { createError = out.error ?? `HTTP ${res.status}`; return; }
      const newId = out.item.id as string;
      const initialQty = Number(newInitialQty);
      if (!isNaN(initialQty) && initialQty > 0) {
        const lotRes = await fetch(`/api/stock/${newId}/lots`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ receivedQuantity: initialQty, unit: newDefaultUnit })
        });
        if (!lotRes.ok) {
          const lotOut = await lotRes.json().catch(() => ({}));
          createError = `Item created but stock add failed: ${lotOut.error ?? lotRes.status}`;
          await invalidateAll();
          return;
        }
      }
      const eligibleForCatalog =
        newCategory === 'seed' &&
        !newPluginId &&
        !!newTypeName &&
        isCatalogEligible(newTypeName.trim());
      const savedDisplayName = newDisplayName.trim();
      resetForm();
      modalMode = null;
      await invalidateAll();
      if (eligibleForCatalog) {
        await saveToCatalog(newId);
      }
    } catch (e) {
      createError = e instanceof Error ? e.message : String(e);
    } finally { creating = false; }
  }

  async function saveEdit() {
    if (!editTarget || !newDisplayName.trim()) return;
    creating = true; createError = null;
    try {
      const typeRes = await resolveTypeId();
      if (!typeRes.ok) { creating = false; return; }
      const seedMeta = isSeed ? {
        daysToMaturity: newDtm, plantingTempMinF: newTempMin, plantingTempMaxF: newTempMax,
        spacingInches: newSpacing, depthInches: newDepth,
        sunRequirement: newSun || undefined, seedsPerPacket: newSeedsPerPacket
      } : undefined;
      // Phase 17 (Track 2 + AI Refresh) — chem + fertilizer items can carry
      // formulation JSON captured by either the original label scan or a
      // subsequent AI Refresh from the edit modal.
      const persistFormulation =
        newCategory === 'herbicide' ||
        newCategory === 'insecticide' ||
        newCategory === 'fungicide' ||
        newCategory === 'fertilizer';
      // Three-state encoding for the formulation columns:
      //   - JSON string: persist new value (covers both scan results + AI Refresh)
      //   - null:       operator clicked Discard → erase the column
      //   - undefined:  no change → preserve whatever's already in the row
      const aiJson: string | null | undefined = !persistFormulation
        ? undefined
        : (scannedActiveIngredients?.length ?? 0) > 0
          ? JSON.stringify(scannedActiveIngredients)
          : activeIngredientsCleared
            ? null
            : undefined;
      const formJson: string | null | undefined = !persistFormulation
        ? undefined
        : scannedFormulation
          ? JSON.stringify(scannedFormulation)
          : formulationCleared
            ? null
            : undefined;

      const res = await fetch(`/api/stock/${editTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: newDisplayName.trim(),
          shortName: newShortName.trim() ? newShortName.trim() : null,
          category: newCategory, defaultUnit: newDefaultUnit,
          pluginId: newPluginId || null, reorderThreshold: enableReorder ? newReorder : null,
          notes: newNotes || undefined, barcode: newBarcode || undefined,
          typeId: typeRes.typeId,
          metadataJson: seedMeta ? JSON.stringify(seedMeta) : undefined,
          activeIngredientsJson: aiJson,
          formulationJson: formJson
        })
      });
      const out = await res.json();
      if (!res.ok) { createError = out.error ?? `HTTP ${res.status}`; return; }
      modalMode = null;
      await invalidateAll();
    } catch (e) {
      createError = e instanceof Error ? e.message : String(e);
    } finally { creating = false; }
  }

  async function deleteCurrentItem() {
    if (!editTarget) return;
    const msg = editTarget.lotCount > 0
      ? `Delete "${editTarget.displayName}"? This removes the item plus all ${editTarget.lotCount} lot(s) and movement history.`
      : `Delete "${editTarget.displayName}"?`;
    if (!confirm(msg)) return;
    try {
      const res = await fetch(`/api/stock/${encodeURIComponent(editTarget.id)}`, { method: 'DELETE' });
      if (!res.ok) {
        const out = await res.json().catch(() => ({}));
        alert(`Delete failed: ${out.error ?? res.status}`);
        return;
      }
      modalMode = null;
      await invalidateAll();
    } catch (e) { alert(`Delete failed: ${e instanceof Error ? e.message : String(e)}`); }
  }

  async function setOnHandFromModal() {
    if (!editTarget) return;
    const qty = Number(modalSetQty);
    if (isNaN(qty) || qty < 0) { modalSetQtyError = 'Enter a number ≥ 0'; return; }
    modalSettingQty = true; modalSetQtyError = null;
    try {
      const res = await fetch(`/api/stock/${editTarget.id}/set-quantity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: qty })
      });
      const out = await res.json();
      if (!res.ok) { modalSetQtyError = out.error ?? 'Failed'; return; }
      modalSetQtyOpen = false;
      await invalidateAll();
      const refreshed = data.items.find((i) => i.id === editTarget!.id);
      if (refreshed) editTarget = refreshed;
    } catch (e) {
      modalSetQtyError = e instanceof Error ? e.message : String(e);
    } finally { modalSettingQty = false; }
  }

  async function addStockFromModal() {
    if (!editTarget) return;
    const qty = Number(modalAddQty);
    if (isNaN(qty) || qty <= 0) return;
    modalAddingLot = true; modalLotError = null;
    try {
      const res = await fetch(`/api/stock/${editTarget.id}/lots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receivedQuantity: qty, unit: editTarget.defaultUnit })
      });
      const out = await res.json();
      if (!res.ok) { modalLotError = out.error ?? 'Failed'; return; }
      modalAddStockOpen = false;
      await invalidateAll();
      const refreshed = data.items.find((i) => i.id === editTarget!.id);
      if (refreshed) editTarget = refreshed;
    } catch (e) {
      modalLotError = e instanceof Error ? e.message : String(e);
    } finally { modalAddingLot = false; }
  }

  async function quickAdd(itemId: string, defaultUnit: string) {
    const qty = Number(quickAddQty);
    if (isNaN(qty) || qty <= 0) return;
    quickAdding = true; quickAddError = null;
    try {
      const res = await fetch(`/api/stock/${itemId}/lots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receivedQuantity: qty, unit: defaultUnit })
      });
      const out = await res.json();
      if (!res.ok) { quickAddError = out.error ?? 'Failed'; return; }
      quickAddId = null;
      await invalidateAll();
    } catch (e) {
      quickAddError = e instanceof Error ? e.message : String(e);
    } finally { quickAdding = false; }
  }

  // ─── Phase 15d — short names via Haiku ───────────────────────────────────
  // Bulk regeneration lives on /settings (Inventory section). The edit
  // modal exposes a per-item ✨ button that hits the same endpoint with
  // `itemIds: [editTarget.id]` so the operator can re-suggest without
  // touching the rest of the catalog.
  let shortNameSingleBusy = $state(false);

  // ─── AI Refresh from web (Phase 17 follow-up) ─────────────────────────
  let refreshAiBusy = $state(false);
  let refreshAiError = $state<string | null>(null);
  /** Result returned by /api/stock/[id]/refresh-ai. Surfaces a per-field
   *  diff with citations; the operator picks which fields to apply. */
  let refreshAiResult = $state<Record<string, unknown> | null>(null);
  /** Per-field acceptance map — keyed by field name; default true so the
   *  operator opts OUT rather than IN. Citations make this safe-by-default. */
  let refreshAiAccept = $state<Record<string, boolean>>({});

  async function refreshFromWebForCurrent() {
    if (!editTarget || refreshAiBusy) return;
    refreshAiBusy = true;
    refreshAiError = null;
    refreshAiResult = null;
    try {
      const r = await fetch(`/api/stock/${editTarget.id}/refresh-ai`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      });
      const j = await r.json();
      if (!r.ok) {
        refreshAiError = j.error ?? `refresh failed (${r.status})`;
        return;
      }
      const result = j.result as Record<string, unknown> | null;
      if (!result || !result.hasCitations) {
        refreshAiError =
          j.meta?.fallback === 'no-citations'
            ? 'No web sources found for this product. Try editing the display name first.'
            : j.meta?.fallback === 'no-api-key'
              ? 'No Anthropic API key configured (Settings).'
              : 'No usable data returned.';
        return;
      }
      refreshAiResult = result;
      // Default-accept every returned field; operator unchecks any they don't trust.
      const accept: Record<string, boolean> = {};
      for (const k of Object.keys(result)) {
        if (['itemId', 'hasCitations', 'notes', 'citations'].includes(k)) continue;
        accept[k] = true;
      }
      refreshAiAccept = accept;
    } catch (e) {
      refreshAiError = e instanceof Error ? e.message : 'request failed';
    } finally {
      refreshAiBusy = false;
    }
  }

  /** Apply accepted fields to the form state (does NOT save — operator
   *  still clicks the modal's Save button to PATCH /api/stock/[id]). */
  function applyRefreshSelection() {
    if (!refreshAiResult) return;
    const r = refreshAiResult as Record<string, { value: unknown } | unknown>;
    const wrap = (key: string) => {
      const v = (r as Record<string, { value: unknown } | undefined>)[key]?.value;
      return refreshAiAccept[key] ? v : undefined;
    };
    const dtm = wrap('daysToMaturity');
    if (typeof dtm === 'number') newDtm = dtm;
    const tempMin = wrap('plantingTempMinF');
    if (typeof tempMin === 'number') newTempMin = tempMin;
    const spacing = wrap('spacingInches');
    if (typeof spacing === 'number') newSpacing = spacing;
    const depth = wrap('depthInches');
    if (typeof depth === 'number') newDepth = depth;
    const sun = wrap('sunRequirement');
    if (typeof sun === 'string') newSun = sun;
    const seedsPerPacket = wrap('seedsPerPacket');
    if (typeof seedsPerPacket === 'number') newSeedsPerPacket = seedsPerPacket;
    const ai = wrap('activeIngredients');
    if (Array.isArray(ai)) scannedActiveIngredients = ai;
    const npk = wrap('npk');
    const formType = wrap('formulationType');
    const productClass = wrap('productClass');
    const formulation: Record<string, unknown> = scannedFormulation ? { ...scannedFormulation } : {};
    if (npk && typeof npk === 'object') formulation.npk = npk;
    if (typeof formType === 'string') formulation.type = formType;
    if (typeof productClass === 'string') formulation.productClass = productClass;
    if (Object.keys(formulation).length > 0) scannedFormulation = formulation;
    refreshAiResult = null;
    refreshAiAccept = {};
  }

  /** Run the short-name generator for just the current edit target — pulls
   *  the suggestion straight into `newShortName` so the operator can review
   *  + edit before clicking Save. */
  async function generateShortNameForCurrent() {
    if (!editTarget || shortNameSingleBusy) return;
    shortNameSingleBusy = true;
    try {
      const r = await fetch('/api/stock/short-names', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemIds: [editTarget.id], force: true })
      });
      const j = await r.json();
      if (!r.ok) {
        alert(j.error ?? `short-name generation failed (${r.status})`);
        return;
      }
      const result = (j.results ?? [])[0];
      if (result?.shortName) {
        newShortName = result.shortName;
      } else {
        alert('Haiku could not produce a short name. Try editing the product name first.');
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'request failed');
    } finally {
      shortNameSingleBusy = false;
    }
  }
</script>

{#snippet inventoryRow(item: typeof data.items[0])}
  <li class="item-row" class:low={item.isLow}>
    <button class="item-btn" onclick={() => openEdit(item)} title={item.displayName}>
      <div class="item-info">
        <span class="item-name">{item.shortName ?? item.displayName}</span>
        {#if item.shortName && item.shortName !== item.displayName}
          <span class="item-sub" title={item.displayName}>{item.displayName}</span>
        {:else if itemSubtitle(item)}
          <span class="item-sub">{itemSubtitle(item)}</span>
        {/if}
      </div>
      <span class="item-qty" class:qty-low={item.isLow}>
        {item.onHand} <span class="item-unit">{item.defaultUnit}</span>
        {#if item.isLow}<span class="low-badge">⚠</span>{/if}
      </span>
    </button>
    {#if data.canEdit}
      {#if quickAddId === item.id}
        <form class="quick-add-form" onsubmit={(e) => { e.preventDefault(); quickAdd(item.id, item.defaultUnit); }}>
          <!-- svelte-ignore a11y_autofocus -->
          <input type="number" min="0.01" step="any" bind:value={quickAddQty} class="quick-qty" placeholder="qty" autofocus />
          <span class="quick-unit">{item.defaultUnit}</span>
          <button type="submit" class="quick-confirm" disabled={quickAdding}>✓</button>
          <button type="button" class="quick-cancel" onclick={() => (quickAddId = null)}>✕</button>
        </form>
      {:else}
        <button class="plus-btn" onclick={() => { quickAddId = item.id; quickAddQty = 1; }} title="Add stock">+</button>
      {/if}
    {/if}
  </li>
{/snippet}

<h1>Inventory</h1>
<p class="lede">Farm supply inventory — seeds, herbicides, fertilizer, adjuvants, fuel, parts. Spray events auto-decrement linked items.</p>

{#if lowItems.length > 0}
  <section class="alert" role="status" aria-live="polite">
    <strong>⚠ {lowItems.length} item{lowItems.length === 1 ? '' : 's'} at or below reorder threshold:</strong>
    <ul>
      {#each lowItems as i (i.id)}
        <li>
          <button class="alert-link" onclick={() => openEdit(i)}>{i.displayName}</button>
          — {i.onHand} {i.defaultUnit} on hand (threshold {i.reorderThreshold} {i.defaultUnit})
        </li>
      {/each}
    </ul>
  </section>
{/if}

<div class="search-row">
  <input class="search-bar" type="search" bind:value={searchQuery} placeholder="Search inventory…" />
  {#if data.canEdit}
    <button class="primary add-global-btn" onclick={() => openAdd('seed')}>+ Add item</button>
  {/if}
</div>

{#if quickAddError}
  <p class="scan-error" role="alert">{quickAddError}</p>
{/if}

{#each allCategories as cat}
  {@const catItems = itemsForCategory(cat)}
  {#if catItems.length > 0}
    <section class="cat-group card">
      <div class="cat-header">
        <button class="cat-toggle" onclick={() => toggleCategory(cat)} aria-expanded={openCategories.has(cat)}>
          <span class="cat-title">
            <span class="chevron" aria-hidden="true">{openCategories.has(cat) ? '▾' : '▸'}</span>
            <span class="cat-icon">{CATEGORY_ICON[cat]}</span>
            <span class="cat-name">{cat}</span>
            <span class="cat-count">{catItems.length}</span>
          </span>
        </button>
      </div>

      {#if openCategories.has(cat)}
        {@const groups = groupItemsByType(catItems)}
        {#if groups.length > 1 || (groups.length === 1 && groups[0].key !== '_other')}
          {#each groups as group (group.key)}
            {@const subKey = `${cat}:${group.key}`}
            <div class="subcat">
              <button class="subcat-toggle" onclick={() => toggleSubcat(subKey)} aria-expanded={isSubcatOpen(subKey)}>
                <span class="chevron-sm" aria-hidden="true">{isSubcatOpen(subKey) ? '▾' : '▸'}</span>
                {#if TYPE_ICON[group.typeName]}
                  <span class="subcat-icon" aria-hidden="true">{TYPE_ICON[group.typeName]}</span>
                {/if}
                <span class="subcat-name">{group.typeName}</span>
                <span class="subcat-count">{group.items.length}</span>
              </button>
              {#if isSubcatOpen(subKey)}
                <ul class="item-list nested">
                  {#each group.items as item (item.id)}
                    {@render inventoryRow(item)}
                  {/each}
                </ul>
              {/if}
            </div>
          {/each}
        {:else}
          <ul class="item-list">
            {#each catItems as item (item.id)}
              {@render inventoryRow(item)}
            {/each}
          </ul>
        {/if}
      {/if}
    </section>
  {/if}
{/each}

{#if data.items.length === 0 && !searchQuery.trim()}
  <section class="card empty">
    <p>No inventory yet.{#if data.canEdit} Use "+ Add item" or scan a barcode to get started.{/if}</p>
  </section>
{/if}

{#if searchQuery.trim() && searchFiltered.length === 0}
  <section class="card empty"><p>No items match "{searchQuery}".</p></section>
{/if}

<!-- ── Unified Add / Edit Modal ──────────────────────────────────────────── -->
{#if modalMode}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="inv-modal-title"
       tabindex="-1" onclick={() => (modalMode = null)}>
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_click_events_have_key_events -->
    <div class="modal-box wide" role="document" tabindex="-1" onclick={(e) => e.stopPropagation()}>

      <div class="modal-header">
        <h3 id="inv-modal-title">
          {modalMode === 'add' ? 'Add to Inventory' : `Edit — ${editTarget?.displayName}`}
        </h3>
        <button class="modal-close" onclick={() => (modalMode = null)} aria-label="Close">✕</button>
      </div>

      {#if modalMode === 'add'}
        <!-- Scan row -->
        <div class="scan-btns">
          <button class="scan-btn" onclick={() => (scannerOpen = true)} disabled={scanLoading}>📷 Barcode</button>
          <button class="scan-btn ai-btn" onclick={() => (labelCaptureOpen = true)} disabled={scanLoading}>✨ Scan label</button>
          {#if scanLoading}<span class="scan-spinner"><span class="spin">⟳</span> Looking up…</span>{/if}
        </div>
        {#if scanError}<p class="scan-error" role="alert">{scanError}</p>{/if}
        {#if scanSource && scanSource !== 'none'}
          <p class="scan-notice" role="status">
            {#if scanSource === 'openfoodfacts'}✓ Open Food Facts
            {:else if scanSource === 'claude'}✓ AI lookup
            {:else if scanSource === 'claude-vision'}✓ Claude AI label read
            {/if}
            — review fields.
            {#if guessedFields.size > 0}<strong> Amber = estimated.</strong>{/if}
          </p>
        {/if}

      {:else}
        <!-- Edit mode: on-hand amount + quick add + set-quantity -->
        <div class="modal-amount-section">
          <div class="modal-amount">
            {#if !modalSetQtyOpen}
              <button
                class="amount-display"
                onclick={() => { modalSetQty = editTarget?.onHand ?? 0; modalSetQtyOpen = true; modalAddStockOpen = false; }}
                title="Click to overwrite the on-hand quantity"
              >
                <span class="amount-big">{editTarget?.onHand ?? 0}</span>
                <span class="amount-unit">{editTarget?.defaultUnit}</span>
                <span class="amount-edit-icon" aria-hidden="true">✎</span>
              </button>
              {#if editTarget?.isLow}<span class="low-badge">⚠ low</span>{/if}
            {:else}
              <form class="modal-set-qty-form" onsubmit={(e) => { e.preventDefault(); setOnHandFromModal(); }}>
                <!-- svelte-ignore a11y_autofocus -->
                <input type="number" min="0" step="any" bind:value={modalSetQty} class="modal-stock-qty set-qty-input" autofocus />
                <span class="modal-stock-unit">{editTarget?.defaultUnit}</span>
                <button type="submit" class="modal-add-confirm" disabled={modalSettingQty}>{modalSettingQty ? '…' : 'Set total'}</button>
                <button type="button" onclick={() => (modalSetQtyOpen = false)}>✕</button>
              </form>
            {/if}
          </div>
          {#if modalSetQtyError}<p class="error">{modalSetQtyError}</p>{/if}
          <div class="modal-amount-actions">
            {#if !modalAddStockOpen}
              <button class="green-plus-btn" onclick={() => { modalAddStockOpen = true; modalSetQtyOpen = false; }}>+ Add stock</button>
            {:else}
              <form class="modal-add-stock-form" onsubmit={(e) => { e.preventDefault(); addStockFromModal(); }}>
                <!-- svelte-ignore a11y_autofocus -->
                <input type="number" min="0.01" step="any" bind:value={modalAddQty} class="modal-stock-qty" autofocus />
                <span class="modal-stock-unit">{editTarget?.defaultUnit}</span>
                <button type="submit" class="modal-add-confirm" disabled={modalAddingLot}>{modalAddingLot ? '…' : 'Add'}</button>
                <button type="button" onclick={() => (modalAddStockOpen = false)}>✕</button>
              </form>
            {/if}
            <a href="/stock/{editTarget?.id}" class="lots-link" onclick={() => (modalMode = null)}>Manage lots →</a>
          </div>
          {#if modalLotError}<p class="error">{modalLotError}</p>{/if}
        </div>
        <hr class="modal-divider" />
      {/if}

      <!-- Shared form fields -->
      <div class="modal-form">
        <datalist id="catalog-suggestions">
          {#each catalogSuggestions as p (p.pluginId)}
            <option value={p.displayName}></option>
          {/each}
        </datalist>
        <datalist id="type-suggestions">
          {#each typesForCategory(newCategory) as t (t.id)}
            <option value={t.name}>{t.description ?? ''}</option>
          {/each}
        </datalist>

        <div class="grid">
          <label class:guessed={isGuessed('category')}>
            <span class="field-label">Category {#if isGuessed('category')}<em class="est-tag">estimated</em>{/if}</span>
            <select bind:value={newCategory} onchange={onCategoryChange}>
              {#each allCategories as c}<option value={c}>{CATEGORY_ICON[c]} {c}</option>{/each}
            </select>
          </label>
          <label>
            <span class="field-label">
              Type
              {#if newTypeName.trim() && !data.taxonomy.find((t) => t.domain === `inventory:${newCategory}` && t.name.toLowerCase() === newTypeName.trim().toLowerCase())}
                <em class="new-tag" title="Will prompt to add as a new Type when you save">new</em>
              {/if}
            </span>
            <input type="text" list="type-suggestions" bind:value={newTypeName} placeholder="Pick or type a new Type…" />
          </label>
          <label class:guessed={isGuessed('displayName')}>
            <span class="field-label">
              Product name
              {#if isGuessed('displayName')}<em class="est-tag">estimated</em>{/if}
              {#if linkedPlugin}<em class="cat-tag" title={linkedPlugin.pluginId}>linked</em>{/if}
            </span>
            <input
              type="text"
              list="catalog-suggestions"
              bind:value={newDisplayName}
              oninput={onProductNameInput}
              placeholder="Type to search the catalog…"
            />
          </label>
          <label>
            <span class="field-label">
              Short name
              <em class="cat-tag">used on schedule bars</em>
            </span>
            <div class="short-name-row">
              <input
                type="text"
                maxlength="40"
                bind:value={newShortName}
                placeholder="e.g., Cinderella Pumpkin (≤40 chars)"
              />
              {#if modalMode === 'edit' && editTarget}
                <button
                  type="button"
                  class="ai-mini-btn"
                  onclick={generateShortNameForCurrent}
                  disabled={shortNameSingleBusy || !newDisplayName.trim()}
                  title="Use Haiku to suggest a short name from the current product name"
                >
                  {shortNameSingleBusy ? '…' : '✨'}
                </button>
              {/if}
            </div>
          </label>
          {#if modalMode === 'add'}
            <label>
              <span class="field-label">Initial qty</span>
              <input type="number" min="0" step="0.01" bind:value={newInitialQty} placeholder="0 = skip" />
            </label>
          {/if}
          <label class:guessed={isGuessed('defaultUnit')}>
            <span class="field-label">Unit {#if isGuessed('defaultUnit')}<em class="est-tag">estimated</em>{/if}</span>
            <select bind:value={newDefaultUnit}>
              {#each ALL_STOCK_UNITS as u}<option value={u}>{u}</option>{/each}
            </select>
          </label>
          <label class:guessed={isGuessed('reorderThreshold')} class="reorder-label">
            <span class="field-label">
              <input type="checkbox" class="reorder-check" bind:checked={enableReorder} />
              Reorder level
              {#if isGuessed('reorderThreshold')}<em class="est-tag">estimated</em>{/if}
            </span>
            {#if enableReorder}
              <input type="number" min="0" step="0.01" bind:value={newReorder} placeholder="e.g. 2" />
            {:else}
              <span class="reorder-off">not tracked</span>
            {/if}
          </label>
          <label class="full-col">
            <span class="field-label">Notes</span>
            <input type="text" bind:value={newNotes} placeholder="Key facts (certifications, variety notes…)" />
          </label>
        </div>

        <!-- Phase 17 follow-up — refresh from web via Claude + web_search.
             Edit-mode only; never overwrites without operator confirm. -->
        {#if modalMode === 'edit' && editTarget}
          <div class="ai-refresh-block">
            <button
              type="button"
              class="ai-refresh-btn"
              onclick={refreshFromWebForCurrent}
              disabled={refreshAiBusy}
              title="Use Claude with web search to look up canonical specs for this item"
            >
              {refreshAiBusy ? 'Searching the web…' : '🔍 Refresh from web'}
            </button>
            {#if refreshAiError}
              <p class="ai-refresh-error">{refreshAiError}</p>
            {/if}
            {#if refreshAiResult}
              {@const r = refreshAiResult as Record<string, { value: unknown; sourceUrl?: string; sourceTitle?: string } | unknown>}
              <div class="ai-refresh-diff">
                <p class="ai-refresh-diff-title">
                  AI returned {Object.keys(refreshAiAccept).length} field{Object.keys(refreshAiAccept).length === 1 ? '' : 's'} with citations. Uncheck any you don't trust, then Apply.
                </p>
                {#if (refreshAiResult as { notes?: string }).notes}
                  <p class="ai-refresh-notes">{(refreshAiResult as { notes: string }).notes}</p>
                {/if}
                <ul class="ai-refresh-list">
                  {#each Object.keys(refreshAiAccept) as key}
                    {@const field = (r as Record<string, { value: unknown; sourceUrl?: string; sourceTitle?: string }>)[key]}
                    {#if field}
                      <li class="ai-refresh-row">
                        <label class="ai-refresh-check">
                          <input type="checkbox" bind:checked={refreshAiAccept[key]} />
                          <span class="ai-refresh-key">{key}</span>
                        </label>
                        <span class="ai-refresh-value">{JSON.stringify(field.value)}</span>
                        {#if field.sourceUrl}
                          <a class="ai-refresh-cite" href={field.sourceUrl} target="_blank" rel="noopener noreferrer">
                            {field.sourceTitle ?? 'source'}
                          </a>
                        {/if}
                      </li>
                    {/if}
                  {/each}
                </ul>
                <div class="ai-refresh-actions">
                  <button type="button" class="primary" onclick={applyRefreshSelection}>Apply selected</button>
                  <button type="button" class="secondary" onclick={() => { refreshAiResult = null; refreshAiAccept = {}; }}>Discard</button>
                </div>
              </div>
            {/if}
          </div>
        {/if}

        <!-- Save to catalog (for unlinked seed items) -->
        {#if modalMode === 'edit' && editTarget && isSeed && !linkedPlugin && newTypeName && isCatalogEligible(newTypeName.trim())}
          <div class="catalog-offer">
            <div class="catalog-offer-text">
              <strong>Add this to your crop catalog?</strong>
              <span>Future similar products will auto-match, and you can share the entry.</span>
            </div>
            <button
              type="button"
              class="catalog-offer-btn"
              onclick={() => saveToCatalog(editTarget!.id)}
            >
              Save to catalog →
            </button>
          </div>
        {/if}

        <!-- Linked catalog summary -->
        {#if linkedPlugin}
          <div class="catalog-link-section">
            <div class="catalog-link-header">
              <span class="catalog-link-label">
                <span class="catalog-link-check">✓</span>
                Linked to catalog: <strong>{linkedPlugin.displayName}</strong>
              </span>
              <button type="button" class="catalog-unlink-btn" onclick={onUnlinkClick}>Unlink</button>
            </div>
            {#if linkedPlugin.category !== 'seed'}
              {@const m = linkedPlugin.meta as Record<string, unknown>}
              {#if m.activeIngredients || m.ratePerAcre || m.reEntryIntervalHours != null || m.preHarvestIntervalDays != null || m.epaRegistrationNumber}
                <dl class="catalog-meta">
                  {#if m.activeIngredients}<dt>Active ingredients</dt><dd>{(m.activeIngredients as string[]).join(', ')}</dd>{/if}
                  {#if m.ratePerAcre}{@const r = m.ratePerAcre as { amount: number; unit: string }}<dt>Rate / acre</dt><dd>{r.amount} {r.unit}</dd>{/if}
                  {#if m.reEntryIntervalHours != null}<dt>Re-entry</dt><dd>{m.reEntryIntervalHours} h</dd>{/if}
                  {#if m.preHarvestIntervalDays != null}<dt>Pre-harvest interval</dt><dd>{m.preHarvestIntervalDays} d</dd>{/if}
                  {#if m.epaRegistrationNumber}<dt>EPA reg #</dt><dd>{m.epaRegistrationNumber}</dd>{/if}
                </dl>
              {/if}
            {/if}
          </div>
        {/if}

        <!-- Seed growing info -->
        {#if isSeed}
          <div class="form-section seed-section">
            <div class="seed-section-header">
              <h4 class="subsection-title">Growing info</h4>
              {#if linkedPlugin}<span class="catalog-hint">Catalog values auto-filled — verify or adjust below</span>{/if}
            </div>
            <div class="grid">
              <label class:guessed={isGuessed('daysToMaturity')} class:catalog={isCatalogField('daysToMaturity')}>
                <span class="field-label">Days to maturity
                  {#if isGuessed('daysToMaturity')}<em class="est-tag">estimated</em>
                  {:else if isCatalogField('daysToMaturity')}<em class="cat-tag">from catalog</em>{/if}
                </span>
                <input type="number" min="1" max="365" bind:value={newDtm} placeholder="e.g. 125" />
              </label>
              <label class:guessed={isGuessed('plantingTempMinF') || isGuessed('plantingTempMaxF')} class:catalog={isCatalogField('plantingTempMinF')}>
                <span class="field-label">Soil temp °F
                  {#if isGuessed('plantingTempMinF')}<em class="est-tag">estimated</em>
                  {:else if isCatalogField('plantingTempMinF')}<em class="cat-tag">from catalog</em>{/if}
                </span>
                <div class="range-inputs">
                  <input type="number" min="20" max="120" bind:value={newTempMin} placeholder="Min" />
                  <span class="range-sep">–</span>
                  <input type="number" min="20" max="120" bind:value={newTempMax} placeholder="Max" />
                </div>
              </label>
              <label class:guessed={isGuessed('spacingInches')} class:catalog={isCatalogField('spacingInches')}>
                <span class="field-label">Spacing (in)
                  {#if isGuessed('spacingInches')}<em class="est-tag">estimated</em>
                  {:else if isCatalogField('spacingInches')}<em class="cat-tag">from catalog</em>{/if}
                </span>
                <input type="number" min="0.5" step="0.5" bind:value={newSpacing} placeholder="e.g. 48" />
              </label>
              <label class:guessed={isGuessed('depthInches')} class:catalog={isCatalogField('depthInches')}>
                <span class="field-label">Depth (in)
                  {#if isGuessed('depthInches')}<em class="est-tag">estimated</em>
                  {:else if isCatalogField('depthInches')}<em class="cat-tag">from catalog</em>{/if}
                </span>
                <input type="number" min="0.1" step="0.1" bind:value={newDepth} placeholder="e.g. 1" />
              </label>
              <label class:guessed={isGuessed('sunRequirement')}>
                <span class="field-label">Sun {#if isGuessed('sunRequirement')}<em class="est-tag">estimated</em>{/if}</span>
                <select bind:value={newSun}>
                  <option value="">— unknown —</option>
                  <option value="full-sun">Full sun</option>
                  <option value="partial-shade">Partial shade</option>
                  <option value="full-shade">Full shade</option>
                </select>
              </label>
              <label class:guessed={isGuessed('seedsPerPacket')}>
                <span class="field-label">Seeds/packet {#if isGuessed('seedsPerPacket')}<em class="est-tag">estimated</em>{/if}</span>
                <input type="number" min="1" bind:value={newSeedsPerPacket} placeholder="e.g. 20" />
              </label>
            </div>
          </div>
          {#if cropPluginMatches.length > 0 && !linkedPlugin}
            <div class="form-section">
              <label class="full">
                <span class="field-label">Suggested catalog match</span>
                <select onchange={(e) => {
                  const id = (e.target as HTMLSelectElement).value;
                  const c = data.catalogPlugins.find((p) => p.pluginId === id);
                  if (c) linkCatalog(c);
                }}>
                  <option value="">— skip —</option>
                  {#each cropPluginMatches as m (m.pluginId)}
                    <option value={m.pluginId}>{m.displayName} ({Math.round(m.score * 100)}% match)</option>
                  {/each}
                </select>
              </label>
            </div>
          {/if}
        {/if}

        {#if hasScannedFormulationData() && (newCategory === 'herbicide' || newCategory === 'insecticide' || newCategory === 'fungicide' || newCategory === 'fertilizer')}
          <div class="form-section ai-formulation">
            <p class="ai-formulation-label">
              <em class="est-tag">{modalMode === 'edit' ? 'AI-extracted (saved)' : 'AI-extracted from label'}</em>
              <button
                type="button"
                class="link-btn"
                onclick={() => {
                  // Track explicit clear so saveEdit sends `null` (not undefined)
                  // and the API actually erases the column.
                  if (scannedActiveIngredients) activeIngredientsCleared = true;
                  if (scannedFormulation) formulationCleared = true;
                  scannedActiveIngredients = null;
                  scannedFormulation = null;
                }}
              >Discard</button>
            </p>
            {#if scannedActiveIngredients?.length}
              <ul class="ai-ingredient-list">
                {#each scannedActiveIngredients as ing}
                  {@const i = ing as { name?: string; concentrationPct?: number; chemistryClass?: string; iracGroup?: string; fracCode?: string }}
                  <li>
                    <strong>{i.name ?? 'unknown'}</strong>
                    {#if i.concentrationPct != null}<span> · {i.concentrationPct}%</span>{/if}
                    {#if i.chemistryClass}<span class="ai-chip">{i.chemistryClass}</span>{/if}
                    {#if i.iracGroup}<span class="ai-chip">IRAC {i.iracGroup}</span>{/if}
                    {#if i.fracCode}<span class="ai-chip">FRAC {i.fracCode}</span>{/if}
                  </li>
                {/each}
              </ul>
            {/if}
            {#if scannedFormulation}
              <p class="ai-formulation-meta">
                {#if scannedFormulation.npk}
                  {@const n = (scannedFormulation.npk as { n: number; p: number; k: number })}
                  <span class="ai-chip">N-P-K {n.n}-{n.p}-{n.k}</span>
                {/if}
                {#if scannedFormulation.type}<span class="ai-chip">{scannedFormulation.type}</span>{/if}
                {#if scannedFormulation.productClass}<span class="ai-chip">{scannedFormulation.productClass}</span>{/if}
              </p>
            {/if}
          </div>
        {/if}

        {#if newBarcode}
          <p class="barcode-hint">📷 {newBarcode}</p>
        {/if}
      </div>

      <!-- Footer -->
      <div class="modal-footer">
        {#if modalMode === 'edit'}
          <button class="danger-btn" onclick={deleteCurrentItem}>Delete</button>
        {/if}
        <div class="modal-footer-right">
          <button class="secondary" onclick={() => (modalMode = null)}>Cancel</button>
          {#if modalMode === 'add'}
            <button class="primary" onclick={createItem} disabled={creating || !newDisplayName.trim()}>
              {creating ? '…' : 'Add to Inventory'}
            </button>
          {:else}
            <button class="primary" onclick={saveEdit} disabled={creating || !newDisplayName.trim()}>
              {creating ? '…' : 'Save'}
            </button>
          {/if}
        </div>
      </div>
      {#if createError}<p class="error modal-error">{createError}</p>{/if}

    </div>
  </div>
{/if}

{#if scannerOpen}
  <BarcodeScanner onDetected={onBarcodeDetected} onClose={() => (scannerOpen = false)} />
{/if}

{#if labelCaptureOpen}
  <LabelCapture onCapture={onLabelCaptured} onClose={() => (labelCaptureOpen = false)} />
{/if}

<style>
  h1 { margin: 0 0 0.25rem; }
  .lede { color: #555; margin: 0 0 1rem; font-size: 0.9rem; }

  /* ── Alert ─────────────────────────────────────────────────────────────── */
  .alert {
    background: #fff3cd; color: #b35900; padding: 0.75rem 1rem;
    border-radius: 4px; border-left: 4px solid #b35900; margin-bottom: 1rem;
  }
  .alert ul { margin: 0.4rem 0 0 1.25rem; padding: 0; }
  .alert-link {
    background: none; border: none; color: #b35900; text-decoration: underline;
    cursor: pointer; padding: 0; font: inherit; font-weight: 600;
  }

  /* ── Search row ─────────────────────────────────────────────────────────── */
  .search-row {
    display: flex; gap: 0.6rem; align-items: center; margin-bottom: 0.75rem;
  }
  .search-bar {
    flex: 1; padding: 0.6rem 1rem; border: 2px solid #d0d7d0; border-radius: 24px;
    font-size: 1rem; font-family: inherit; min-height: 48px;
  }
  .search-bar:focus { outline: none; border-color: #1f5e3a; }
  .add-global-btn { white-space: nowrap; }

  /* ── Category accordion ─────────────────────────────────────────────────── */
  .card {
    background: white; border-radius: 8px; padding: 0;
    margin-bottom: 0.6rem; box-shadow: 0 1px 2px rgba(0,0,0,0.05); overflow: hidden;
  }
  .cat-header {
    display: flex; align-items: center; justify-content: space-between; padding-right: 0.75rem;
  }
  .cat-header:has(.cat-toggle:hover) { background: #f5f7f4; }
  .cat-toggle {
    flex: 1; display: flex; align-items: center; justify-content: space-between;
    background: none; border: none; cursor: pointer;
    padding: 0.75rem 0.5rem 0.75rem 1rem; font: inherit; text-align: left; min-height: 52px;
  }
  .cat-toggle:hover { background: transparent; }
  .cat-title { display: flex; align-items: center; gap: 0.5rem; font-weight: 700; font-size: 0.95rem; }
  .cat-icon { font-size: 1.1rem; }
  .cat-name { text-transform: capitalize; color: #1f5e3a; }
  .cat-count {
    background: #e7f1ea; color: #1f5e3a; border-radius: 12px;
    font-size: 0.75rem; font-weight: 700; padding: 0.1rem 0.5rem;
  }

  .chevron { font-size: 0.95rem; color: #1f5e3a; width: 1rem; display: inline-block; text-align: center; }

  /* Seed sub-category accordion */
  .subcat { border-top: 1px solid #eef1ee; }
  .subcat:first-of-type { border-top: none; }
  .subcat-toggle {
    width: 100%; display: flex; align-items: center; gap: 0.4rem;
    background: #f5f7f4; border: none; cursor: pointer;
    padding: 0.45rem 0.75rem 0.45rem 1.5rem; font: inherit; text-align: left;
    min-height: unset; min-width: unset; color: #3a5a44;
  }
  .subcat-toggle:hover { background: #e7f1ea; }
  .chevron-sm { font-size: 0.8rem; color: #6a8a75; width: 0.85rem; display: inline-block; text-align: center; }
  .subcat-icon { font-size: 0.95rem; line-height: 1; }
  .subcat-name { font-size: 0.82rem; font-weight: 600; flex: 1; }
  .subcat-count {
    background: #e0eae3; color: #3a5a44; border-radius: 10px;
    font-size: 0.7rem; font-weight: 700; padding: 0.05rem 0.45rem;
  }
  .item-list.nested { border-top: 1px solid #eef1ee; }
  .item-list.nested .item-btn { padding-left: 2rem; }

  /* ── Item list rows ─────────────────────────────────────────────────────── */
  .item-list { list-style: none; padding: 0; margin: 0; border-top: 1px solid #eef1ee; }
  .item-row {
    display: flex; align-items: center; border-bottom: 1px solid #f0f3f0; min-height: 44px;
  }
  .item-row:last-child { border-bottom: none; }
  .item-row.low { border-left: 3px solid #b35900; }
  .item-btn {
    flex: 1; display: flex; align-items: center; justify-content: space-between;
    background: none; border: none; cursor: pointer; padding: 0.35rem 0.75rem 0.35rem 1rem;
    text-align: left; font: inherit; min-height: 44px; gap: 0.5rem;
  }
  .item-btn:hover { background: #f9fcf9; }
  .item-info { display: flex; flex-direction: column; gap: 0.05rem; flex: 1; }
  .item-name { font-weight: 600; font-size: 0.9rem; color: #1a1a1a; line-height: 1.2; }
  .item-sub { font-size: 0.72rem; color: #777; line-height: 1.15; }
  .item-qty {
    font-family: monospace; font-weight: 700; font-size: 1rem; color: #1f5e3a;
    white-space: nowrap; display: flex; align-items: center; gap: 0.35rem;
  }
  .item-unit { font-weight: 400; font-size: 0.8rem; color: #555; }
  .qty-low { color: #b35900; }
  .low-badge {
    background: #fff3cd; color: #b35900; padding: 0.05rem 0.35rem;
    border-radius: 3px; font-size: 0.7rem; font-weight: 700;
  }

  /* ── Plus button + quick-add form ──────────────────────────────────────── */
  .plus-btn {
    width: 36px; height: 36px; border-radius: 50%; background: #1f5e3a; color: white;
    border: none; font-size: 1.3rem; font-weight: 400; cursor: pointer; flex-shrink: 0;
    margin: 0 0.6rem; display: flex; align-items: center; justify-content: center; line-height: 1;
  }
  .plus-btn:hover { background: #17492d; }
  .short-name-row { display: flex; gap: 0.4rem; align-items: stretch; }
  .short-name-row input { flex: 1 1 auto; min-width: 0; }
  .ai-mini-btn {
    flex: 0 0 auto;
    width: 48px;
    min-height: 48px;
    border-radius: 4px;
    border: 2px solid #c7d2fe;
    background: #eef2ff;
    color: #4338ca;
    font-size: 1.05rem;
    font-weight: 600;
    cursor: pointer;
  }
  .ai-mini-btn:hover { background: #e0e7ff; }
  .ai-mini-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .quick-add-form {
    display: flex; align-items: center; gap: 0.3rem; padding: 0.3rem 0.6rem;
    flex-shrink: 0;
  }
  .quick-qty {
    width: 64px; padding: 0.3rem 0.4rem; border: 2px solid #1f5e3a;
    border-radius: 4px; font-size: 0.9rem; min-height: 36px; font-family: inherit;
  }
  .quick-unit { font-size: 0.78rem; color: #555; }
  .quick-confirm {
    background: #1f5e3a; color: white; border: none; border-radius: 4px;
    padding: 0.3rem 0.6rem; cursor: pointer; font-size: 0.9rem; min-height: 36px;
  }
  .quick-confirm:disabled { opacity: 0.6; }
  .quick-cancel {
    background: none; border: 1px solid #d0d7d0; border-radius: 4px;
    padding: 0.3rem 0.5rem; cursor: pointer; color: #555; min-height: 36px;
  }

  /* ── Empty state ────────────────────────────────────────────────────────── */
  .empty { padding: 2rem 1rem; text-align: center; color: #555; }

  /* ── Modal ──────────────────────────────────────────────────────────────── */
  .modal-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.45);
    display: flex; align-items: center; justify-content: center; z-index: 200; padding: 1rem;
  }
  .modal-box {
    background: white; border-radius: 10px; width: 100%; max-width: 480px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.18); display: flex; flex-direction: column;
    max-height: 90vh; overflow: hidden;
  }
  .modal-box.wide { max-width: 540px; }
  .modal-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 1rem 1.25rem 0.75rem; border-bottom: 1px solid #e8ede8; flex-shrink: 0;
  }
  .modal-header h3 { margin: 0; font-size: 1.05rem; color: #1f5e3a; }
  .modal-close {
    background: none; border: none; font-size: 1.2rem; cursor: pointer; color: #555;
    padding: 0.2rem 0.4rem; border-radius: 4px; line-height: 1;
  }
  .modal-close:hover { background: #f0f3f0; }

  /* Edit mode: amount section */
  .modal-amount-section {
    padding: 1rem 1.25rem 0.75rem; background: #f5f7f4;
    border-bottom: 1px solid #e8ede8; flex-shrink: 0;
  }
  .modal-amount { display: flex; align-items: baseline; gap: 0.4rem; margin-bottom: 0.6rem; flex-wrap: wrap; }
  .amount-display {
    display: inline-flex; align-items: baseline; gap: 0.4rem;
    background: none; border: none; padding: 0.2rem 0.4rem; margin: -0.2rem -0.4rem;
    border-radius: 6px; cursor: pointer; font: inherit; color: inherit;
    min-height: unset; min-width: unset;
  }
  .amount-display:hover { background: #e7f1ea; }
  .amount-display:hover .amount-edit-icon { opacity: 1; }
  .amount-big { font-size: 2.2rem; font-weight: 800; color: #1f5e3a; font-family: monospace; line-height: 1; }
  .amount-unit { font-size: 1rem; color: #555; }
  .amount-edit-icon { font-size: 0.95rem; color: #1f5e3a; opacity: 0.55; transition: opacity 0.15s; align-self: center; }
  .modal-set-qty-form { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
  .set-qty-input { font-size: 1.6rem; font-weight: 800; width: 110px; }
  .modal-amount-actions { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
  .green-plus-btn {
    background: #1f5e3a; color: white; border: none; border-radius: 6px;
    padding: 0.5rem 1rem; font-weight: 600; cursor: pointer; min-height: 40px; font-family: inherit;
  }
  .green-plus-btn:hover { background: #17492d; }
  .modal-add-stock-form { display: flex; align-items: center; gap: 0.4rem; }
  .modal-stock-qty {
    width: 80px; padding: 0.4rem 0.5rem; border: 2px solid #1f5e3a;
    border-radius: 4px; font-size: 1.1rem; font-weight: 700; min-height: 40px; font-family: monospace;
  }
  .modal-stock-unit { font-size: 0.85rem; color: #555; }
  .modal-add-confirm {
    background: #1f5e3a; color: white; border: none; border-radius: 4px;
    padding: 0.4rem 0.75rem; cursor: pointer; font-weight: 600; min-height: 40px;
  }
  .modal-add-confirm:disabled { opacity: 0.6; }
  .lots-link { font-size: 0.82rem; color: #1f5e3a; text-decoration: underline; }
  .modal-divider { border: none; border-top: 1px solid #e8ede8; margin: 0; }

  /* Modal form + scrollable area */
  .modal-form {
    flex: 1; overflow-y: auto; padding: 0.75rem 1.25rem; display: flex; flex-direction: column; gap: 0;
  }

  /* Modal footer */
  .modal-footer {
    display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
    padding: 0.75rem 1.25rem; border-top: 1px solid #e8ede8; flex-shrink: 0;
  }
  .modal-footer-right { display: flex; gap: 0.5rem; }
  .modal-error { padding: 0 1.25rem 0.5rem; margin: 0; }
  .danger-btn {
    background: white; color: #b00020; border: 1.5px solid #b00020;
    border-radius: 6px; padding: 0.6rem 0.9rem; cursor: pointer; min-height: 44px;
    font-family: inherit; font-size: 0.9rem;
  }
  .danger-btn:hover { background: #fce4e4; }

  /* ── Form fields (inside modal) ─────────────────────────────────────────── */
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 0.75rem;
    row-gap: 0.55rem;
    align-items: end;
    margin-bottom: 0.25rem;
  }
  @media (max-width: 520px) {
    .grid { grid-template-columns: 1fr; }
  }
  label {
    display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem;
    justify-content: flex-end;
  }
  label.full { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; }
  input[type='text'], input[type='number'], select {
    padding: 0.6rem; border: 2px solid #d0d7d0; border-radius: 4px;
    font-size: 1rem; min-height: 48px; font-family: inherit;
  }
  label.guessed {
    border-left: 3px solid #e6a817; padding-left: 0.6rem;
    background: #fffbf0; border-radius: 0 4px 4px 0;
  }
  label.catalog {
    border-left: 3px solid #1f5e3a; padding-left: 0.6rem;
    background: #f3f9f4; border-radius: 0 4px 4px 0;
  }
  .est-tag {
    font-style: normal; font-size: 0.7rem; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.4px; background: #e6a817; color: #fff;
    padding: 0.1rem 0.4rem; border-radius: 3px; margin-left: 0.4rem; vertical-align: middle;
  }
  .cat-tag {
    font-style: normal; font-size: 0.68rem; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.4px; background: #1f5e3a; color: #fff;
    padding: 0.1rem 0.4rem; border-radius: 3px; margin-left: 0.4rem; vertical-align: middle;
  }
  .new-tag {
    font-style: normal; font-size: 0.68rem; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.4px; background: #2563eb; color: #fff;
    padding: 0.1rem 0.4rem; border-radius: 3px; margin-left: 0.4rem; vertical-align: middle;
  }

  /* Phase 17 follow-up — AI Refresh from web */
  .ai-refresh-block {
    margin: 0.6rem 0 0.4rem;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 0.6rem 0.75rem;
    background: #f8fafc;
  }
  .ai-refresh-btn {
    background: #6366f1; color: #fff; border: none; border-radius: 4px;
    padding: 0.45rem 0.85rem; font-size: 0.85rem; font-weight: 600;
    cursor: pointer; min-height: unset; font-family: inherit;
  }
  .ai-refresh-btn:hover { background: #4f46e5; }
  .ai-refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .ai-refresh-error {
    margin: 0.5rem 0 0; color: #b00020; font-size: 0.85rem;
  }
  .ai-refresh-diff { margin-top: 0.6rem; }
  .ai-refresh-diff-title {
    margin: 0 0 0.4rem; font-size: 0.85rem; color: #1e293b; font-weight: 600;
  }
  .ai-refresh-notes {
    margin: 0 0 0.5rem; font-size: 0.8rem; color: #475569; font-style: italic;
  }
  .ai-refresh-list { list-style: none; padding: 0; margin: 0 0 0.5rem; }
  .ai-refresh-row {
    display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
    padding: 0.3rem 0; border-bottom: 1px dashed #e2e8f0;
    font-size: 0.85rem;
  }
  .ai-refresh-row:last-child { border-bottom: none; }
  .ai-refresh-check { display: flex; align-items: center; gap: 0.4rem; min-width: 0; }
  .ai-refresh-key { font-weight: 600; color: #1e293b; }
  .ai-refresh-value { color: #475569; font-family: ui-monospace, monospace; font-size: 0.8rem; }
  .ai-refresh-cite {
    margin-left: auto; color: #2563eb; font-size: 0.78rem; text-decoration: underline;
  }
  .ai-refresh-actions {
    display: flex; gap: 0.5rem; margin-top: 0.6rem;
  }

  /* Catalog-save offer (unlinked seed items) */
  .catalog-offer {
    display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
    background: #eff5ff; border: 1px solid #bcd4f5; border-radius: 6px;
    padding: 0.6rem 0.75rem; margin: 0.5rem 0 0.25rem; flex-wrap: wrap;
  }
  .catalog-offer-text { display: flex; flex-direction: column; gap: 0.15rem; flex: 1; min-width: 200px; }
  .catalog-offer-text strong { color: #1e40af; font-size: 0.9rem; }
  .catalog-offer-text span { color: #475569; font-size: 0.8rem; }
  .catalog-offer-btn {
    background: #2563eb; color: #fff; border: none; border-radius: 4px;
    padding: 0.4rem 0.85rem; font-size: 0.85rem; font-weight: 600; cursor: pointer;
    min-height: unset; min-width: unset; font-family: inherit; flex-shrink: 0;
  }
  .catalog-offer-btn:hover { background: #1d4ed8; }

  /* Linked-catalog summary */
  .catalog-link-section {
    background: #f0f5f1; border: 1px solid #cfdfd2; border-radius: 6px;
    padding: 0.6rem 0.75rem; margin: 0.5rem 0 0.25rem;
  }
  .catalog-link-header {
    display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap;
  }
  .catalog-link-label {
    font-size: 0.85rem; color: #1f5e3a; display: flex; align-items: center; gap: 0.4rem;
  }
  .catalog-link-check {
    background: #1f5e3a; color: #fff; width: 20px; height: 20px; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 0.75rem; font-weight: 700;
  }
  .catalog-unlink-btn {
    background: transparent; color: #555; border: 1px solid #b8c4ba;
    border-radius: 4px; padding: 0.2rem 0.6rem; font-size: 0.78rem;
    cursor: pointer; min-height: unset; min-width: unset; font-family: inherit;
  }
  .catalog-unlink-btn:hover { background: #fff; color: #b00020; border-color: #b00020; }
  .catalog-meta {
    display: grid; grid-template-columns: max-content 1fr;
    gap: 0.15rem 0.75rem; margin: 0.5rem 0 0; font-size: 0.8rem;
  }
  .catalog-meta dt { color: #6a7a6c; font-weight: 600; }
  .catalog-meta dd { margin: 0; color: #1a1a1a; }
  .seed-section-header {
    display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem;
    flex-wrap: wrap; margin-bottom: 0.4rem;
  }
  .catalog-hint { font-size: 0.75rem; color: #1f5e3a; font-style: italic; }
  .field-label { display: flex; align-items: center; gap: 0.2rem; flex-wrap: wrap; }
  .full-col { grid-column: 1 / -1; }
  .form-section { padding-top: 0.6rem; margin-top: 0.25rem; border-top: 1px solid #e8ede8; }
  .seed-section {
    background: #f9fcf9; border-radius: 6px; padding: 0.6rem;
    border: 1px solid #d0ddd0; margin-top: 0.5rem;
  }
  .subsection-title {
    font-size: 0.85rem; font-weight: 700; color: #1f5e3a; text-transform: uppercase;
    letter-spacing: 0.5px; margin: 0 0 0.5rem;
  }
  .range-inputs { display: flex; align-items: center; gap: 0.4rem; }
  .range-inputs input { flex: 1; min-width: 0; }
  .range-sep { font-size: 1.1rem; color: #555; flex-shrink: 0; }
  .reorder-label .field-label { align-items: center; }
  .reorder-check { width: 18px; height: 18px; min-height: unset; padding: 0; border: none; margin: 0; cursor: pointer; }
  .reorder-off {
    font-size: 0.85rem;
    color: #888;
    font-style: italic;
    min-height: 48px;
    display: flex;
    align-items: center;
    padding: 0 0.6rem;
  }
  .barcode-hint {
    font-size: 0.78rem; color: #666; font-family: monospace; background: #f5f7f4;
    padding: 0.2rem 0.5rem; border-radius: 3px; border: 1px solid #d0d7d0; margin-top: 0.5rem;
  }

  /* ── Scan buttons + notices (inside add modal) ──────────────────────────── */
  .scan-btns { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; padding: 0.6rem 1.25rem 0; }
  .scan-spinner { font-size: 0.82rem; color: #555; }
  .scan-btn {
    padding: 0.4rem 0.9rem; border: 1.5px solid #1f5e3a; background: #fff;
    color: #1f5e3a; border-radius: 6px; font-size: 0.85rem; font-weight: 600;
    cursor: pointer; min-height: 40px; font-family: inherit;
  }
  .scan-btn:hover:not(:disabled) { background: #f0f5f1; }
  .scan-btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .ai-btn { background: #f5f0ff; border-color: #7c3aed; color: #6d28d9; }
  .ai-btn:hover:not(:disabled) { background: #ede9fe; }
  .scan-notice {
    font-size: 0.82rem; color: #2e7d32; background: #e7f1ea;
    border-left: 3px solid #1f5e3a; padding: 0.4rem 0.7rem; border-radius: 3px;
    margin: 0.4rem 1.25rem 0;
  }
  .scan-error {
    font-size: 0.85rem; color: #b00020; background: #fce4e4;
    border-left: 3px solid #b00020; padding: 0.4rem 0.7rem; border-radius: 3px;
    margin: 0.4rem 1.25rem 0;
  }

  /* ── Shared buttons ─────────────────────────────────────────────────────── */
  .primary {
    background: #1f5e3a; color: white; border: none; border-radius: 6px;
    padding: 0.6rem 1.1rem; font-weight: 600; cursor: pointer; min-height: 44px; font-family: inherit;
  }
  .primary:disabled { background: #999; cursor: not-allowed; }
  .secondary {
    background: white; color: #555; border: 1.5px solid #d0d7d0; border-radius: 6px;
    padding: 0.6rem 1rem; font-size: 0.9rem; cursor: pointer; min-height: 44px; font-family: inherit;
  }
  .secondary:hover { background: #f5f7f4; }
  .error { color: #b00020; font-size: 0.85rem; margin: 0; }

  /* ── Spinner ────────────────────────────────────────────────────────────── */
  @keyframes spin { to { transform: rotate(360deg); } }
  .spin { display: inline-block; animation: spin 0.8s linear infinite; }
</style>
