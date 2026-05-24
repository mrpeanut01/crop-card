<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { CHEMISTRY_CLASSES, type ChemistryClass } from '$lib/safety/types';
  import { CROP_FAMILIES, type CropFamily } from '$lib/safety/cropFamilyLethality';
  import HelpIcon from '$lib/components/HelpIcon.svelte';
  import PluginIdPicker from '$lib/components/PluginIdPicker.svelte';
  import PluginTaskListEditor, {
    type PluginTaskRow
  } from '$lib/components/PluginTaskListEditor.svelte';

  let { data } = $props();

  // ─── Slug + unique-id helpers ─────────────────────────────────────────

  function slugify(s: string): string {
    return s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
  }

  /** Return a slug not already in `existing`, appending -2/-3/... on collision.
   *  When `keepSlug` is provided (edit flow), passes that through unchanged
   *  so the upload endpoint correctly maps to the existing plugin and
   *  auto-bumps the version instead of creating a new row. */
  function uniqueSlug(base: string, existing: ReadonlyArray<string>, keepSlug?: string): string {
    if (keepSlug && existing.includes(keepSlug)) return keepSlug;
    const seed = slugify(base);
    if (!seed) return '';
    if (!existing.includes(seed)) return seed;
    for (let i = 2; i < 999; i++) {
      const candidate = `${seed}-${i}`.slice(0, 64);
      if (!existing.includes(candidate)) return candidate;
    }
    return seed;
  }

  const existingIds = $derived(data.existingPluginIds ?? []);

  // ─── Plugin kind dropdown ─────────────────────────────────────────────

  type Mode = 'crop' | 'herbicide' | 'insecticide' | 'fungicide' | 'fertilizer' | 'companion';
  const MODES: Mode[] = [
    'crop',
    'herbicide',
    'insecticide',
    'fungicide',
    'fertilizer',
    'companion'
  ];
  const MODE_LABELS: Record<Mode, string> = {
    crop: 'Crop variety',
    herbicide: 'Herbicide',
    insecticide: 'Insecticide',
    fungicide: 'Fungicide',
    fertilizer: 'Fertilizer',
    companion: 'Companion system'
  };

  // ─── Prefill parsing ──────────────────────────────────────────────────
  //
  // `URLSearchParams.get()` already URL-decodes the value once; don't
  // double-decode (would crash on literal '%' in a herbicide note like
  // "Glyphosate 41%"). Pass straight to JSON.parse and surface errors.

  const prefillRaw = $derived(page.url.searchParams.get('prefill'));
  const prefillParse = $derived.by(() => {
    if (!prefillRaw) return { kind: 'absent' as const };
    try {
      const obj = JSON.parse(prefillRaw) as Record<string, unknown>;
      return { kind: 'ok' as const, obj };
    } catch (e) {
      return { kind: 'error' as const, message: e instanceof Error ? e.message : String(e) };
    }
  });

  function initialMode(): Mode | '' {
    const r = page.url.searchParams.get('prefill');
    if (!r) return '';
    try {
      const o = JSON.parse(r) as Record<string, unknown>;
      if (typeof o.type === 'string' && (MODES as string[]).includes(o.type)) {
        return o.type as Mode;
      }
    } catch {
      /* fall through */
    }
    return '';
  }

  /** Empty string = "no selection" — keeps the form hidden until the
   *  operator picks a type. Prefill arrivals land on the matching mode. */
  let mode = $state<Mode | ''>(initialMode());

  // ─── Crop form state ──────────────────────────────────────────────────

  let cropPluginId = $state('');
  let cropDisplayName = $state('');
  let cropFamily = $state<CropFamily>('corn');
  let cropDtmMin = $state<number | undefined>(undefined);
  let cropDtmMax = $state<number | undefined>(undefined);
  let cropRowSpacing = $state<number | undefined>(undefined);
  let cropPHI = $state<number | undefined>(undefined);
  let cropIndicators = $state('');
  let cropNotes = $state('');
  let preTasks = $state<PluginTaskRow[]>([]);
  let postTasks = $state<PluginTaskRow[]>([]);
  let seasonalTasks = $state<PluginTaskRow[]>([]);

  // ─── Herbicide form state ─────────────────────────────────────────────

  let hPluginId = $state('');
  let hDisplayName = $state('');
  let hChemistryClass = $state<ChemistryClass>('synthetic-auxin');
  let hActiveName = $state('');
  let hRateAmount = $state<number | undefined>(undefined);
  let hRateUnit = $state<'oz' | 'fl-oz' | 'lb' | 'pt' | 'qt'>('fl-oz');
  let hGpa = $state(15);
  let hRequiresAMS = $state(false);
  let hDeconRequired = $state(false);
  let hSafeForCropIds = $state<string[]>([]);
  let hNotes = $state('');
  let hApplicationTiming = $state<'' | 'BURNDOWN' | 'PRE' | 'POST' | 'POST-DIRECTED'>('');

  // ─── Insecticide form state ───────────────────────────────────────────

  let iPluginId = $state('');
  let iDisplayName = $state('');
  let iActiveName = $state('');
  let iIracGroup = $state('');
  let iRateAmount = $state<number | undefined>(undefined);
  let iRateUnit = $state<'oz' | 'fl-oz' | 'lb' | 'pt' | 'qt'>('fl-oz');
  let iReEntryHours = $state<number | undefined>(undefined);
  let iPhiDays = $state<number | undefined>(undefined);
  let iPollinatorRisk = $state<'none' | 'low' | 'moderate' | 'high'>('low');
  let iTargetPests = $state('');
  let iNotes = $state('');

  // ─── Fungicide form state ─────────────────────────────────────────────

  let fPluginId = $state('');
  let fDisplayName = $state('');
  let fActiveName = $state('');
  let fFracCode = $state('');
  let fRateAmount = $state<number | undefined>(undefined);
  let fRateUnit = $state<'oz' | 'fl-oz' | 'lb' | 'pt' | 'qt'>('fl-oz');
  let fReEntryHours = $state<number | undefined>(undefined);
  let fPhiDays = $state<number | undefined>(undefined);
  let fPollinatorRisk = $state<'none' | 'low' | 'moderate' | 'high'>('low');
  let fApplicationTiming = $state<
    '' | 'DORMANT' | 'PRE-BLOOM' | 'BLOOM' | 'POST-BLOOM' | 'COVER' | 'PRE-HARVEST'
  >('');
  let fTargetDiseases = $state('');
  let fNotes = $state('');

  // ─── Fertilizer form state ────────────────────────────────────────────

  let ftPluginId = $state('');
  let ftDisplayName = $state('');
  let ftN = $state<number | undefined>(undefined);
  let ftP = $state<number | undefined>(undefined);
  let ftK = $state<number | undefined>(undefined);
  let ftForm = $state<'granular' | 'liquid' | 'soluble' | 'compost' | 'slow-release' | 'meal'>(
    'granular'
  );
  let ftOrganic = $state(false);
  let ftNotes = $state('');

  // ─── Companion form state ─────────────────────────────────────────────

  let cmpPluginId = $state('');
  let cmpDisplayName = $state('');
  let cmpPrimaryFamily = $state<CropFamily>('corn');
  let cmpGoodWith = $state<string[]>([]);
  let cmpBadWith = $state<string[]>([]);
  let cmpBenefit = $state('');

  // ─── Resolved pluginIds (auto-derived from display name) ──────────────
  //
  // Each `xPluginId` state holds the value carried in from a prefill
  // (when editing an existing plugin). When set, the resolved value
  // passes through unchanged so the upload endpoint maps to the
  // existing row and auto-bumps the version. When empty, we slugify
  // the display name and ensure uniqueness against the live registry.

  const cropResolvedPluginId = $derived(
    uniqueSlug(cropDisplayName, existingIds, cropPluginId || undefined)
  );
  const hResolvedPluginId = $derived(uniqueSlug(hDisplayName, existingIds, hPluginId || undefined));
  const iResolvedPluginId = $derived(uniqueSlug(iDisplayName, existingIds, iPluginId || undefined));
  const fResolvedPluginId = $derived(uniqueSlug(fDisplayName, existingIds, fPluginId || undefined));
  const ftResolvedPluginId = $derived(
    uniqueSlug(ftDisplayName, existingIds, ftPluginId || undefined)
  );
  const cmpResolvedPluginId = $derived(
    uniqueSlug(cmpDisplayName, existingIds, cmpPluginId || undefined)
  );

  // ─── Extras (fields the form doesn't expose) ──────────────────────────
  //
  // When a candidate carries extra fields the per-kind form doesn't
  // surface (e.g. complianceFlags, scoutingThresholds, traitGatedSafeFor,
  // companion members[]), we stash them here so they survive the round
  // trip. The build payload merges them under the form-supplied fields.

  let extras = $state<Record<string, unknown>>({});

  // ─── Hydrate from prefill (runs once on arrival) ──────────────────────

  let hydrated = $state(false);
  $effect(() => {
    if (hydrated) return;
    if (prefillParse.kind !== 'ok') return;
    hydrate(prefillParse.obj);
    hydrated = true;
  });

  function hydrate(o: Record<string, unknown>): void {
    const t = typeof o.type === 'string' ? o.type : null;
    if (t === 'crop') hydrateCrop(o);
    else if (t === 'herbicide') hydrateHerbicide(o);
    else if (t === 'insecticide') hydrateInsecticide(o);
    else if (t === 'fungicide') hydrateFungicide(o);
    else if (t === 'fertilizer') hydrateFertilizer(o);
    else if (t === 'companion') hydrateCompanion(o);
  }

  function setExtras(o: Record<string, unknown>, formKeys: ReadonlyArray<string>): void {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (!formKeys.includes(k)) out[k] = v;
    }
    extras = out;
  }

  /** Lift a prefill task object back into a PluginTaskRow shape. The Zod
   *  schemas accept partial shapes; we read every known optional key
   *  defensively and leave unrelated fields off the row. */
  function hydrateTaskRow(raw: unknown): PluginTaskRow | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const num = (k: string): number | undefined =>
      typeof r[k] === 'number' ? (r[k] as number) : undefined;
    const str = (k: string): string | undefined =>
      typeof r[k] === 'string' && (r[k] as string).length > 0 ? (r[k] as string) : undefined;
    const SEASONAL_KINDS = [
      'spray',
      'cultural',
      'pruning',
      'thinning',
      'fertilize',
      'irrigate',
      'scout',
      'harvest'
    ];
    const kindRaw = str('kind');
    return {
      key: typeof r.key === 'string' ? r.key : '',
      title: typeof r.title === 'string' ? r.title : '',
      body: typeof r.body === 'string' ? r.body : '',
      category: typeof r.category === 'string' ? (r.category as PluginTaskRow['category']) : '',
      daysBeforePlant: num('daysBeforePlant'),
      daysBeforeFirstHarvest: num('daysBeforeFirstHarvest'),
      daysBeforePhase: num('daysBeforePhase'),
      daysAfterPlant: num('daysAfterPlant'),
      daysAfterHarvest: num('daysAfterHarvest'),
      daysAfterPhase: num('daysAfterPhase'),
      phaseKey: str('phaseKey'),
      kind:
        kindRaw && SEASONAL_KINDS.includes(kindRaw)
          ? (kindRaw as PluginTaskRow['kind'])
          : undefined,
      dayOfYear: num('dayOfYear'),
      daysAfterPlanting: num('daysAfterPlanting'),
      windowDays: num('windowDays')
    };
  }

  function hydrateCrop(o: Record<string, unknown>) {
    cropPluginId = String(o.pluginId ?? '');
    cropDisplayName = String(o.displayName ?? '');
    if (
      typeof o.cropFamily === 'string' &&
      (CROP_FAMILIES as readonly string[]).includes(o.cropFamily)
    ) {
      cropFamily = o.cropFamily as CropFamily;
    }
    const dtm = o.daysToMaturity as { min?: number; max?: number } | undefined;
    if (typeof dtm?.min === 'number') cropDtmMin = dtm.min;
    if (typeof dtm?.max === 'number') cropDtmMax = dtm.max;
    if (typeof o.defaultRowSpacingInches === 'number') cropRowSpacing = o.defaultRowSpacingInches;
    if (typeof o.preHarvestIntervalDays === 'number') cropPHI = o.preHarvestIntervalDays;
    if (Array.isArray(o.harvestIndicators))
      cropIndicators = (o.harvestIndicators as string[]).join('\n');
    if (typeof o.notes === 'string') cropNotes = o.notes;
    if (Array.isArray(o.preTasks)) {
      preTasks = (o.preTasks as unknown[])
        .map(hydrateTaskRow)
        .filter((r): r is PluginTaskRow => r !== null);
    }
    if (Array.isArray(o.postTasks)) {
      postTasks = (o.postTasks as unknown[])
        .map(hydrateTaskRow)
        .filter((r): r is PluginTaskRow => r !== null);
    }
    if (Array.isArray(o.seasonalTasks)) {
      seasonalTasks = (o.seasonalTasks as unknown[])
        .map(hydrateTaskRow)
        .filter((r): r is PluginTaskRow => r !== null);
    }
    setExtras(o, [
      'pluginId',
      'type',
      'displayName',
      'version',
      'pluginSchemaVersion',
      'cropFamily',
      'daysToMaturity',
      'defaultRowSpacingInches',
      'preHarvestIntervalDays',
      'harvestIndicators',
      'notes',
      'preTasks',
      'postTasks',
      'seasonalTasks'
    ]);
  }

  function hydrateHerbicide(o: Record<string, unknown>) {
    hPluginId = String(o.pluginId ?? '');
    hDisplayName = String(o.displayName ?? '');
    const ais =
      (o.activeIngredients as Array<{ name?: string; chemistryClass?: string }> | undefined) ?? [];
    if (ais[0]?.name) hActiveName = String(ais[0].name);
    if (
      ais[0]?.chemistryClass &&
      (CHEMISTRY_CLASSES as readonly string[]).includes(ais[0].chemistryClass)
    ) {
      hChemistryClass = ais[0].chemistryClass as ChemistryClass;
    }
    const rate = o.ratePerAcre as { amount?: number; unit?: string } | undefined;
    if (typeof rate?.amount === 'number') hRateAmount = rate.amount;
    if (rate?.unit && ['oz', 'fl-oz', 'lb', 'pt', 'qt'].includes(rate.unit)) {
      hRateUnit = rate.unit as typeof hRateUnit;
    }
    if (typeof o.gpaCalibration === 'number') hGpa = o.gpaCalibration;
    if (typeof o.requiresAMS === 'boolean') hRequiresAMS = o.requiresAMS;
    if (typeof o.deconRequired === 'boolean') hDeconRequired = o.deconRequired;
    if (
      typeof o.applicationTiming === 'string' &&
      ['BURNDOWN', 'PRE', 'POST', 'POST-DIRECTED'].includes(o.applicationTiming)
    ) {
      hApplicationTiming = o.applicationTiming as typeof hApplicationTiming;
    }
    const lc = o.labelClaims as { safeForCropPluginIds?: string[] } | undefined;
    if (Array.isArray(lc?.safeForCropPluginIds)) {
      hSafeForCropIds = [...lc.safeForCropPluginIds];
    }
    if (typeof o.notes === 'string') hNotes = o.notes;
    setExtras(o, [
      'pluginId',
      'type',
      'displayName',
      'version',
      'pluginSchemaVersion',
      'activeIngredients',
      'ratePerAcre',
      'gpaCalibration',
      'requiresAMS',
      'deconRequired',
      'applicationTiming',
      'labelClaims',
      'notes'
    ]);
  }

  function hydrateInsecticide(o: Record<string, unknown>) {
    iPluginId = String(o.pluginId ?? '');
    iDisplayName = String(o.displayName ?? '');
    const ais =
      (o.activeIngredients as Array<{ name?: string; iracGroup?: string }> | undefined) ?? [];
    if (ais[0]?.name) iActiveName = String(ais[0].name);
    if (ais[0]?.iracGroup) iIracGroup = String(ais[0].iracGroup);
    const rate = o.ratePerAcre as { amount?: number; unit?: string } | undefined;
    if (typeof rate?.amount === 'number') iRateAmount = rate.amount;
    if (rate?.unit && ['oz', 'fl-oz', 'lb', 'pt', 'qt'].includes(rate.unit)) {
      iRateUnit = rate.unit as typeof iRateUnit;
    }
    if (typeof o.reEntryIntervalHours === 'number') iReEntryHours = o.reEntryIntervalHours;
    if (typeof o.preHarvestIntervalDays === 'number') iPhiDays = o.preHarvestIntervalDays;
    if (
      typeof o.pollinatorRisk === 'string' &&
      ['none', 'low', 'moderate', 'high'].includes(o.pollinatorRisk)
    ) {
      iPollinatorRisk = o.pollinatorRisk as typeof iPollinatorRisk;
    }
    if (Array.isArray(o.targetPests)) iTargetPests = (o.targetPests as string[]).join(', ');
    if (typeof o.notes === 'string') iNotes = o.notes;
    setExtras(o, [
      'pluginId',
      'type',
      'displayName',
      'version',
      'pluginSchemaVersion',
      'activeIngredients',
      'ratePerAcre',
      'reEntryIntervalHours',
      'preHarvestIntervalDays',
      'pollinatorRisk',
      'targetPests',
      'notes'
    ]);
  }

  function hydrateFungicide(o: Record<string, unknown>) {
    fPluginId = String(o.pluginId ?? '');
    fDisplayName = String(o.displayName ?? '');
    const ais =
      (o.activeIngredients as Array<{ name?: string; fracCode?: string }> | undefined) ?? [];
    if (ais[0]?.name) fActiveName = String(ais[0].name);
    if (ais[0]?.fracCode) fFracCode = String(ais[0].fracCode);
    const rate = o.ratePerAcre as { amount?: number; unit?: string } | undefined;
    if (typeof rate?.amount === 'number') fRateAmount = rate.amount;
    if (rate?.unit && ['oz', 'fl-oz', 'lb', 'pt', 'qt'].includes(rate.unit)) {
      fRateUnit = rate.unit as typeof fRateUnit;
    }
    if (typeof o.reEntryIntervalHours === 'number') fReEntryHours = o.reEntryIntervalHours;
    if (typeof o.preHarvestIntervalDays === 'number') fPhiDays = o.preHarvestIntervalDays;
    if (
      typeof o.pollinatorRisk === 'string' &&
      ['none', 'low', 'moderate', 'high'].includes(o.pollinatorRisk)
    ) {
      fPollinatorRisk = o.pollinatorRisk as typeof fPollinatorRisk;
    }
    if (
      typeof o.applicationTiming === 'string' &&
      ['DORMANT', 'PRE-BLOOM', 'BLOOM', 'POST-BLOOM', 'COVER', 'PRE-HARVEST'].includes(
        o.applicationTiming
      )
    ) {
      fApplicationTiming = o.applicationTiming as typeof fApplicationTiming;
    }
    if (Array.isArray(o.targetDiseases))
      fTargetDiseases = (o.targetDiseases as string[]).join(', ');
    if (typeof o.notes === 'string') fNotes = o.notes;
    setExtras(o, [
      'pluginId',
      'type',
      'displayName',
      'version',
      'pluginSchemaVersion',
      'activeIngredients',
      'ratePerAcre',
      'reEntryIntervalHours',
      'preHarvestIntervalDays',
      'pollinatorRisk',
      'applicationTiming',
      'targetDiseases',
      'notes'
    ]);
  }

  function hydrateFertilizer(o: Record<string, unknown>) {
    ftPluginId = String(o.pluginId ?? '');
    ftDisplayName = String(o.displayName ?? '');
    const a = o.analysis as { n?: number; p?: number; k?: number } | undefined;
    if (typeof a?.n === 'number') ftN = a.n;
    if (typeof a?.p === 'number') ftP = a.p;
    if (typeof a?.k === 'number') ftK = a.k;
    if (
      typeof o.form === 'string' &&
      ['granular', 'liquid', 'soluble', 'compost', 'slow-release', 'meal'].includes(o.form)
    ) {
      ftForm = o.form as typeof ftForm;
    }
    if (typeof o.organic === 'boolean') ftOrganic = o.organic;
    if (typeof o.notes === 'string') ftNotes = o.notes;
    setExtras(o, [
      'pluginId',
      'type',
      'displayName',
      'version',
      'pluginSchemaVersion',
      'analysis',
      'form',
      'organic',
      'notes'
    ]);
  }

  function hydrateCompanion(o: Record<string, unknown>) {
    cmpPluginId = String(o.pluginId ?? '');
    cmpDisplayName = String(o.displayName ?? '');
    if (
      typeof o.primaryFamily === 'string' &&
      (CROP_FAMILIES as readonly string[]).includes(o.primaryFamily)
    ) {
      cmpPrimaryFamily = o.primaryFamily as CropFamily;
    }
    if (Array.isArray(o.goodWith)) cmpGoodWith = [...(o.goodWith as string[])];
    if (Array.isArray(o.badWith)) cmpBadWith = [...(o.badWith as string[])];
    if (typeof o.benefit === 'string') cmpBenefit = o.benefit;
    setExtras(o, [
      'pluginId',
      'type',
      'displayName',
      'version',
      'pluginSchemaVersion',
      'primaryFamily',
      'goodWith',
      'badWith',
      'benefit'
    ]);
  }

  // ─── Build payload per mode ───────────────────────────────────────────

  function compactTaskRow(
    row: PluginTaskRow,
    variant: 'preTasks' | 'postTasks' | 'seasonalTasks'
  ): Record<string, unknown> | null {
    const title = row.title.trim();
    const key = row.key.trim();
    if (!title || !key) return null;
    const out: Record<string, unknown> = { key, title };
    if (row.body.trim()) out.body = row.body.trim();
    if (row.category) out.category = row.category;
    if (variant === 'preTasks') {
      if (row.daysBeforePlant != null) out.daysBeforePlant = row.daysBeforePlant;
      if (row.daysBeforeFirstHarvest != null)
        out.daysBeforeFirstHarvest = row.daysBeforeFirstHarvest;
      if (row.daysBeforePhase != null) out.daysBeforePhase = row.daysBeforePhase;
      if (row.phaseKey?.trim()) out.phaseKey = row.phaseKey.trim();
    } else if (variant === 'postTasks') {
      if (row.daysAfterPlant != null) out.daysAfterPlant = row.daysAfterPlant;
      if (row.daysAfterHarvest != null) out.daysAfterHarvest = row.daysAfterHarvest;
      if (row.daysAfterPhase != null) out.daysAfterPhase = row.daysAfterPhase;
      if (row.phaseKey?.trim()) out.phaseKey = row.phaseKey.trim();
    } else {
      if (row.kind) out.kind = row.kind;
      if (row.dayOfYear != null) out.dayOfYear = row.dayOfYear;
      if (row.daysAfterPlanting != null) out.daysAfterPlanting = row.daysAfterPlanting;
      if (row.windowDays != null) out.windowDays = row.windowDays;
    }
    return out;
  }

  function commaList(s: string): string[] {
    return s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  }

  function buildCropPayload() {
    const indicators = cropIndicators
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const pre = preTasks
      .map((r) => compactTaskRow(r, 'preTasks'))
      .filter((x): x is Record<string, unknown> => x !== null);
    const post = postTasks
      .map((r) => compactTaskRow(r, 'postTasks'))
      .filter((x): x is Record<string, unknown> => x !== null);
    const seasonal = seasonalTasks
      .map((r) => compactTaskRow(r, 'seasonalTasks'))
      .filter((x): x is Record<string, unknown> => x !== null);
    return {
      ...extras,
      pluginId: cropResolvedPluginId,
      type: 'crop' as const,
      displayName: cropDisplayName.trim(),
      version: '1.0.0',
      pluginSchemaVersion: '1.1' as const,
      cropFamily,
      ...(cropDtmMin && cropDtmMax ? { daysToMaturity: { min: cropDtmMin, max: cropDtmMax } } : {}),
      ...(cropRowSpacing ? { defaultRowSpacingInches: cropRowSpacing } : {}),
      ...(cropPHI != null ? { preHarvestIntervalDays: cropPHI } : {}),
      ...(indicators.length > 0 ? { harvestIndicators: indicators } : {}),
      ...(cropNotes.trim() ? { notes: cropNotes.trim() } : {}),
      ...(pre.length > 0 ? { preTasks: pre } : {}),
      ...(post.length > 0 ? { postTasks: post } : {}),
      ...(seasonal.length > 0 ? { seasonalTasks: seasonal } : {})
    };
  }

  function buildHerbicidePayload() {
    const safeFor = hSafeForCropIds;
    return {
      ...extras,
      pluginId: hResolvedPluginId,
      type: 'herbicide' as const,
      displayName: hDisplayName.trim(),
      version: '1.0.0',
      pluginSchemaVersion: '1.1' as const,
      activeIngredients: [{ name: hActiveName.trim(), chemistryClass: hChemistryClass }],
      ratePerAcre: { amount: hRateAmount ?? 0, unit: hRateUnit },
      gpaCalibration: hGpa,
      requiresAMS: hRequiresAMS,
      deconRequired: hDeconRequired,
      ...(hApplicationTiming ? { applicationTiming: hApplicationTiming } : {}),
      ...(safeFor.length > 0 ? { labelClaims: { safeForCropPluginIds: safeFor } } : {}),
      ...(hNotes.trim() ? { notes: hNotes.trim() } : {})
    };
  }

  function buildInsecticidePayload() {
    const ai: Record<string, unknown> = { name: iActiveName.trim() };
    if (iIracGroup.trim()) ai.iracGroup = iIracGroup.trim();
    const pests = commaList(iTargetPests);
    return {
      ...extras,
      pluginId: iResolvedPluginId,
      type: 'insecticide' as const,
      displayName: iDisplayName.trim(),
      version: '1.0.0',
      pluginSchemaVersion: '1.1' as const,
      activeIngredients: [ai],
      ratePerAcre: { amount: iRateAmount ?? 0, unit: iRateUnit },
      reEntryIntervalHours: iReEntryHours ?? 0,
      ...(iPhiDays != null ? { preHarvestIntervalDays: iPhiDays } : {}),
      pollinatorRisk: iPollinatorRisk,
      ...(pests.length > 0 ? { targetPests: pests } : {}),
      ...(iNotes.trim() ? { notes: iNotes.trim() } : {})
    };
  }

  function buildFungicidePayload() {
    const ai: Record<string, unknown> = { name: fActiveName.trim() };
    if (fFracCode.trim()) ai.fracCode = fFracCode.trim();
    const diseases = commaList(fTargetDiseases);
    return {
      ...extras,
      pluginId: fResolvedPluginId,
      type: 'fungicide' as const,
      displayName: fDisplayName.trim(),
      version: '1.0.0',
      pluginSchemaVersion: '1.1' as const,
      activeIngredients: [ai],
      ratePerAcre: { amount: fRateAmount ?? 0, unit: fRateUnit },
      reEntryIntervalHours: fReEntryHours ?? 0,
      ...(fPhiDays != null ? { preHarvestIntervalDays: fPhiDays } : {}),
      pollinatorRisk: fPollinatorRisk,
      ...(fApplicationTiming ? { applicationTiming: fApplicationTiming } : {}),
      ...(diseases.length > 0 ? { targetDiseases: diseases } : {}),
      ...(fNotes.trim() ? { notes: fNotes.trim() } : {})
    };
  }

  function buildFertilizerPayload() {
    return {
      ...extras,
      pluginId: ftResolvedPluginId,
      type: 'fertilizer' as const,
      displayName: ftDisplayName.trim(),
      version: '1.0.0',
      pluginSchemaVersion: '1.1' as const,
      analysis: { n: ftN ?? 0, p: ftP ?? 0, k: ftK ?? 0 },
      form: ftForm,
      ...(ftOrganic ? { organic: true } : {}),
      ...(ftNotes.trim() ? { notes: ftNotes.trim() } : {})
    };
  }

  function buildCompanionPayload() {
    const good = cmpGoodWith;
    const bad = cmpBadWith;
    return {
      ...extras,
      pluginId: cmpResolvedPluginId,
      type: 'companion' as const,
      displayName: cmpDisplayName.trim(),
      version: '1.0.0',
      pluginSchemaVersion: '1.1' as const,
      primaryFamily: cmpPrimaryFamily,
      ...(good.length > 0 ? { goodWith: good } : {}),
      ...(bad.length > 0 ? { badWith: bad } : {}),
      ...(cmpBenefit.trim() ? { benefit: cmpBenefit.trim() } : {})
    };
  }

  const preview = $derived.by(() => {
    switch (mode) {
      case 'crop':
        return buildCropPayload();
      case 'herbicide':
        return buildHerbicidePayload();
      case 'insecticide':
        return buildInsecticidePayload();
      case 'fungicide':
        return buildFungicidePayload();
      case 'fertilizer':
        return buildFertilizerPayload();
      case 'companion':
        return buildCompanionPayload();
      default:
        return null;
    }
  });

  // ─── Submit ───────────────────────────────────────────────────────────

  let submitting = $state(false);
  let submitError = $state<string | null>(null);
  type RejectIssue = { path: string; message: string };
  let submitReject = $state<{ title: string; issues: RejectIssue[] } | null>(null);

  async function submit() {
    submitError = null;
    submitReject = null;
    submitting = true;
    try {
      const res = await fetch('/api/plugins/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preview)
      });
      const out = await res.json();
      if (!res.ok) {
        submitReject = {
          title:
            out.code === 'bypass'
              ? 'Rejected — would override a hard-locked safety rule'
              : out.code === 'schema'
                ? 'Rejected — schema validation failed'
                : `Rejected (HTTP ${res.status})`,
          issues:
            Array.isArray(out.issues) && out.issues.length > 0
              ? out.issues
              : [{ path: '', message: out.error ?? `HTTP ${res.status}` }]
        };
        return;
      }
      goto('/plugins');
    } catch (e) {
      submitError = e instanceof Error ? e.message : String(e);
    } finally {
      submitting = false;
    }
  }
</script>

<h1>Author a new plugin</h1>

{#if !data.canEdit}
  <section class="card role-locked">
    <h2>Owner role required</h2>
    <p>
      Authoring plugins changes the safety knowledge base for the whole farm. Sign in as Owner to
      use this wizard. Helpers can browse the existing catalog at <a href="/plugins">/plugins</a>.
    </p>
    <a class="primary" href="/signin">Sign in</a>
  </section>
{:else}
  {#if prefillParse.kind === 'error'}
    <section class="card">
      <h2>Prefill payload could not be read</h2>
      <div class="reject">
        <strong>⛔ {prefillParse.message}</strong>
        <p>
          Pick a type below and fill in the form manually, or go back to <a href="/plugins"
            >/plugins</a
          > and rerun the scan or search.
        </p>
      </div>
    </section>
  {/if}

  <p class="lede">
    {#if prefillParse.kind === 'ok'}
      Pre-filled from a {prefillParse.obj.type ?? 'plugin'} candidate. Review the fields below, edit anything
      that's wrong, then save. The kernel validates schema + bypass attempts at registration.
    {:else}
      Pick the plugin type, fill in the fields, then save. The kernel validates schema + bypass
      attempts at registration.
    {/if}
  </p>

  <section class="card">
    <div class="type-row">
      <label for="plugin-type-select" class="type-label">Plugin type</label>
      <select id="plugin-type-select" class="type-select" bind:value={mode}>
        <option value="" disabled>— Select a type —</option>
        {#each MODES as m (m)}
          <option value={m}>{MODE_LABELS[m]}</option>
        {/each}
      </select>
      {#if mode === ''}
        <span class="type-prompt">← Select the type of inventory you are adding</span>
      {/if}
    </div>
  </section>

  {#if mode === ''}
    <!-- Nothing else rendered until the operator picks a type. -->
  {:else if mode === 'crop'}
    <section class="card">
      <h2>Crop fields</h2>
      <div class="grid">
        <label>
          Display name
          <input type="text" bind:value={cropDisplayName} placeholder="e.g. Bantam Sweet Corn" />
        </label>
        <label>
          <span class="label-row">
            Crop family
            <HelpIcon
              label="What is crop family?"
              text="Botanical family the kernel reasons over (cucurbit, solanaceae, brassica, allium, …). Determines which chemistries are lethal vs safe and which companion systems apply."
            />
          </span>
          <select bind:value={cropFamily}>
            {#each CROP_FAMILIES as f}<option value={f}>{f}</option>{/each}
          </select>
        </label>
        <label>
          <span class="label-row">
            Days to maturity (min)
            <HelpIcon
              label="What is DTM min?"
              text="Earliest expected seed-to-harvest window. Drives calendar scheduling + the Plan-wizard's free-window check. Use the lower bound from the seed catalog."
            />
          </span>
          <input type="number" min="1" bind:value={cropDtmMin} />
        </label>
        <label>
          Days to maturity (max)
          <input type="number" min="1" bind:value={cropDtmMax} />
        </label>
        <label>
          Default row spacing (in)
          <input type="number" min="1" bind:value={cropRowSpacing} />
        </label>
        <label>
          <span class="label-row">
            Pre-harvest interval (days)
            <HelpIcon
              label="What is PHI?"
              text="Days between the last spray and a legal harvest. Defaults applied across all chemistries; individual sprays can override per-product."
            />
          </span>
          <input type="number" min="0" bind:value={cropPHI} />
        </label>
      </div>
      <label class="full">
        Harvest indicators (one per line)
        <textarea
          rows="4"
          bind:value={cropIndicators}
          placeholder={'e.g.\nHusks fully dry and papery\nBlack layer at kernel tip'}
        ></textarea>
      </label>
      <label class="full">
        Notes
        <textarea rows="3" bind:value={cropNotes}></textarea>
      </label>

      <PluginTaskListEditor
        label="Pre-tasks"
        helpText="Auto-attach when the operator schedules a primary task tied to this crop (e.g. 'Test germination 14d before plant')."
        variant="preTasks"
        rows={preTasks}
      />
      <PluginTaskListEditor
        label="Post-tasks"
        helpText="Fire after a referenced phase (e.g. 'Disc residue 7d after harvest')."
        variant="postTasks"
        rows={postTasks}
      />
      <PluginTaskListEditor
        label="Seasonal tasks"
        helpText="Calendar-anchored or planting-relative recurring tasks (e.g. 'Scout SWD weekly during fruit set')."
        variant="seasonalTasks"
        rows={seasonalTasks}
      />
    </section>
  {:else if mode === 'herbicide'}
    <section class="card">
      <h2>Herbicide fields</h2>
      <div class="grid">
        <label>
          <span class="label-row">Display name</span>
          <input type="text" bind:value={hDisplayName} placeholder="e.g. Atrazine 4L" />
        </label>
        <label>
          <span class="label-row">
            Chemistry class
            <HelpIcon
              label="What is chemistry class?"
              text="HRAC mode-of-action group identifier. Drives the safety kernel's kill matrix (which crop families this product harms) + resistance-rotation hints on /spray. Match the value to the active ingredient's HRAC group."
            />
          </span>
          <select bind:value={hChemistryClass}>
            {#each CHEMISTRY_CLASSES as c}<option value={c}>{c}</option>{/each}
          </select>
        </label>
        <label>
          <span class="label-row">
            Active ingredient name
            <HelpIcon
              label="What is active ingredient name?"
              text="Common chemical name as printed on the guaranteed-analysis section of the label (e.g. atrazine, glyphosate, pendimethalin). Not the brand name."
            />
          </span>
          <input type="text" bind:value={hActiveName} placeholder="e.g. atrazine" />
        </label>
        <label>
          <span class="label-row">
            Rate / acre (amount)
            <HelpIcon
              label="What is rate per acre?"
              text="Maximum label rate per acre. The sprayer evaluates this against your block's acreage to compute total product needed and tank loads."
            />
          </span>
          <input type="number" step="0.01" min="0" bind:value={hRateAmount} />
        </label>
        <label>
          Unit
          <select bind:value={hRateUnit}>
            <option value="fl-oz">fl-oz</option>
            <option value="oz">oz</option>
            <option value="pt">pt</option>
            <option value="qt">qt</option>
            <option value="lb">lb</option>
          </select>
        </label>
        <label>
          <span class="label-row">
            GPA calibration
            <HelpIcon
              label="What is GPA calibration?"
              text="Gallons of total spray solution per acre your sprayer is calibrated to deliver. CropCard's dilution math assumes this rate when computing product per tank."
            />
          </span>
          <input type="number" min="1" bind:value={hGpa} />
        </label>
        <label>
          <span class="label-row">
            Application timing
            <HelpIcon
              label="What is application timing?"
              text="BURNDOWN = pre-plant non-selective kill of existing vegetation. PRE = pre-emergence residual. POST = post-emergence over the established crop. POST-DIRECTED = directed spray in row middles, shielded from the crop."
            />
          </span>
          <select bind:value={hApplicationTiming}>
            <option value="">(unspecified)</option>
            <option value="BURNDOWN">BURNDOWN</option>
            <option value="PRE">PRE</option>
            <option value="POST">POST</option>
            <option value="POST-DIRECTED">POST-DIRECTED</option>
          </select>
        </label>
        <label class="checkbox-field">
          <span class="label-row">
            Requires AMS
            <HelpIcon
              label="What is AMS?"
              text="Ammonium-sulfate adjuvant. Some products (notably glyphosate in hard water) require AMS in the tank to perform. CropCard's spray flow surfaces a STOP if checked and AMS isn't in the tank-mix."
            />
          </span>
          <input type="checkbox" bind:checked={hRequiresAMS} />
        </label>
        <label class="checkbox-field">
          <span class="label-row">
            Decon required after use
            <HelpIcon
              label="What is decon required?"
              text="The sprayer must be decontaminated after this product before spraying anything else. The cross-contamination kernel blocks the next spray until a decon event is recorded."
            />
          </span>
          <input type="checkbox" bind:checked={hDeconRequired} />
        </label>
        <label class="picker-field">
          <span class="label-row">
            Label-safe crops <span class="muted">(default: empty)</span>
            <HelpIcon
              label="What is label-safe crops?"
              text="Only fill in when the manufacturer's label explicitly names crops the kernel would otherwise refuse to spray over (e.g. atrazine on corn, clethodim on cucurbits). The bypass check rejects entries that contradict the kill matrix. Most herbicides ship safely without this — leave it empty."
            />
          </span>
          <PluginIdPicker
            available={data.availablePlugins}
            selected={hSafeForCropIds}
            onChange={(ids) => (hSafeForCropIds = ids)}
            kind="crop"
            placeholder="Search crops by name…"
          />
        </label>
      </div>
      <label class="full">
        Notes
        <textarea rows="3" bind:value={hNotes}></textarea>
      </label>
    </section>
  {:else if mode === 'insecticide'}
    <section class="card">
      <h2>Insecticide fields</h2>
      <div class="grid">
        <label>
          Display name
          <input type="text" bind:value={iDisplayName} />
        </label>
        <label>
          <span class="label-row">
            Active ingredient name
            <HelpIcon
              label="What is active ingredient name?"
              text="Common chemical name as printed on the guaranteed-analysis section of the label (e.g. imidacloprid, spinosad). Not the brand name."
            />
          </span>
          <input type="text" bind:value={iActiveName} placeholder="e.g. imidacloprid" />
        </label>
        <label>
          <span class="label-row">
            IRAC group
            <HelpIcon
              label="What is IRAC group?"
              text="IRAC mode-of-action group code (e.g. 4A neonicotinoid, 1A organophosphate, 11A Bt). Drives resistance-rotation warnings — don't apply two products from the same group back-to-back."
            />
          </span>
          <input type="text" bind:value={iIracGroup} placeholder="e.g. 4A" />
        </label>
        <label>
          <span class="label-row">
            Rate / acre (amount)
            <HelpIcon
              label="What is rate per acre?"
              text="Maximum label rate per acre. Spray flow scales this against block acreage to compute total product needed."
            />
          </span>
          <input type="number" step="0.01" min="0" bind:value={iRateAmount} />
        </label>
        <label>
          Unit
          <select bind:value={iRateUnit}>
            <option value="fl-oz">fl-oz</option>
            <option value="oz">oz</option>
            <option value="pt">pt</option>
            <option value="qt">qt</option>
            <option value="lb">lb</option>
          </select>
        </label>
        <label>
          <span class="label-row">
            Re-entry interval (hours)
            <HelpIcon
              label="What is REI?"
              text="Field workers must wait this many hours after spraying before re-entering the treated area. Kernel surfaces a STOP for entries inside this window."
            />
          </span>
          <input type="number" min="0" bind:value={iReEntryHours} />
        </label>
        <label>
          <span class="label-row">
            Pre-harvest interval (days)
            <HelpIcon
              label="What is PHI?"
              text="Days between the last spray and a legal harvest. Kernel blocks harvest records inside this window."
            />
          </span>
          <input type="number" min="0" bind:value={iPhiDays} />
        </label>
        <label>
          <span class="label-row">
            Pollinator risk
            <HelpIcon
              label="What is pollinator risk?"
              text="Risk this product poses to bees + pollinators. Drives advisory warnings on sprays scheduled during bloom windows."
            />
          </span>
          <select bind:value={iPollinatorRisk}>
            <option value="none">none</option>
            <option value="low">low</option>
            <option value="moderate">moderate</option>
            <option value="high">high</option>
          </select>
        </label>
        <label>
          <span class="label-row">
            Target pests (comma-separated)
            <HelpIcon
              label="What are target pests?"
              text="Pests the label claims efficacy against. Used to nudge the operator from /scout into /spray/insecticide when a scouting threshold is crossed."
            />
          </span>
          <input
            type="text"
            bind:value={iTargetPests}
            placeholder="e.g. aphid, thrips, corn-earworm"
          />
        </label>
      </div>
      <label class="full">
        Notes
        <textarea rows="3" bind:value={iNotes}></textarea>
      </label>
    </section>
  {:else if mode === 'fungicide'}
    <section class="card">
      <h2>Fungicide fields</h2>
      <div class="grid">
        <label>
          Display name
          <input type="text" bind:value={fDisplayName} />
        </label>
        <label>
          <span class="label-row">
            Active ingredient name
            <HelpIcon
              label="What is active ingredient name?"
              text="Common chemical name as printed on the label (e.g. azoxystrobin, copper hydroxide, chlorothalonil). Not the brand name."
            />
          </span>
          <input type="text" bind:value={fActiveName} placeholder="e.g. azoxystrobin" />
        </label>
        <label>
          <span class="label-row">
            FRAC code
            <HelpIcon
              label="What is FRAC code?"
              text="FRAC mode-of-action group (M01 copper, P01 host-defense inducer, 1-99 single-site mechanisms, BM01 biological). Drives resistance-rotation warnings — alternate FRAC codes across the season to slow resistance."
            />
          </span>
          <input type="text" bind:value={fFracCode} placeholder="e.g. 11, M01, P01" />
        </label>
        <label>
          <span class="label-row">
            Rate / acre (amount)
            <HelpIcon
              label="What is rate per acre?"
              text="Maximum label rate per acre. Spray flow scales this against block acreage to compute total product needed."
            />
          </span>
          <input type="number" step="0.01" min="0" bind:value={fRateAmount} />
        </label>
        <label>
          Unit
          <select bind:value={fRateUnit}>
            <option value="fl-oz">fl-oz</option>
            <option value="oz">oz</option>
            <option value="pt">pt</option>
            <option value="qt">qt</option>
            <option value="lb">lb</option>
          </select>
        </label>
        <label>
          <span class="label-row">
            Re-entry interval (hours)
            <HelpIcon
              label="What is REI?"
              text="Field workers must wait this many hours after spraying before re-entering the treated area."
            />
          </span>
          <input type="number" min="0" bind:value={fReEntryHours} />
        </label>
        <label>
          <span class="label-row">
            Pre-harvest interval (days)
            <HelpIcon
              label="What is PHI?"
              text="Days between the last spray and a legal harvest."
            />
          </span>
          <input type="number" min="0" bind:value={fPhiDays} />
        </label>
        <label>
          <span class="label-row">
            Pollinator risk
            <HelpIcon
              label="What is pollinator risk?"
              text="Risk this product poses to bees + pollinators. Drives advisory warnings on sprays scheduled during bloom windows."
            />
          </span>
          <select bind:value={fPollinatorRisk}>
            <option value="none">none</option>
            <option value="low">low</option>
            <option value="moderate">moderate</option>
            <option value="high">high</option>
          </select>
        </label>
        <label>
          <span class="label-row">
            Application timing
            <HelpIcon
              label="What is application timing?"
              text="DORMANT = winter copper / lime-sulfur. PRE-BLOOM / BLOOM / POST-BLOOM = orchard fire-blight + scab windows. COVER = vegetative protectant. PRE-HARVEST = late-season disease protection within the PHI."
            />
          </span>
          <select bind:value={fApplicationTiming}>
            <option value="">(unspecified)</option>
            <option value="DORMANT">DORMANT</option>
            <option value="PRE-BLOOM">PRE-BLOOM</option>
            <option value="BLOOM">BLOOM</option>
            <option value="POST-BLOOM">POST-BLOOM</option>
            <option value="COVER">COVER</option>
            <option value="PRE-HARVEST">PRE-HARVEST</option>
          </select>
        </label>
        <label>
          <span class="label-row">
            Target diseases (comma-separated)
            <HelpIcon
              label="What are target diseases?"
              text="Diseases the label claims efficacy against. Used to suggest products on /scout when a disease pressure is observed."
            />
          </span>
          <input
            type="text"
            bind:value={fTargetDiseases}
            placeholder="e.g. early-blight, anthracnose"
          />
        </label>
      </div>
      <label class="full">
        Notes
        <textarea rows="3" bind:value={fNotes}></textarea>
      </label>
    </section>
  {:else if mode === 'fertilizer'}
    <section class="card">
      <h2>Fertilizer fields</h2>
      <div class="grid">
        <label>
          Display name
          <input type="text" bind:value={ftDisplayName} />
        </label>
        <label>
          <span class="label-row">
            N %
            <HelpIcon
              label="What is N %?"
              text="Guaranteed-analysis nitrogen percentage by weight, as printed on the label (the first number in N-P-K, e.g. 12-0-0 → 12)."
            />
          </span>
          <input type="number" step="0.1" min="0" max="100" bind:value={ftN} />
        </label>
        <label>
          <span class="label-row">
            P %
            <HelpIcon
              label="What is P %?"
              text="Guaranteed-analysis phosphate percentage (reported as P₂O₅), the second number in N-P-K labeling (e.g. 11-52-0 → 52)."
            />
          </span>
          <input type="number" step="0.1" min="0" max="100" bind:value={ftP} />
        </label>
        <label>
          <span class="label-row">
            K %
            <HelpIcon
              label="What is K %?"
              text="Guaranteed-analysis potash percentage (reported as K₂O), the third number in N-P-K labeling (e.g. 0-0-60 → 60)."
            />
          </span>
          <input type="number" step="0.1" min="0" max="100" bind:value={ftK} />
        </label>
        <label>
          <span class="label-row">
            Form
            <HelpIcon
              label="What is form?"
              text="Physical form of the product. Drives the application UI (broadcast vs side-dress vs foliar) and the dilution math for liquids."
            />
          </span>
          <select bind:value={ftForm}>
            <option value="granular">granular</option>
            <option value="liquid">liquid</option>
            <option value="soluble">soluble</option>
            <option value="compost">compost</option>
            <option value="slow-release">slow-release</option>
            <option value="meal">meal</option>
          </select>
        </label>
        <label class="checkbox-field">
          <span class="label-row">Organic</span>
          <input type="checkbox" bind:checked={ftOrganic} />
        </label>
      </div>
      <label class="full">
        Notes
        <textarea rows="3" bind:value={ftNotes}></textarea>
      </label>
    </section>
  {:else if mode === 'companion'}
    <section class="card">
      <h2>Companion fields</h2>
      <div class="grid">
        <label>
          Display name
          <input type="text" bind:value={cmpDisplayName} />
        </label>
        <label>
          <span class="label-row">
            Primary family
            <HelpIcon
              label="What is primary family?"
              text="Anchor crop family for this companion system. When the operator plants a member of this family, the engine emits companion-trigger events for the secondary members."
            />
          </span>
          <select bind:value={cmpPrimaryFamily}>
            {#each CROP_FAMILIES as f}<option value={f}>{f}</option>{/each}
          </select>
        </label>
      </div>
      <label class="picker-field full">
        <span class="label-row">
          Good with
          <HelpIcon
            label="What is good with?"
            text="Other crops this companion likes when planted nearby. Surfaced as ✓ chips in the companion advisor on /plan."
          />
        </span>
        <PluginIdPicker
          available={data.availablePlugins}
          selected={cmpGoodWith}
          onChange={(ids) => (cmpGoodWith = ids)}
          kind="crop"
          placeholder="Search crops by name…"
        />
      </label>
      <label class="picker-field full">
        <span class="label-row">
          Bad with
          <HelpIcon
            label="What is bad with?"
            text="Other crops this companion clashes with. Surfaced as ✗ warnings when both appear in the same block."
          />
        </span>
        <PluginIdPicker
          available={data.availablePlugins}
          selected={cmpBadWith}
          onChange={(ids) => (cmpBadWith = ids)}
          kind="crop"
          placeholder="Search crops by name…"
        />
      </label>
      <label class="full">
        Benefit
        <textarea rows="3" bind:value={cmpBenefit}></textarea>
      </label>
      {#if extras.members}
        <p class="muted">
          Member companions (from the prefill) will be preserved on save; edit via the JSON
          expansion below if needed.
        </p>
      {/if}
    </section>
  {/if}

  {#if mode !== ''}
    <details class="card">
      <summary>JSON preview (what will be saved)</summary>
      <pre>{JSON.stringify(preview, null, 2)}</pre>
    </details>

    <div class="footer-actions">
      <button class="primary" onclick={submit} disabled={submitting}>
        {submitting ? 'Saving…' : 'Save plugin'}
      </button>
      <a class="link" href="/plugins">Cancel</a>
    </div>
  {/if}

  {#if submitError}<p class="error">{submitError}</p>{/if}
  {#if submitReject}
    <div class="reject">
      <strong>⛔ {submitReject.title}</strong>
      <ul>
        {#each submitReject.issues as i}
          <li>
            {#if i.path}<code>{i.path}</code>{/if}
            {i.message}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
{/if}

<style>
  h1 {
    margin: 0 0 0.25rem;
  }
  .lede {
    color: #555;
    margin: 0 0 1.5rem;
  }
  .card {
    background: white;
    border-radius: 8px;
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .card h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    color: #1f5e3a;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .type-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .type-label {
    display: inline;
    flex-direction: row;
    margin: 0;
    font-weight: 600;
    color: #1f5e3a;
    font-size: 0.9rem;
    flex: 0 0 auto;
  }
  select.type-select {
    flex: 0 0 auto;
    width: 220px;
    max-width: 100%;
    padding: 0.4rem 0.6rem;
    border: 2px solid #d0d7d0;
    border-radius: 4px;
    font: inherit;
    font-size: 0.9rem;
    font-weight: 500;
    color: #222;
    background: white;
    height: 38px;
    box-sizing: border-box;
  }
  .type-prompt {
    color: #1f5e3a;
    font-weight: 500;
    font-size: 0.9rem;
    flex: 0 1 auto;
  }
  details.card summary {
    cursor: pointer;
    color: #1f5e3a;
    font-weight: 600;
    font-size: 0.95rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    list-style: revert;
  }
  details.card[open] summary {
    margin-bottom: 0.75rem;
  }
  details.card pre {
    background: #fafafa;
    border: 1px solid #d0d7d0;
    padding: 0.75rem;
    border-radius: 4px;
    font-size: 0.8rem;
    overflow-x: auto;
    margin: 0;
  }
  .footer-actions {
    display: flex;
    gap: 1rem;
    align-items: center;
    margin-top: 1rem;
    /* Stick the Save row above the fixed primary nav at the mobile viewport
     * so the CTA is always tap-reachable regardless of how long the form
     * scroll body is. The nav is ~112px + safe-area; sit just above it. */
    position: sticky;
    bottom: calc(112px + env(safe-area-inset-bottom, 0) + 0.5rem);
    background: white;
    padding: 0.75rem;
    border-top: 1px solid #e0e0e0;
    border-radius: 8px 8px 0 0;
    box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.05);
    z-index: 50;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 0.75rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
  }
  label.full {
    display: block;
    margin-top: 0.75rem;
  }
  /* Picker fields always span the full grid row so the chips row has
   *  enough horizontal space — otherwise a narrow auto-fill cell would
   *  hide chips past the first one under the horizontal overflow. */
  label.picker-field {
    grid-column: 1 / -1;
    min-width: 0;
  }
  label.checkbox-field {
    align-items: flex-start;
  }
  label.checkbox-field input[type='checkbox'] {
    width: 20px;
    height: 20px;
    margin: 0;
    cursor: pointer;
  }
  input[type='text'],
  input[type='number'],
  select,
  textarea {
    padding: 0.5rem 0.6rem;
    border: 2px solid #d0d7d0;
    border-radius: 4px;
    font: inherit;
    font-size: 0.9rem;
  }
  textarea {
    font-family: inherit;
    width: 100%;
    box-sizing: border-box;
  }
  button.primary {
    background: #1f5e3a;
    color: white;
    border: 0;
    padding: 0.75rem 1.5rem;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
    min-height: 48px;
    font-size: 1rem;
  }
  button.primary:disabled {
    background: #888;
    cursor: not-allowed;
  }
  .link {
    color: #1f5e3a;
    text-decoration: underline;
  }
  .error {
    color: #b00020;
    margin-top: 0.5rem;
  }
  .reject {
    margin-top: 0.75rem;
    background: #fce8e8;
    color: #b00020;
    padding: 0.6rem 0.8rem;
    border-radius: 4px;
    border-left: 4px solid #b00020;
    font-size: 0.9rem;
  }
  .reject ul {
    margin: 0.4rem 0 0;
    padding-left: 1.2rem;
  }
  .reject code {
    background: rgba(0, 0, 0, 0.05);
    padding: 0 0.25rem;
    border-radius: 2px;
  }
  .muted {
    color: #777;
    font-style: italic;
    font-size: 0.85rem;
  }
  .label-row {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    white-space: nowrap;
  }
  .role-locked p {
    margin: 0.5rem 0;
  }
</style>
