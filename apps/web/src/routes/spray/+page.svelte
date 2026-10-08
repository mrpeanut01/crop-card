<script lang="ts">
  import { cropFamilyLabel } from '$lib/plugins/familyLabel';
  import { cropDisplayNameByEnglish } from '$lib/i18n/cropName';
  import { noteHoldWrite } from '$lib/animals/recordClient';
  import { isUpdatingResponse, retryAfterSeconds } from '$lib/updating';
  import { goto, invalidateAll } from '$app/navigation';
  import { untrack } from 'svelte';
  import { splitSprayable, sprayableAcres } from '$lib/spray/sprayableBlocks';
  import SetupSheet from '$lib/components/setup/SetupSheet.svelte';
  import { focusAfterSetup } from '$lib/components/setup/focusAfterSetup';
  import SetupCallout from '$lib/components/setup/SetupCallout.svelte';
  import SetupSprayer from '$lib/components/setup/SetupSprayer.svelte';
  import SetupCalibration from '$lib/components/setup/SetupCalibration.svelte';
  import SetupPlantingBackfill from '$lib/components/setup/SetupPlantingBackfill.svelte';
  import type { SetupPlantingResult, SetupSprayerResult } from '$lib/setup/types';
  import GroupCodeBadge from '$lib/components/GroupCodeBadge.svelte';
  import { killsFamily, type CropFamily } from '$lib/safety/cropFamilyLethality';
  import { ingredientKillsFamily } from '$lib/safety/ingredientLethality';
  import { CHEMISTRY_CLASSES, type ChemistryClass } from '$lib/safety/types';
  import { herbicideRatePreview } from '$lib/dilution/ratePreview';
  import FallbackRateLine from '$lib/components/spray/FallbackRateLine.svelte';
  import Banner from '$lib/components/ui/Banner.svelte';
  import SprayPageHeader from '$lib/components/spray/SprayPageHeader.svelte';
  import { currentPrefs, fmt } from '$lib/prefsState.svelte';
  // Phase 25b (#85) — Almanac chrome (stepper + context strip) on top
  // of the existing herbicide flow. 1:1 with ASprayScreen.
  import SprayStepper, { type StepState } from '$lib/components/spray/SprayStepper.svelte';
  import SprayContextStrip, {
    type SprayContextBlock,
    type CompatibilityState
  } from '$lib/components/spray/SprayContextStrip.svelte';
  import { pastureNotice } from '$lib/farm/pastureNotice';
  import OrganicInputNotice from '$lib/components/organic/OrganicInputNotice.svelte';
  import { organicInputClass } from '$lib/organic/inputCompliance';
  import { createT } from '$lib/i18n';
  import { joinSentences } from '$lib/spray/contextLabels';
  import { chemistryClassLabel } from '$lib/records/chemistryClassLabel';
  import type { MessageKey } from '$lib/i18n';
  import TaskCloseNote from '$lib/components/tasks/TaskCloseNote.svelte';
  import type { RecordTaskClose } from '$lib/tasks/recordClose';

  // Stepper + context-strip $derived inputs computed below the rest of
  // the herbicide flow's state (selectedBlocks / sprayer / herbicides /
  // perBlockResults). Centralised here so the template stays clean.
  function deriveStepperData(): Array<{ label: string; state: StepState }> {
    const hasBlocks = selectedBlocks.length > 0;
    const hasSprayer = !!sprayer;
    const hasMix = selectedHerbicideIds.length > 0;
    const verdicts = [...perBlockResults.values()];
    const safetyDone = verdicts.length > 0 && verdicts.every((r) => r.ok);
    return [
      { label: tr('sprayui.step.blockCrop'), state: hasBlocks ? 'done' : 'active' },
      {
        label: tr('sprayui.step.sprayerTank'),
        state: !hasSprayer ? (hasBlocks ? 'active' : 'pending') : 'done'
      },
      {
        label: tr('sprayui.step.mix'),
        state: !hasMix ? (hasBlocks && hasSprayer ? 'active' : 'pending') : 'done'
      },
      {
        label: tr('sprayui.step.safety'),
        state:
          verdicts.length === 0
            ? hasMix && hasBlocks && hasSprayer
              ? 'active'
              : 'pending'
            : safetyDone
              ? 'done'
              : 'active'
      },
      {
        label: tr('sprayui.step.confirm'),
        state: safetyDone ? 'active' : 'pending'
      }
    ];
  }
  import {
    buildLastTankFills,
    fmtAmount as fmtUnitAmount,
    secondaryUnits,
    type DilutionUnit
  } from '$lib/dilution/unitConvert';

  let { data } = $props();
  const tr = $derived(createT(data.locale));

  // Preselect from query params so deep-links from /today and /scout land on
  // a partially-filled form instead of a blank one.
  // Phase 21b follow-up — multi-block selection. The Set is the source
  // of truth for "which blocks are part of this spray pass". A
  // deep-link (e.g. from a pip popover) preselects exactly one block;
  // the operator can add more before recording.
  let selectedBlockIds = $state<Set<string>>(
    untrack(() => {
      const initial =
        data.preselect.blockId && data.blocks.find((b) => b.id === data.preselect.blockId)
          ? data.preselect.blockId
          : '';
      return new Set(initial ? [initial] : []);
    })
  );
  let selectedHerbicideIds = $state<string[]>(
    untrack(() =>
      data.preselect.productPluginIds.filter((id) =>
        data.allHerbicides.some((h) => h.pluginId === id)
      )
    )
  );
  let selectedSprayerId = $state(untrack(() => data.sprayers[0]?.id ?? ''));
  // #320 / CT-S5-003 — conservative synthetic defaults. These still feed
  // the environmental kernel gate, but they are NOT presented as measured
  // readings: the record carries `conditionsProvenance` so a persisted 5
  // mph is attributable to "operator left conditions untouched" rather
  // than "measured 5 mph". `conditionsMeasured` flips true the moment the
  // operator edits any conditions input (or hydrates measured prefs).
  const DEFAULT_WIND_MPH = 5;
  const DEFAULT_TEMP_F = 70;
  const DEFAULT_RAIN_MM = 0;
  let windMph = $state(DEFAULT_WIND_MPH);
  let tempF = $state(DEFAULT_TEMP_F);
  let rainMm = $state(DEFAULT_RAIN_MM);
  let conditionsMeasured = $state(false);
  function markConditionsMeasured() {
    conditionsMeasured = true;
  }
  let cornHeightIn = $state<number | undefined>(6);
  let tankSizeGallons = $state(50);
  let customTankOpen = $state(false);
  let showAllHerbicides = $state(untrack(() => data.preselect.windowStage === null));
  let herbicideQuery = $state('');

  type SprayerPrefs = {
    tankSizeGallons: number;
    windMph: number;
    tempF: number;
    rainMm: number;
    cornHeightIn?: number;
    /** #320 — remember whether the last saved conditions were measured
     *  so re-selecting a sprayer restores the honest provenance too. */
    conditionsMeasured?: boolean;
  };

  function prefsKey(sprayerId: string) {
    return `cropcard:spray-prefs:${sprayerId}`;
  }

  function loadSprayerPrefs(sprayerId: string): SprayerPrefs | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(prefsKey(sprayerId));
      if (!raw) return null;
      return JSON.parse(raw) as SprayerPrefs;
    } catch {
      return null;
    }
  }

  function saveSprayerPrefs(sprayerId: string, prefs: SprayerPrefs) {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(prefsKey(sprayerId), JSON.stringify(prefs));
    } catch {
      // Quota exceeded or storage disabled — silent best-effort.
    }
  }

  // F-R: when the user picks a sprayer, hydrate tank size + last-used
  // conditions from the previous spray on this sprayer so Marco isn't
  // re-tapping the same numbers each time.
  let prefsLastApplied = $state<string | null>(null);
  $effect(() => {
    if (!selectedSprayerId || prefsLastApplied === selectedSprayerId) return;
    const prefs = loadSprayerPrefs(selectedSprayerId);
    prefsLastApplied = selectedSprayerId;
    if (!prefs) {
      const tank = data.sprayers.find((x) => x.id === selectedSprayerId)?.tankGal;
      if (tank) tankSizeGallons = tank;
      return;
    }
    tankSizeGallons = prefs.tankSizeGallons;
    windMph = prefs.windMph;
    tempF = prefs.tempF;
    rainMm = prefs.rainMm;
    // #320 — a hydrated pref that the operator once measured stays
    // measured; otherwise the restored numbers remain synthetic defaults.
    conditionsMeasured = prefs.conditionsMeasured ?? false;
    if (prefs.cornHeightIn !== undefined) cornHeightIn = prefs.cornHeightIn;
  });

  let evaluating = $state(false);
  /** Phase 21b follow-up — kept as the "consolidated" result for the
   *  audit/dilution/tank-mix display (which is shared across blocks
   *  since products + tank size are the same for the whole pass).
   *  `perBlockResults` carries the per-block kernel verdict. */
  let result = $state<EvaluateResult | null>(null);
  let perBlockResults = $state<Map<string, EvaluateResult>>(new Map());
  let lastError = $state<string | null>(null);

  let recording = $state(false);
  let recordedId = $state<string | null>(null);
  let queuedOffline = $state(false);
  /** Phase 21b follow-up — per-block record outcome. Populated by
   *  recordSpray when the operator commits a multi-block pass. */
  type RecordOutcome =
    | { kind: 'created'; eventId: string }
    | { kind: 'skipped-stop' }
    | { kind: 'failed'; error: string };
  let recordOutcomes = $state<Map<string, RecordOutcome>>(new Map());

  type Violation = { code: string; message: string; detail?: Record<string, unknown> };
  type Dilution = {
    pluginId: string;
    displayName: string;
    productAmount: number;
    unit: string;
    display: string;
    acresCovered: number;
    gpaUsed: number;
    customRateApplied: boolean;
    rateProvenance?: 'plugin' | 'fallback' | 'manual' | null;
  };
  type TankMixStep = { order: number; instruction: string; productPluginId?: string };
  type EvaluateResult = {
    ok: boolean;
    violations: Violation[];
    requiresDecon: boolean;
    dilutions?: Dilution[];
    noLabelRate?: string[];
    tankMixOrder?: TankMixStep[];
    ruleVersion: string;
    pluginHashes: Record<string, string>;
    sprayerState?: { id: string; lastChemistryClass?: string };
  };

  /** Phase 21b follow-up — array of currently-selected blocks. Driven
   *  by the `selectedBlockIds` Set so toggling is O(1) on the cards. */
  const selectedBlocks = $derived(data.blocks.filter((b) => selectedBlockIds.has(b.id)));
  /** The one block of this pass that carries the task id (TC-04): the task's
   *  block when it is selected, else the first selected block. */
  const taskBlockId = $derived(
    data.preselect.blockId && selectedBlockIds.has(data.preselect.blockId)
      ? data.preselect.blockId
      : (selectedBlocks[0]?.id ?? null)
  );
  let taskOutcome = $state<RecordTaskClose | null>(null);
  let taskQueued = $state(false);
  const pickedFamilies = $derived([
    ...new Set(
      selectedBlocks.flatMap((b) =>
        b.crops.flatMap((c) => (typeof c.cropFamily === 'string' ? [String(c.cropFamily)] : []))
      )
    )
  ]);
  type HerbicideRow = (typeof data.allHerbicides)[number];
  function harmedFamilies(h: HerbicideRow): string[] {
    const out = new Set<string>();
    for (const cls of h.chemistryClasses) {
      if (!cls || !(CHEMISTRY_CLASSES as readonly string[]).includes(cls)) continue;
      for (const f of pickedFamilies) {
        if (killsFamily(cls as ChemistryClass, f as CropFamily)) out.add(f);
      }
    }
    for (const name of h.activeNames) {
      for (const f of pickedFamilies) {
        if (ingredientKillsFamily(name, f as CropFamily)) out.add(f);
      }
    }
    return [...out].sort();
  }
  const herbicideList = $derived.by(() => {
    const base = showAllHerbicides ? data.allHerbicides : data.herbicides;
    const q = herbicideQuery.trim().toLowerCase();
    const matched = q
      ? base.filter(
          (h) =>
            h.displayName.toLowerCase().includes(q) ||
            h.pluginId.includes(q) ||
            h.activeNames.some((n) => n.toLowerCase().includes(q))
        )
      : base;
    return [...matched].sort(
      (a, b) =>
        Number(harmedFamilies(a).length > 0) - Number(harmedFamilies(b).length > 0) ||
        a.displayName.localeCompare(b.displayName)
    );
  });
  const sprayer = $derived(data.sprayers.find((s) => s.id === selectedSprayerId));
  const selectedSprayer = $derived(sprayer);
  const selectedSprayerTank = $derived(sprayer?.tankGal ?? null);
  const tankHint = $derived(
    joinSentences(
      tr('sprayui.tank.question'),
      selectedSprayerTank
        ? tr('sprayui.tank.holds', { name: selectedSprayer?.label ?? '', gal: selectedSprayerTank })
        : null
    )
  );
  const tankChoices = $derived(
    [...new Set([...(selectedSprayerTank ? [selectedSprayerTank] : []), 10, 25, 50, 75, 100])].sort(
      (a, b) => a - b
    )
  );
  /** Corn-height input fires when ANY selected block has corn in the
   *  ground. The same height applies to all corn blocks in the pass —
   *  a reasonable simplification since operators walk the field once. */
  const isCornBlock = $derived(
    selectedBlocks.some((b) => b.crops.some((c) => c.cropFamily === 'corn'))
  );

  /**
   * Phase 21b follow-up — total acres across the selected blocks the
   * kernel passed (#735: a stopped block is not sprayed or recorded). Used
   * to scale the dilution display from "per tank" to "total spray
   * pass" so the operator sees the actual product needed and the
   * tank count required to cover everything.
   *
   * `acres === null` on a block means the operator didn't enter acres
   * AND no geometry exists to derive them. We surface a warning when
   * any selected block is missing acres so the dilution math is
   * understood to be a lower bound.
   */
  const sprayPass = $derived(splitSprayable(selectedBlocks, perBlockResults));
  const totalAcres = $derived(sprayableAcres(sprayPass.sprayable));
  const blocksMissingAcres = $derived(
    selectedBlocks.filter((b) => b.acres == null || b.acres <= 0).map((b) => b.label)
  );
  const unsizedBlocks = $derived(selectedBlocks.filter((b) => b.acres == null || b.acres <= 0));
  let sizeDrafts = $state<Record<string, string>>({});
  let sizeSaving = $state<string | null>(null);
  let sizeError = $state<string | null>(null);
  async function saveBlockAcres(blockId: string) {
    const acres = Number(sizeDrafts[blockId]);
    if (!Number.isFinite(acres) || acres <= 0) {
      sizeError = tr('sprayui.size.invalid');
      return;
    }
    sizeSaving = blockId;
    sizeError = null;
    try {
      const res = await fetch(`/api/blocks/${encodeURIComponent(blockId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ acres })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        sizeError = body.error ?? tr('sprayui.size.saveFailed', { status: res.status });
        return;
      }
      await invalidateAll();
    } catch {
      sizeError = tr('sprayui.offlineError');
    } finally {
      sizeSaving = null;
    }
  }

  /** acresCovered for ONE tank = tankSizeGallons / gpaUsed. We pull
   *  gpaUsed from the first dilution row when available, otherwise
   *  default to 15 GPA (the calculator's fallback). */
  const tankAcresCapacity = $derived.by(() => {
    const gpa = result?.dilutions?.[0]?.gpaUsed ?? 15;
    return tankSizeGallons / gpa;
  });
  const metric = $derived(currentPrefs().units === 'metric');
  const tanksNeeded = $derived(
    tankAcresCapacity > 0 ? Math.max(1, Math.ceil(totalAcres / tankAcresCapacity)) : 1
  );

  /**
   * Scale a single per-tank dilution row to the FULL pass total. The
   * calculator already exposes `ratePerAcre`, so total amount =
   * rate × totalAcres; per-tank stays the calculator's per-tank value.
   */
  type ScaledDilution = {
    pluginId: string;
    displayName: string;
    unit: string;
    perTankAmount: number;
    perTankDisplay: string;
    totalAmount: number;
    totalDisplay: string;
    exceedsOneTank: boolean;
  };
  function fmtAmount(n: number, unit: string): string {
    const rounded = Math.round(n * 100) / 100;
    return `${rounded} ${unit}`;
  }
  const scaledDilutions = $derived.by<ScaledDilution[]>(() => {
    if (!result?.dilutions || totalAcres <= 0) return [];
    return result.dilutions.map((d) => {
      // The calculator's per-tank amount is `ratePerAcre × acresCovered`,
      // so `productAmount / acresCovered` recovers the rate. Multiplying
      // by totalAcres gives the full-pass amount. `Math.max` guards a
      // divide-by-zero in pathological cases.
      const rate = d.productAmount / Math.max(0.0001, d.acresCovered);
      const total = rate * totalAcres;
      return {
        pluginId: d.pluginId,
        displayName: d.displayName,
        unit: d.unit,
        perTankAmount: d.productAmount,
        perTankDisplay: d.display,
        totalAmount: total,
        totalDisplay: fmtAmount(total, d.unit),
        exceedsOneTank: totalAcres > tankAcresCapacity
      };
    });
  });

  function toggleBlock(id: string) {
    const next = new Set(selectedBlockIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedBlockIds = next;
    // Any selection change invalidates the prior kernel verdict.
    result = null;
    perBlockResults = new Map();
    recordOutcomes = new Map();
    recordedId = null;
  }

  function herbicideName(id: string): string {
    return data.allHerbicides.find((h) => h.pluginId === id)?.displayName ?? id;
  }

  function toggleHerbicide(id: string) {
    if (selectedHerbicideIds.includes(id)) {
      selectedHerbicideIds = selectedHerbicideIds.filter((x) => x !== id);
    } else {
      selectedHerbicideIds = [...selectedHerbicideIds, id];
    }
  }

  /**
   * Phase 21b follow-up — dynamic safety + dilution re-evaluation.
   * Replaces the "Check safety" button: any change to the inputs that
   * affect the kernel verdict (blocks, herbicides, sprayer, tank
   * size, corn height, conditions) re-fires evaluate() after a short debounce.
   * Recording stays an explicit click — the operator confirms the
   * Spray Card before persisting.
   *
   * Debounce window is small (250ms) — the kernel is cheap, and the
   * operator sees the verdict almost instantly when they tap a block
   * or herbicide. Pre-evaluation, the result panel renders an
   * "incomplete" placeholder so the page never shows stale output.
   */
  // INTENTIONAL plain `let` — NOT `$state`. Reading + writing the
  // handle inside the effect must NOT re-trigger the effect (that
  // would create an infinite reschedule loop on every herbicide /
  // block click).
  let evalDebounceHandle: ReturnType<typeof setTimeout> | null = null;
  // Plain counter: only the newest evaluate() may write its verdict, so a
  // slow response for an older selection never replaces a newer one.
  let evalSeq = 0;
  $effect(() => {
    // Read every input the kernel cares about so Svelte's reactivity
    // wires this effect to all of them. Order matters: declare in
    // dependency order so dead-code elimination can't drop them.
    const inputsReady = selectedBlocks.length > 0 && selectedHerbicideIds.length > 0 && !!sprayer;
    // touch shared form fields
    void tankSizeGallons;
    void cornHeightIn;
    void windMph;
    void tempF;
    void rainMm;
    void selectedHerbicideIds.join(',');
    if (!inputsReady) {
      evalSeq++;
      if (evalDebounceHandle) clearTimeout(evalDebounceHandle);
      evalDebounceHandle = null;
      evaluating = false;
      result = null;
      perBlockResults = new Map();
      return;
    }
    evalSeq++;
    if (evalDebounceHandle) clearTimeout(evalDebounceHandle);
    evalDebounceHandle = setTimeout(() => {
      evalDebounceHandle = null;
      void evaluate();
    }, 250);
  });

  /**
   * Phase 21b follow-up — kernel body builder, scoped to a single
   * block. Pre-plant blocks (no crop in the ground yet) send a
   * sentinel `primary` with no cropFamily so the kill-matrix check
   * skips while environmental gates still run. See
   * cropCompatibility.ts:40 — kernel skips on missing cropFamily.
   */
  type BlockLite = (typeof data.blocks)[number];
  function buildKernelCropsFor(b: BlockLite) {
    if (b.preplant) {
      return {
        primary: { cropPluginId: '__pre-plant__', cropFamily: undefined, heightInches: undefined },
        coPlanted: [] as Array<{ cropPluginId: string; cropFamily?: string }>
      };
    }
    const [primary, ...coPlanted] = b.crops;
    const blockHasCorn = b.crops.some((c) => c.cropFamily === 'corn');
    return {
      primary: {
        cropPluginId: primary.pluginId,
        cropFamily: primary.cropFamily,
        heightInches: blockHasCorn ? cornHeightIn : undefined
      },
      coPlanted: coPlanted.map((c) => ({
        cropPluginId: c.pluginId,
        cropFamily: c.cropFamily
      }))
    };
  }

  async function evaluate() {
    if (selectedBlocks.length === 0 || selectedHerbicideIds.length === 0 || !sprayer) return;
    const seq = ++evalSeq;
    evaluating = true;
    lastError = null;
    result = null;
    perBlockResults = new Map();
    recordOutcomes = new Map();
    try {
      // Phase 21b follow-up — kernel evaluates per block since each
      // block's crop set is independent (different families, planted
      // vs pre-plant). Products + conditions + sprayer are shared.
      const calls = selectedBlocks.map(async (b) => {
        const blockCrops = buildKernelCropsFor(b);
        const body = {
          blockId: b.id,
          blockCrops,
          productPluginIds: selectedHerbicideIds,
          sprayer: { id: sprayer.id },
          tankSizeGallons,
          conditions: { windMph, tempF, rainForecastMmNext24h: rainMm }
        };
        const res = await fetch('/api/spray/evaluate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (!res.ok && res.status !== 200) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        return { blockId: b.id, evalResult: (await res.json()) as EvaluateResult };
      });
      const outcomes = await Promise.allSettled(calls);
      if (seq !== evalSeq) return;
      const map = new Map<string, EvaluateResult>();
      const failures: string[] = [];
      for (const o of outcomes) {
        if (o.status === 'fulfilled') {
          map.set(o.value.blockId, o.value.evalResult);
        } else {
          failures.push(o.reason instanceof Error ? o.reason.message : String(o.reason));
        }
      }
      perBlockResults = map;
      // The consolidated `result` drives the tank-mix + dilution +
      // audit display (shared across blocks). Pick the first OK
      // result so the operator sees the actual dilution math even if
      // some blocks STOPped. If every block STOPped, just show the
      // first STOP so the violation list is visible.
      const firstOk = [...map.values()].find((r) => r.ok);
      result = firstOk ?? map.values().next().value ?? null;
      if (failures.length > 0 && map.size === 0) {
        lastError = failures.join(' • ');
      }
    } catch (e) {
      if (seq === evalSeq) lastError = e instanceof Error ? e.message : String(e);
    } finally {
      if (seq === evalSeq) evaluating = false;
    }
  }

  function goToDecon() {
    if (sprayer) goto(`/spray/decon?sprayer=${encodeURIComponent(sprayer.id)}`);
  }

  function buildRecordBodyFor(b: BlockLite) {
    if (!sprayer) return null;
    const blockCrops = buildKernelCropsFor(b);
    return {
      blockId: b.id,
      blockCrops,
      productPluginIds: selectedHerbicideIds,
      sprayer: { id: sprayer.id },
      tankSizeGallons,
      // #320 — tag conditions with their provenance so the persisted
      // record never claims synthetic defaults are measured readings.
      conditions: {
        windMph,
        tempF,
        rainForecastMmNext24h: rainMm,
        conditionsProvenance: conditionsMeasured ? 'measured' : 'default'
      },
      // Phase 21b follow-up — when deep-linked from a pip popover the
      // server closes the originating task on a successful record.
      // Only attach cropId/taskId on the block the popover came from,
      // and only when that block actually has a crop in the ground.
      ...(data.preselect?.cropId && b.id === data.preselect.blockId && !b.preplant
        ? { cropId: data.preselect.cropId }
        : {}),
      ...(data.preselect?.taskId && b.id === taskBlockId ? { taskId: data.preselect.taskId } : {})
    };
  }

  /**
   * Phase 21b follow-up — multi-block record dispatcher. For each
   * selected block:
   *   • Skip if kernel said STOP (partial-OK policy).
   *   • Else POST a new spray_event (a second pass is its own record).
   * Fires all in parallel; aggregates per-block outcomes into
   * `recordOutcomes` for the summary display.
   *
   * The offline-queue path is single-block today; when offline AND
   * the pass spans multiple blocks, queue each one individually with
   * the same shared body shape (the queue replays POSTs).
   */
  async function recordSpray() {
    if (selectedBlocks.length === 0 || !sprayer) return;
    recording = true;
    lastError = null;
    queuedOffline = false;
    recordedId = null;
    taskOutcome = null;
    taskQueued = false;

    saveSprayerPrefs(sprayer.id, {
      tankSizeGallons,
      windMph,
      tempF,
      rainMm,
      conditionsMeasured,
      cornHeightIn: isCornBlock ? cornHeightIn : undefined
    });

    const outcomes = new Map<string, RecordOutcome>();

    for (const b of selectedBlocks) {
      const perBlockEval = perBlockResults.get(b.id);
      if (!perBlockEval || !perBlockEval.ok) {
        outcomes.set(b.id, { kind: 'skipped-stop' });
        continue;
      }
      const body = buildRecordBodyFor(b);
      if (!body) continue;
      // Offline queue is single-shot per body — same as before, just
      // run per block.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        try {
          const { enqueueSprayRecord } = await import('$lib/client/syncQueue');
          const queueId = await enqueueSprayRecord(body);
          outcomes.set(b.id, { kind: 'created', eventId: queueId });
          queuedOffline = true;
          if ('taskId' in body) taskQueued = true;
        } catch (e) {
          outcomes.set(b.id, {
            kind: 'failed',
            error: e instanceof Error ? e.message : String(e)
          });
        }
        continue;
      }
      try {
        const res = await fetch('/api/spray/record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (isUpdatingResponse(res)) {
          const { enqueueSprayRecord, scheduleDrain } = await import('$lib/client/syncQueue');
          const queueId = await enqueueSprayRecord(body);
          scheduleDrain((retryAfterSeconds(res) + 2) * 1000);
          outcomes.set(b.id, { kind: 'created', eventId: queueId });
          queuedOffline = true;
          if ('taskId' in body) taskQueued = true;
          continue;
        }
        const respData = await res.json().catch(() => ({}));
        if (!res.ok) {
          outcomes.set(b.id, {
            kind: 'failed',
            error: respData.error ?? `HTTP ${res.status}`
          });
          continue;
        }
        outcomes.set(b.id, { kind: 'created', eventId: respData.event.id });
        await noteHoldWrite('herbicide', { blockId: b.id });
        if (respData.taskClose) taskOutcome = respData.taskClose;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const isNetworkErr = e instanceof TypeError && /(fetch|network|failed)/i.test(msg);
        if (isNetworkErr) {
          try {
            const { enqueueSprayRecord } = await import('$lib/client/syncQueue');
            const queueId = await enqueueSprayRecord(body);
            outcomes.set(b.id, { kind: 'created', eventId: queueId });
            queuedOffline = true;
            if ('taskId' in body) taskQueued = true;
          } catch (queueErr) {
            outcomes.set(b.id, {
              kind: 'failed',
              error: `offline queue failed: ${
                queueErr instanceof Error ? queueErr.message : queueErr
              }`
            });
          }
        } else {
          outcomes.set(b.id, { kind: 'failed', error: msg });
        }
      }
    }

    recordOutcomes = outcomes;
    // Surface a top-level "recordedId" when there's exactly one
    // successful outcome — preserves the legacy single-block confirm
    // panel for deep-link / single-select flows.
    const successes = [...outcomes.values()].filter(
      (o): o is RecordOutcome & { kind: 'created'; eventId: string } => o.kind === 'created'
    );
    if (successes.length === 1) {
      recordedId = successes[0].eventId;
    } else if (successes.length > 1) {
      recordedId = `multi:${successes.length}`;
    }

    // If every attempt failed, surface the failure messages at the top-level
    // error banner. Without this the single-block UI shows nothing on
    // server 5xx — the operator clicks "Confirm", sees no state change,
    // and walks away believing the spray was recorded.
    if (successes.length === 0) {
      const failures = [...outcomes.values()]
        .filter((o): o is RecordOutcome & { kind: 'failed'; error: string } => o.kind === 'failed')
        .map((o) => o.error);
      if (failures.length > 0) {
        lastError = failures.join(' • ');
      }
    }
    recording = false;
  }

  // Phase 25b (#85) — Almanac chrome derived state.
  const sprayStepperData = $derived(deriveStepperData());
  const ctxPasture = $derived(
    pastureNotice({
      blockIds: selectedBlocks.map((b) => b.id),
      products: data.allHerbicides
        .filter((h) => selectedHerbicideIds.includes(h.pluginId))
        .map((h) => ({ pluginId: h.pluginId, name: h.displayName })),
      context: data.pasture
    })
  );
  const organicProducts = $derived(
    data.allHerbicides
      .filter((h) => selectedHerbicideIds.includes(h.pluginId))
      .map((h) => ({
        name: h.displayName,
        inputClass: organicInputClass({ type: 'herbicide', complianceFlags: h.complianceFlags })
      }))
  );
  const blockNames = $derived(Object.fromEntries(data.blocks.map((b) => [b.id, b.label])));
  const ctxBlocks = $derived<SprayContextBlock[]>(
    selectedBlocks.map((b) => ({ id: b.id, label: b.label, acres: b.acres ?? 0 }))
  );
  const cropFamilies = $derived(
    Array.from(
      new Set(
        selectedBlocks
          .flatMap((b) => b.crops.map((c) => c.cropFamily))
          .filter((f): f is NonNullable<typeof f> => f !== undefined)
      )
    )
  );
  const ctxCropLabel = $derived(
    cropFamilies.length === 0
      ? '—'
      : cropFamilies.length === 1
        ? cropFamilies[0]
        : tr('sprayui.ctx.cropFamilies', { count: cropFamilies.length })
  );
  const ctxCropSubtitle = $derived(
    selectedBlocks.length === 0
      ? undefined
      : selectedBlocks
          .flatMap((b) => b.crops)
          .slice(0, 3)
          .map((c) => cropDisplayNameByEnglish(c.displayName, data.locale))
          .join(' · ')
  );
  const ctxCompatibility = $derived<CompatibilityState | undefined>(
    perBlockResults.size === 0
      ? undefined
      : [...perBlockResults.values()].every((r) => r.ok)
        ? {
            label:
              cropFamilies.length === 1
                ? `${cropFamilies[0]} blocks compatible`
                : `${selectedBlocks.length} block${selectedBlocks.length === 1 ? '' : 's'} compatible`,
            reason: 'Kernel verified each selected block against the chosen products.',
            tone: 'forest'
          }
        : {
            label: 'Block / product combination flagged',
            reason: 'One or more blocks failed the kernel check. Review below.',
            tone: 'rust'
          }
  );

  let setupSheet = $state<null | 'planting' | 'sprayer' | 'calibration'>(null);
  let sprayerSheetTitle = $state<string | null>(null);

  async function onPlantingAdded(r: SetupPlantingResult) {
    setupSheet = null;
    await invalidateAll();
    selectedBlockIds = new Set([r.blockId]);
    await focusAfterSetup(`[data-block-id="${CSS.escape(r.blockId)}"]`);
  }

  async function onSprayerAdded(r: SetupSprayerResult) {
    setupSheet = null;
    sprayerSheetTitle = null;
    await invalidateAll();
    selectedSprayerId = r.sprayerId;
    await focusAfterSetup(`[data-sprayer-id="${CSS.escape(r.sprayerId)}"]`);
  }

  async function onCalibrated() {
    setupSheet = null;
    await invalidateAll();
    if (selectedSprayerId) {
      await focusAfterSetup(`[data-sprayer-id="${CSS.escape(selectedSprayerId)}"]`);
    }
  }
</script>

<SprayPageHeader chemistry="herbicide" activeREI={data.activeREI} blockNames={data.reiBlockNames} />

<!-- Phase 25b (#85) — Almanac stepper + context strip. 1:1 with the
     header in ASprayScreen at docs/design/almanac/direction-almanac-rest.jsx
     (lines 236–342). Derives step + compatibility state from the
     existing flow's selections; the rich legacy form continues below. -->
<div class="spray-almanac-chrome">
  <SprayStepper steps={sprayStepperData} />
  <SprayContextStrip
    blocks={ctxBlocks}
    cropLabel={ctxCropLabel}
    cropSubtitle={ctxCropSubtitle}
    compatibility={ctxCompatibility}
    pastureNotice={ctxPasture}
  />
  <OrganicInputNotice
    organicBlocks={data.organicBlocks}
    selectedBlockIds={selectedBlocks.map((b) => b.id)}
    products={organicProducts}
    {blockNames}
  />
</div>

{#if data.preselect.fromScout || data.preselect.blockId}
  <Banner tone="forest">
    {#if data.preselect.fromScout}
      {tr('sprayui.pre.fromScout')}
    {:else}
      {tr('sprayui.pre.fromToday')} <a href="/today">{tr('sprayui.pre.todayLink')}</a>.
    {/if}
  </Banner>
{/if}

{#if data.blocks.length === 0}
  <SetupCallout
    kicker={tr('sprayui.where.kicker')}
    title={tr('sprayui.where.title')}
    canEdit={data.setup.canEdit}
    askOwner={tr('sprayui.where.askOwner')}
    testId="spray-where"
  >
    <p>
      {tr('sprayui.where.body')}
    </p>
    {#snippet actions()}
      <button type="button" class="primary" onclick={() => (setupSheet = 'planting')}>
        {tr('sprayui.where.add')}
      </button>
      <a href="/plan">{tr('sprayui.where.plan')}</a>
    {/snippet}
  </SetupCallout>
{:else}
  <section class="step">
    <h2>{tr('sprayui.h.block')}</h2>
    <div class="cards">
      {#each data.blocks as b (b.id)}
        {@const isSelected = selectedBlockIds.has(b.id)}
        <button
          type="button"
          class="card"
          class:selected={isSelected}
          class:preplant={b.preplant}
          aria-pressed={isSelected}
          data-block-id={b.id}
          onclick={() => toggleBlock(b.id)}
        >
          <span class="card-head">
            <span class="card-check" aria-hidden="true">{isSelected ? '☑' : '☐'}</span>
            <strong>{b.label}</strong>
          </span>
          <small>{b.acres ? fmt.labelArea(b.acres) : ''}</small>
          {#if b.preplant}
            <!-- Phase 21b follow-up — block has nothing in the ground;
                 spray is a pre-plant burndown. Crop-tox check skipped. -->
            <p class="preplant-tag">{tr('sprayui.block.preplant')}</p>
            {#if b.plannedCropNames.length > 0}
              <small class="planned">
                {tr('sprayui.block.planned', { crops: b.plannedCropNames.join(', ') })}
              </small>
            {/if}
          {:else}
            <ul>
              {#each b.crops as c, idx (idx)}
                <li>
                  {cropDisplayNameByEnglish(c.displayName, data.locale)}
                  <em>({c.cropFamily ? cropFamilyLabel(c.cropFamily, data.locale) : ''})</em>
                </li>
              {/each}
            </ul>
          {/if}
          {#if b.recentEvent}
            <p class="existing-event-tag">
              {tr('sprayui.block.sprayedRecently')}
              {fmt.instant(b.recentEvent.occurredAt, 'datetime')}
            </p>
          {/if}
        </button>
      {/each}
    </div>
  </section>

  <section class="step">
    <h2>{tr('sprayui.h.herbicides')}</h2>
    {#if data.preselect.windowStage && !showAllHerbicides}
      <p class="filter-hint">
        {tr('sprayui.herb.filteredTo')} <strong>{data.preselect.windowStage}</strong>
        {tr('sprayui.herb.filteredWindow')}
        <button class="link-button" onclick={() => (showAllHerbicides = true)}>
          {tr('sprayui.herb.showAll')}
        </button>
      </p>
    {/if}
    {#if sprayer && sprayer.calibratedGpa == null}
      <p class="filter-hint" data-testid="uncalibrated-hint">
        <strong>{sprayer.label}</strong>
        {tr('sprayui.herb.uncalibrated')}
        <button type="button" class="link-button" onclick={() => (setupSheet = 'calibration')}>
          {tr('sprayui.sheet.calibrate', { name: sprayer.label })}
        </button>
      </p>
    {/if}
    <label class="herbicide-search">
      <span>{tr('sprayui.herb.find')}</span>
      <input
        type="search"
        placeholder={tr('sprayui.herb.findPlaceholder')}
        autocomplete="off"
        bind:value={herbicideQuery}
      />
    </label>
    {#if herbicideList.length === 0}
      <p class="filter-hint">{tr('sprayui.herb.noMatch', { query: herbicideQuery })}</p>
    {/if}
    <div class="cards">
      {#each herbicideList as h (h.pluginId)}
        {@const harmed = harmedFamilies(h)}
        <button
          type="button"
          class="card"
          class:selected={selectedHerbicideIds.includes(h.pluginId)}
          class:incompatible={harmed.length > 0}
          data-herbicide-id={h.pluginId}
          onclick={() => toggleHerbicide(h.pluginId)}
        >
          <strong>{h.displayName}</strong>
          {#if harmed.length > 0}
            <small class="harm" data-testid="herbicide-harm" lang="en" data-english-only="safety">
              Harms {harmed.join(', ')} crops on the picked blocks
            </small>
          {/if}
          {#if h.hracGroups && h.hracGroups.length > 0}
            <div class="badges">
              {#each h.hracGroups as g, idx (idx)}
                <GroupCodeBadge kind="HRAC" group={g} />
              {/each}
            </div>
          {/if}
          <small
            >{h.applicationTiming ?? tr('sprayui.herb.unspecifiedTiming')} • {h.contactOrganic
              ? tr('sprayui.herb.contact')
              : h.chemistryClasses
                  .map((c) => tr(`sprayui.chemclass.${c}` as MessageKey))
                  .join(', ')}</small
          >
          <small data-testid="herbicide-rate-preview" lang="en" data-english-only="safety">
            {h.ratePerAcre
              ? herbicideRatePreview(h.ratePerAcre, sprayer, currentPrefs()).label
              : 'No label rate on file. Check the label.'}
            {#if h.requiresAMS}• AMS{/if}
            {#if h.deconRequired}• decon{/if}
          </small>
          {#if h.rateProvenance === 'fallback'}<FallbackRateLine />{/if}
        </button>
      {/each}
    </div>
  </section>

  <section class="step">
    <h2>{tr('sprayui.h.sprayer')}</h2>
    {#if data.sprayers.length === 0}
      <div class="sprayer-empty" data-testid="sprayer-empty">
        <p>
          <strong>{tr('sprayui.sprayer.emptyLead')}</strong>
          {tr('sprayui.sprayer.emptyBody')}
        </p>
        {#if data.setup.canEdit}
          <div class="sprayer-empty-cta">
            <button type="button" class="primary" onclick={() => (setupSheet = 'sprayer')}>
              {tr('sprayui.sprayer.add')}
            </button>
          </div>
        {:else}
          <p class="ask-owner" role="note">
            {tr('sprayui.sprayer.askOwner')}
          </p>
        {/if}
      </div>
    {:else}
      <div class="cards">
        {#each data.sprayers as s (s.id)}
          <button
            type="button"
            class="card"
            class:selected={selectedSprayerId === s.id}
            data-sprayer-id={s.id}
            onclick={() => (selectedSprayerId = s.id)}
          >
            <strong>{s.label}</strong>
            <small
              >{s.tankGal ? tr('sprayui.sprayer.tank', { gal: s.tankGal }) : ''}{s.calibratedGpa !=
              null
                ? fmt.label(s.calibratedGpa, 'volumePerArea')
                : tr('sprayui.sprayer.uncalibrated')}</small
            >
            {#if s.lastChemistryClass}
              <small class="warn"
                >{tr('sprayui.sprayer.lastLoad', {
                  class: chemistryClassLabel(s.lastChemistryClass, data.locale)
                })}</small
              >
            {:else}
              <small class="ok">{tr('sprayui.sprayer.clean')}</small>
            {/if}
            {#if s.lastDeconAt}
              <small>{tr('sprayui.sprayer.lastDecon', { date: fmt.instant(s.lastDeconAt) })}</small>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </section>

  <section class="step">
    <h2>{tr('sprayui.h.tank')}</h2>
    <p class="hint">
      {tankHint}
    </p>
    <div class="quick-picks" role="radiogroup" aria-label={tr('sprayui.tank.aria')}>
      {#each tankChoices as size (size)}
        <button
          type="button"
          role="radio"
          aria-checked={tankSizeGallons === size && !customTankOpen}
          class="pick"
          class:selected={tankSizeGallons === size && !customTankOpen}
          onclick={() => {
            tankSizeGallons = size;
            customTankOpen = false;
          }}
        >
          {size} <span>gal</span>
          {#if metric}<span class="pick-alt">{fmt.qty(size, 'volume', { digits: 0 })}</span>{/if}
        </button>
      {/each}
      <button
        type="button"
        role="radio"
        aria-checked={customTankOpen}
        class="pick"
        class:selected={customTankOpen}
        onclick={() => (customTankOpen = true)}
      >
        {tr('sprayui.tank.other')}
      </button>
    </div>
    {#if customTankOpen}
      <label class="custom-tank">
        {tr('sprayui.tank.custom')}
        <input
          type="number"
          min="0.5"
          max="2000"
          step="0.5"
          value={tankSizeGallons}
          oninput={(e) => {
            const v = Number(e.currentTarget.value);
            if (Number.isFinite(v) && v > 0) tankSizeGallons = v;
          }}
        />
      </label>
    {/if}
  </section>

  <!-- #320 / CT-S5-003 — explicit conditions inputs restored so the
       operator records REAL wind / temp / rain. Until touched, the
       conservative defaults (5 mph / 70 °F / 0 mm) drive the kernel gate
       but the record is tagged `conditionsProvenance: 'default'` — a real
       20 mph day is no longer silently persisted as 5. Editing any field
       flips the record to `'measured'`. The kernel still re-runs via the
       debounced `$effect` on any change. -->
  <section class="step">
    <h2>{tr('sprayui.h.conditions')}</h2>
    <p class="hint">
      {#if conditionsMeasured}
        {tr('sprayui.cond.recordedAs')} <strong>{tr('sprayui.cond.measured')}</strong>
        {tr('sprayui.cond.measuredTail')}
      {:else}
        {tr('sprayui.cond.defaults')}
      {/if}
    </p>
    <div class="conditions conditions-grid">
      <div class="stepper">
        <span class="stepper-label">{tr('sprayui.cond.wind')}</span>
        <button
          type="button"
          aria-label={tr('sprayui.cond.windDown')}
          onclick={() => {
            windMph = Math.max(0, windMph - 1);
            markConditionsMeasured();
          }}>−</button
        >
        <output
          >{windMph}<small> mph</small>{#if metric}<small class="alt"
              >≈ {fmt.qty(windMph, 'speed')}</small
            >{/if}</output
        >
        <button
          type="button"
          aria-label={tr('sprayui.cond.windUp')}
          onclick={() => {
            windMph = windMph + 1;
            markConditionsMeasured();
          }}>+</button
        >
      </div>
      <div class="stepper">
        <span class="stepper-label">{tr('sprayui.cond.temp')}</span>
        <button
          type="button"
          aria-label={tr('sprayui.cond.tempDown')}
          onclick={() => {
            tempF = tempF - 1;
            markConditionsMeasured();
          }}>−</button
        >
        <output
          >{tempF}<small> °F</small>{#if metric}<small class="alt"
              >≈ {fmt.qty(tempF, 'temperature')}</small
            >{/if}</output
        >
        <button
          type="button"
          aria-label={tr('sprayui.cond.tempUp')}
          onclick={() => {
            tempF = tempF + 1;
            markConditionsMeasured();
          }}>+</button
        >
      </div>
      <div class="stepper">
        <span class="stepper-label">{tr('sprayui.cond.rain')}</span>
        <button
          type="button"
          aria-label={tr('sprayui.cond.rainDown')}
          onclick={() => {
            rainMm = Math.max(0, rainMm - 1);
            markConditionsMeasured();
          }}>−</button
        >
        <output
          >{rainMm}<small> mm</small>{#if !metric}<small class="alt"
              >≈ {fmt.qty(rainMm / 25.4, 'precip')}</small
            >{/if}</output
        >
        <button
          type="button"
          aria-label={tr('sprayui.cond.rainUp')}
          onclick={() => {
            rainMm = rainMm + 1;
            markConditionsMeasured();
          }}>+</button
        >
      </div>
    </div>
    {#if !conditionsMeasured}
      <p class="conditions-provenance-note">
        {tr('sprayui.cond.notMeasured')}
      </p>
    {/if}
  </section>

  {#if isCornBlock}
    <section class="step">
      <h2>{tr('sprayui.h.corn')}</h2>
      <div class="conditions">
        <div class="stepper">
          <span class="stepper-label">{tr('sprayui.corn.label')}</span>
          <button
            type="button"
            aria-label={tr('sprayui.corn.down')}
            onclick={() => (cornHeightIn = Math.max(0, (cornHeightIn ?? 0) - 1))}>−</button
          >
          <output
            >{cornHeightIn ?? 0}<small> {tr('sprayui.corn.inchUnit')}</small>{#if metric}<small
                class="alt">≈ {fmt.qty(cornHeightIn ?? 0, 'length')}</small
              >{/if}</output
          >
          <button
            type="button"
            aria-label={tr('sprayui.corn.up')}
            onclick={() => (cornHeightIn = (cornHeightIn ?? 0) + 1)}>+</button
          >
        </div>
      </div>
    </section>
  {/if}
{/if}

{#if lastError}
  <Banner tone="rust" urgent>{tr('sprayui.errorLabel')} {lastError}</Banner>
{/if}

{#if result}
  <section
    class="result spray-card"
    class:ok={result.ok}
    class:stop={!result.ok}
    aria-live="polite"
    aria-atomic="true"
  >
    {#if result.ok}
      <header class="spray-card-head">
        <h2>{tr('sprayui.card.title')}</h2>
        <button
          type="button"
          class="print-btn no-print"
          onclick={() => window.print()}
          aria-label={tr('sprayui.card.printAria')}>{tr('sprayui.card.print')}</button
        >
      </header>

      {#if sprayPass.stopped.length > 0}
        <p class="excluded-blocks" role="note" data-testid="spray-excluded-blocks">
          {tr('sprayui.card.excluded', {
            blocks: sprayPass.stopped.map((b) => b.label).join(', ')
          })}
        </p>
      {/if}

      {#if result.dilutions}
        <!-- Phase 21b follow-up — Spray Card top summary: the headline
             math that an operator can read at a glance. Acres × GPA
             tells them total spray volume; tank count tells them how
             many fills. The print stylesheet pulls this front-and-
             center on the printed sheet. -->
        {@const gpa = result.dilutions[0]?.gpaUsed ?? 15}
        {@const totalSprayGallons = totalAcres * gpa}
        <div class="spray-card-summary">
          <div class="sc-metric">
            <span class="sc-label">{tr('sprayui.card.totalArea')}</span>
            <span class="sc-value"
              >{totalAcres > 0
                ? fmt.label(totalAcres, 'area', { digits: 2 })
                : tr('sprayui.card.notSet')}</span
            >
          </div>
          <div class="sc-metric">
            <span class="sc-label">{tr('sprayui.card.volume')}</span>
            {#if totalAcres > 0}
              <span class="sc-value">{fmt.label(totalSprayGallons, 'volume', { digits: 1 })}</span>
              <span class="sc-sublabel"
                >{fmt.label(totalAcres, 'area', { digits: 2 })} × {fmt.label(
                  gpa,
                  'volumePerArea'
                )}</span
              >
            {:else}
              <span class="sc-value">—</span>
              <span class="sc-sublabel">{tr('sprayui.card.needsSize')}</span>
            {/if}
          </div>
          <div class="sc-metric">
            <span class="sc-label">{tr('sprayui.card.tankFills')}</span>
            <span class="sc-value">{tanksNeeded}</span>
            <span class="sc-sublabel"
              >{tr('sprayui.card.galTank', { gal: tankSizeGallons })}{metric
                ? ` (${fmt.qty(tankSizeGallons, 'volume', { digits: 0 })})`
                : ''}</span
            >
          </div>
        </div>
        {#if unsizedBlocks.length > 0 && data.setup.canEdit}
          <div class="size-prompt" data-testid="spray-size-prompt">
            <p>{tr('sprayui.size.prompt')}</p>
            {#each unsizedBlocks as b (b.id)}
              <label class="size-row">
                <span>{tr('sprayui.size.acres', { name: b.label })}</span>
                <input
                  type="number"
                  min="0.001"
                  step="0.01"
                  inputmode="decimal"
                  placeholder={tr('sprayui.size.placeholder')}
                  value={sizeDrafts[b.id] ?? ''}
                  oninput={(e) => (sizeDrafts = { ...sizeDrafts, [b.id]: e.currentTarget.value })}
                />
                <button
                  type="button"
                  class="size-save"
                  disabled={sizeSaving !== null}
                  onclick={() => saveBlockAcres(b.id)}
                >
                  {sizeSaving === b.id ? tr('sprayui.saving') : tr('sprayui.size.save')}
                </button>
              </label>
            {/each}
            {#if sizeError}<p class="error" role="alert">{sizeError}</p>{/if}
          </div>
        {/if}
        {#if blocksMissingAcres.length > 0}
          <p class="dilution-warn-line" lang="en" data-english-only="safety">
            ⚠ Acres unknown for {blocksMissingAcres.join(', ')} — totals exclude these blocks. Set acres
            in <a href="/settings/farm/map">Settings → Farm map</a> for accurate dilution.
          </p>
        {/if}
        {#if tanksNeeded > 1}
          <p class="dilution-warn-line" lang="en" data-english-only="safety">
            ⚠ Pass exceeds one tank — plan to refill {tanksNeeded - 1} time{tanksNeeded - 1 === 1
              ? ''
              : 's'} mid-pass.
          </p>
        {/if}

        <!-- Per-product table — totals + native + secondary units. The
             operator sees what to buy / measure overall before mixing. -->
        <h3>{tr('sprayui.card.chemicals')}</h3>
        <table class="dilution">
          <thead>
            <tr>
              <th>{tr('sprayui.card.product')}</th>
              <th>{tr('sprayui.card.totalNeeded')}</th>
              <th>{tr('sprayui.card.perTank', { gal: tankSizeGallons })}</th>
            </tr>
          </thead>
          <tbody>
            {#each result.dilutions as d, i (d.pluginId)}
              {@const sd = scaledDilutions[i]}
              {@const totalSecondary = sd
                ? secondaryUnits(sd.totalAmount, d.unit as DilutionUnit)
                : []}
              {@const perTankSecondary = secondaryUnits(d.productAmount, d.unit as DilutionUnit)}
              <tr>
                <td>
                  {d.displayName}
                  {#if d.rateProvenance === 'fallback'}<FallbackRateLine />{/if}
                </td>
                <td>
                  {#if totalAcres > 0}
                    <strong>{sd ? sd.totalDisplay : d.display}</strong>
                    {#if totalSecondary.length > 0}
                      <small class="alt-units">≈ {totalSecondary.join(' · ')}</small>
                    {/if}
                  {:else}
                    <strong aria-label={tr('sprayui.card.unknownAria')}>—</strong>
                  {/if}
                </td>
                <td>
                  <strong>{d.display}</strong>
                  {#if perTankSecondary.length > 0}
                    <small class="alt-units">≈ {perTankSecondary.join(' · ')}</small>
                  {/if}
                </td>
              </tr>
            {/each}
            {#each result.noLabelRate ?? [] as id (id)}
              <tr data-testid="no-label-rate">
                <td>{herbicideName(id)}</td>
                <td colspan="2">
                  <strong lang="en" data-english-only="safety"
                    >No label rate on file. Check the label for the rate and growth stage on this
                    crop.</strong
                  >
                </td>
              </tr>
            {/each}
          </tbody>
        </table>

        <!-- Last-tank fill increments. Crystal-clear "pour this much
             water, then mix in this much chemical" with round-up/down
             options so the operator can fill to a sight-glass mark. -->
        {@const remainingAcresLastTank = totalAcres - (tanksNeeded - 1) * (tankSizeGallons / gpa)}
        {#if remainingAcresLastTank > 0 && remainingAcresLastTank < tankSizeGallons / gpa}
          <h3>{tanksNeeded > 1 ? tr('sprayui.card.lastPartial') : tr('sprayui.card.tankFill')}</h3>
          <p class="fill-note" lang="en" data-english-only="safety">
            The {tanksNeeded > 1 ? 'last tank covers' : 'pass covers'}
            <strong>{fmt.label(remainingAcresLastTank, 'area', { digits: 2 })}</strong>
            — fill to one of these levels, then mix the matching chemical amount.
          </p>
          {#each result.dilutions as d (d.pluginId)}
            {@const rate = d.productAmount / Math.max(0.0001, d.acresCovered)}
            {@const fills = buildLastTankFills(remainingAcresLastTank, gpa, rate, tankSizeGallons)}
            <table class="fill-table">
              <caption>
                {d.displayName}
                {#if d.rateProvenance === 'fallback'}<FallbackRateLine />{/if}
              </caption>
              <thead>
                <tr>
                  <th>{tr('sprayui.card.water')}</th>
                  <th>{tr('sprayui.card.covers')}</th>
                  <th>{tr('sprayui.card.chemical')}</th>
                </tr>
              </thead>
              <tbody>
                {#each fills as f (f.waterGallons)}
                  {@const fillSecondary = secondaryUnits(f.chemicalAmount, d.unit as DilutionUnit)}
                  <tr class:recommended={f.recommended}>
                    <td>
                      <strong
                        >{fmt.label(f.waterGallons, 'volume', {
                          digits: f.recommended ? 2 : 0
                        })}</strong
                      >
                      {#if f.recommended}
                        <small class="rec-tag">{tr('sprayui.card.recommended')}</small>
                      {/if}
                    </td>
                    <td>{fmt.label(f.acresCovered, 'area', { digits: 2 })}</td>
                    <td>
                      <strong>{fmtUnitAmount(f.chemicalAmount, d.unit as DilutionUnit)}</strong>
                      {#if fillSecondary.length > 0}
                        <small class="alt-units">≈ {fillSecondary.join(' · ')}</small>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/each}
        {/if}
      {/if}

      {#if result.tankMixOrder}
        <h3>{tr('sprayui.card.mixOrder')}</h3>
        <ol class="mix-order">
          {#each result.tankMixOrder as step (step.order)}
            <li>{step.instruction}</li>
          {/each}
        </ol>
      {/if}

      {#if selectedBlocks.length > 1 || perBlockResults.size > 1}
        <!-- Phase 21b follow-up — per-block verdict + apply intent for
             multi-block passes. The shared dilution / tank-mix output
             above is sized for the OK blocks only (#735); STOP blocks are
             listed here and skipped when recording. -->
        <h3>{tr('sprayui.card.perBlock')}</h3>
        <ul class="per-block-status">
          {#each selectedBlocks as b (b.id)}
            {@const pr = perBlockResults.get(b.id)}
            {@const oc = recordOutcomes.get(b.id)}
            <li class:ok={pr?.ok} class:stop={pr && !pr.ok}>
              <span class="pb-name">{b.label}</span>
              {#if oc?.kind === 'created'}
                <span class="pb-tag pb-ok">{tr('sprayui.card.created')}</span>
              {:else if oc?.kind === 'skipped-stop'}
                <span class="pb-tag pb-stop" lang="en" data-english-only="safety"
                  >⛔ skipped (STOP)</span
                >
              {:else if oc?.kind === 'failed'}
                <span class="pb-tag pb-stop">{tr('sprayui.card.failed', { error: oc.error })}</span>
              {:else if pr?.ok}
                <span class="pb-tag pb-ok">{tr('sprayui.card.willRecord')}</span>
              {:else if pr && !pr.ok}
                <span class="pb-tag pb-stop" lang="en" data-english-only="safety"
                  >⛔ STOP — {pr.violations[0]?.code ?? 'see violations'}</span
                >
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      <p class="audit">
        {tr('sprayui.card.ruleVersion')}
        {result.ruleVersion} • {tr('sprayui.card.pluginHashes')}
        {#each Object.entries(result.pluginHashes) as [id, h] (id)}
          <code>{id}@{h.slice(0, 8)}</code>
        {/each}
      </p>

      {#if !recordedId}
        {@const okCount = [...perBlockResults.values()].filter((r) => r.ok).length}
        <button
          type="button"
          class="primary"
          onclick={recordSpray}
          disabled={recording || okCount === 0}
        >
          {recording
            ? tr('sprayui.recording')
            : okCount > 1
              ? tr('sprayui.card.confirmMany', { count: okCount })
              : tr('sprayui.card.confirm')}
        </button>
      {:else if queuedOffline}
        <p class="recorded queued">
          {tr('sprayui.card.queued')}
        </p>
        <div class="next-actions" aria-label={tr('sprayui.next.aria')}>
          <a href="/records/pending" class="secondary">{tr('sprayui.next.queue')}</a>
          <a href="/today" class="secondary">{tr('sprayui.next.today')}</a>
        </div>
      {:else}
        <p class="recorded">
          {#if recordedId.startsWith('multi:')}
            {tr('sprayui.card.recordedMany', { count: recordedId.slice('multi:'.length) })}
          {:else}
            {tr('sprayui.card.recordedAs')} <code>{recordedId.slice(0, 8)}…</code>
          {/if}
        </p>
        <div class="next-actions" aria-label={tr('sprayui.next.aria')}>
          <a href="/today" class="secondary">{tr('sprayui.next.today')}</a>
          <a href="/records" class="secondary">{tr('sprayui.next.records')}</a>
          <a href="/spray" class="secondary">{tr('sprayui.next.another')}</a>
        </div>
      {/if}
      <TaskCloseNote
        task={data.taskContext}
        record={{
          blockId: taskBlockId,
          cropId: taskBlockId === data.preselect.blockId ? data.preselect.cropId : null
        }}
        outcome={taskOutcome}
        queued={queuedOffline && taskQueued}
      />
    {:else}
      <h2 lang="en" data-english-only="safety">⛔ STOP — do not spray</h2>
      {#if result.requiresDecon}
        <p lang="en" data-english-only="safety">
          The selected sprayer last carried a different chemistry. Run the decontamination wizard
          before this spray will be allowed.
        </p>
        <button type="button" class="primary" onclick={goToDecon}>
          {tr('sprayui.card.openDecon')}
        </button>
      {/if}
      <ul class="violations">
        {#each result.violations as v (v.code + JSON.stringify(v.detail))}
          <li>
            <strong>{v.code}</strong>
            <p>{v.message}</p>
            {#if v.detail}
              <details>
                <summary>{tr('sprayui.card.kernelDetail')}</summary>
                <pre>{JSON.stringify(v.detail, null, 2)}</pre>
              </details>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<SetupSheet
  open={setupSheet === 'planting'}
  kicker={tr('sprayui.sheet.kicker')}
  title={tr('sprayui.sheet.whatsGrowing')}
  onDone={onPlantingAdded}
  onClose={() => (setupSheet = null)}
>
  {#snippet children(done)}
    <SetupPlantingBackfill
      blocks={data.setup.blocks}
      areas={data.setup.areas}
      canEdit={data.setup.canEdit}
      submitLabel={tr('sprayui.sheet.savePick')}
      onDone={done}
    />
  {/snippet}
</SetupSheet>

<SetupSheet
  open={setupSheet === 'sprayer'}
  kicker={tr('sprayui.sheet.kicker')}
  title={sprayerSheetTitle ?? tr('sprayui.sheet.whichSprayer')}
  onDone={onSprayerAdded}
  onClose={() => {
    setupSheet = null;
    sprayerSheetTitle = null;
  }}
>
  {#snippet children(done)}
    <SetupSprayer
      templates={data.setup.sprayerTemplates}
      canEdit={data.setup.canEdit}
      onCreated={(r) => (sprayerSheetTitle = tr('sprayui.sheet.calibrate', { name: r.label }))}
      onDone={done}
    />
  {/snippet}
</SetupSheet>

{#if sprayer}
  <SetupSheet
    open={setupSheet === 'calibration'}
    kicker={tr('sprayui.sheet.kicker')}
    title={tr('sprayui.sheet.calibrate', { name: sprayer.label })}
    onDone={onCalibrated}
    onClose={() => (setupSheet = null)}
  >
    {#snippet children(done)}
      <SetupCalibration {sprayer} canSave={data.setup.canEdit} onDone={done} />
    {/snippet}
  </SetupSheet>
{/if}

<style>
  .herbicide-search {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0 0 10px;
    font-weight: 600;
  }
  .herbicide-search input {
    min-height: 48px;
    font-size: 16px;
    padding: 0 12px;
    max-width: 28rem;
  }
  .card.incompatible {
    opacity: 0.6;
    border-style: dashed;
  }
  .card .harm {
    color: var(--color-rust);
    font-weight: 600;
  }
  .size-prompt {
    margin: 8px 0;
    padding: 12px;
    border: 1px solid var(--color-divider);
    border-radius: 8px;
    background: var(--pill-wheat-bg);
  }
  .size-prompt p {
    margin: 0 0 8px;
    font-weight: 600;
  }
  .size-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  .size-row input {
    min-height: 48px;
    width: 8rem;
    font-size: 16px;
    padding: 0 10px;
  }
  .size-save {
    min-height: 48px;
    padding: 0 14px;
    font-weight: 600;
  }
  .custom-tank {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 8px;
    font-weight: 600;
  }
  .custom-tank input {
    min-height: 48px;
    max-width: 12rem;
    font-size: 16px;
    padding: 0 12px;
  }
  /* Phase 25b (#85) — Almanac chrome layout. The new stepper + context
     strip sit above the legacy flow with a small spacing buffer. */
  .spray-almanac-chrome {
    margin-bottom: 22px;
  }
  /* h1 + .lede now owned by SprayPageHeader (Phase 25b).
     .prefill-banner superseded by Banner primitive. */
  .sprayer-empty {
    background: #fff8ec;
    border: 1px solid #d9c18f;
    border-radius: 8px;
    padding: 1.25rem 1.5rem;
  }
  .sprayer-empty p {
    margin: 0 0 1rem;
    color: #6b4d00;
  }
  .sprayer-empty .ask-owner {
    margin: 0;
  }
  .sprayer-empty-cta {
    display: flex;
    gap: 1rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .sprayer-empty-cta .primary {
    background: var(--color-forest);
    color: var(--color-cream, #fff8e1);
    border: none;
    min-height: 48px;
    padding: 0 1.25rem;
    border-radius: 6px;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .filter-hint .link-button {
    min-height: 48px;
    font-weight: 600;
  }
  .filter-hint {
    background: #fff8ec;
    color: var(--color-wheat);
    padding: 0.5rem 0.75rem;
    border-radius: 4px;
    margin: 0 0 0.75rem;
    font-size: 0.9rem;
  }
  .link-button {
    background: none;
    border: none;
    color: var(--color-forest);
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
    padding: 0;
    min-height: auto;
    min-width: auto;
  }
  .step {
    background: white;
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 1rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .step h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    color: var(--color-forest);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 0.5rem;
  }
  .card {
    text-align: left;
    padding: 0.75rem;
    border: 2px solid var(--color-divider);
    border-radius: 6px;
    background: white;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-height: 64px;
    color: inherit;
    font: inherit;
  }
  .card:hover {
    border-color: var(--color-forest);
  }
  .card.selected {
    border-color: var(--color-forest);
    background: var(--pill-forest-bg);
  }
  /* Phase 21b follow-up — pre-plant block visual cue. Soft amber so
     the operator notices it's a burndown context, not a regular
     spray-over-growing-crop. */
  .card.preplant {
    background: #fffbeb;
    border-color: #f59e0b;
  }
  .card.preplant.selected {
    background: #fef3c7;
    border-color: #b45309;
  }
  .preplant-tag {
    margin: 0.35rem 0 0;
    color: #92400e;
    font-weight: 600;
    font-size: 0.85rem;
  }
  .card small.planned {
    color: #92400e;
    margin-top: 0.15rem;
  }
  /* Phase 21b follow-up — multi-select block cards. */
  .card-head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .card-check {
    font-size: 1.05rem;
    line-height: 1;
    color: var(--color-forest);
  }
  .existing-event-tag {
    margin: 0.3rem 0 0;
    color: #1d4ed8;
    font-weight: 600;
    font-size: 0.82rem;
  }
  .per-block-status {
    list-style: none;
    padding: 0;
    margin: 0.4rem 0 1rem;
    display: grid;
    gap: 0.3rem;
  }
  .per-block-status li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.45rem 0.6rem;
    background: #f8fafc;
    border-left: 3px solid #cbd5e1;
    border-radius: 0.25rem;
    font-size: 0.88rem;
  }
  .per-block-status li.ok {
    border-left-color: #15803d;
  }
  .per-block-status li.stop {
    border-left-color: #b91c1c;
    background: #fef2f2;
  }
  .pb-name {
    font-weight: 600;
    color: #0f172a;
  }
  .pb-tag {
    font-weight: 600;
    font-size: 0.8rem;
  }
  .pb-ok {
    color: #15803d;
  }
  .pb-stop {
    color: #b91c1c;
  }
  .card small {
    color: #666;
    font-size: 0.8rem;
  }
  .card .warn {
    color: var(--color-wheat);
    font-weight: 600;
  }
  .card .ok {
    color: var(--color-forest);
    font-weight: 600;
  }
  .card ul {
    margin: 0.25rem 0 0;
    padding-left: 1.25rem;
    font-size: 0.85rem;
  }
  .quick-picks {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .pick {
    flex: 1 1 calc(20% - 0.4rem);
    min-width: 70px;
    min-height: 64px;
    background: white;
    color: var(--color-forest);
    border: 2px solid var(--color-divider);
    border-radius: 6px;
    font-weight: 700;
    font-size: 1.4rem;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .pick span {
    font-size: 0.7rem;
    color: #666;
    font-weight: 500;
    margin-top: 0.1rem;
  }
  .pick.selected {
    background: var(--color-forest);
    color: white;
    border-color: var(--color-forest);
  }
  .pick.selected span {
    color: rgba(255, 255, 255, 0.85);
  }
  .conditions {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.5rem;
  }
  /* #320 — three conditions steppers side-by-side on wider screens,
     stacked on mobile. */
  .conditions-grid {
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
  }
  .conditions-provenance-note {
    margin: 0.5rem 0 0;
    padding: 0.45rem 0.6rem;
    background: #fef3c7;
    border-left: 3px solid #b45309;
    border-radius: 0.25rem;
    color: #78350f;
    font-size: 0.85rem;
  }
  .stepper {
    display: grid;
    grid-template-columns: 1fr auto 1fr auto;
    gap: 0.5rem;
    align-items: center;
    padding: 0.5rem;
    background: #f8fbf9;
    border-radius: 6px;
  }
  .stepper-label {
    font-weight: 600;
    color: var(--color-forest);
    font-size: 0.95rem;
  }
  .stepper button {
    width: 56px;
    height: 56px;
    border: 2px solid var(--color-forest);
    background: white;
    color: var(--color-forest);
    border-radius: 6px;
    font-size: 1.6rem;
    font-weight: 700;
    cursor: pointer;
    line-height: 1;
  }
  .stepper button:active {
    background: var(--color-forest);
    color: white;
  }
  .stepper output {
    text-align: center;
    font-family: monospace;
    font-size: 1.6rem;
    font-weight: 700;
    color: var(--color-forest);
    padding: 0.4rem;
  }
  .stepper output small {
    font-size: 0.8rem;
    color: #666;
    font-family: inherit;
    font-weight: 500;
    margin-left: 0.2rem;
  }
  .stepper output small.alt {
    display: block;
    margin: 0.2rem 0 0;
  }
  /* .sticky-cta was for a sticky bottom CTA bar that's no longer rendered
     after the multi-block selection refactor — the "Apply" button lives
     inline in the result card instead. */
  .next-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 1rem;
  }
  .next-actions .secondary {
    flex: 1 1 calc(33% - 0.5rem);
    min-width: 120px;
    background: white;
    color: var(--color-forest);
    border: 2px solid var(--color-forest);
    border-radius: 6px;
    text-decoration: none;
    text-align: center;
    padding: 0.75rem;
    font-weight: 600;
    min-height: 48px;
    line-height: 1.4;
  }
  .next-actions .secondary:hover {
    background: #f0f8f3;
  }
  .hint {
    color: #555;
    font-size: 0.9rem;
    margin: 0 0 0.75rem;
  }
  .primary {
    background: var(--color-forest);
    color: white;
    border: none;
    border-radius: 6px;
    padding: 1rem 1.5rem;
    font-size: 1.1rem;
    font-weight: 600;
    cursor: pointer;
    width: 100%;
    margin-top: 0.5rem;
    min-height: 60px;
  }
  .primary:disabled {
    background: #999;
    cursor: not-allowed;
  }
  /* .error superseded by Banner tone=rust urgent. */
  .result {
    margin-top: 1.5rem;
    padding: 1.25rem;
    border-radius: 8px;
  }
  .excluded-blocks {
    margin: 0 0 10px;
    color: var(--color-rust);
    font-weight: 600;
  }
  .result.ok {
    background: var(--pill-forest-bg);
    border: 2px solid var(--color-forest);
  }
  .result.stop {
    background: #fff;
    /* T-05 (audit F-A): frame red bumped from var(--color-rust) to #8a0000 to match
     * the AAA-contrast header band below. */
    border: 3px solid #8a0000;
    padding: 0;
  }
  .result h2 {
    margin: 0 0 1rem;
  }
  .result.stop h2 {
    /* T-05 (audit F-A): #fff-on-var(--color-rust) was ~5.94:1 (AA only). HCD §2.2
     * stop-screen spec mandates AAA 7:1. #fff-on-#8a0000 ≈ 7.74:1. */
    background: #8a0000;
    color: #fff;
    margin: 0 0 1rem;
    padding: 1rem 1.25rem;
    font-size: 1.5rem;
    border-radius: 5px 5px 0 0;
  }
  .result.stop > :not(h2) {
    margin-left: 1.25rem;
    margin-right: 1.25rem;
  }
  .result.stop > :last-child {
    margin-bottom: 1.25rem;
  }
  .mix-order {
    padding-left: 1.25rem;
    line-height: 1.6;
  }
  .dilution {
    width: 100%;
    border-collapse: collapse;
    font-size: 1rem;
  }
  .dilution th,
  .dilution td {
    text-align: left;
    padding: 0.5rem;
    border-bottom: 1px solid #ccc;
  }
  .dilution td strong {
    font-size: 1.75rem;
    color: var(--color-forest);
    font-family: monospace;
  }
  /* .dilution-summary, .dilution-warn, .dilution td small.exceeds —
     dropped in the Phase 21b multi-tank refactor; the per-tank rows
     now carry their own warning markup. .dilution-warn-line retained
     since it still backs the alongside-table rate-warning. */
  .dilution-warn-line {
    margin: 0 0 0.5rem;
    padding: 0.45rem 0.6rem;
    background: #fef3c7;
    border-left: 3px solid #b45309;
    border-radius: 0.25rem;
    color: #78350f;
    font-size: 0.85rem;
  }
  /* Phase 21b follow-up — Spray Card layout. */
  .spray-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.5rem;
  }
  .spray-card-head h2 {
    margin: 0;
  }
  .print-btn {
    background: #1d4ed8;
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 0.55rem 0.9rem;
    font-weight: 600;
    font-size: 0.9rem;
    cursor: pointer;
    min-height: 40px;
  }
  .print-btn:hover {
    background: #1e40af;
  }
  .spray-card-summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 0.75rem;
    margin: 0.5rem 0 1rem;
    padding: 0.75rem 1rem;
    background: #f0f9ff;
    border: 1px solid #bfdbfe;
    border-radius: 0.4rem;
  }
  .sc-metric {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .sc-label {
    font-size: 0.75rem;
    color: #475569;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .sc-value {
    font-size: 1.7rem;
    font-weight: 700;
    color: #0f172a;
    font-family: monospace;
    line-height: 1.1;
  }
  .sc-sublabel {
    font-size: 0.78rem;
    color: #64748b;
  }
  .alt-units {
    display: block;
    color: #475569;
    font-family: inherit;
    font-size: 0.78rem;
    font-weight: 400;
    margin-top: 0.1rem;
  }
  .fill-note {
    margin: 0.25rem 0 0.5rem;
    color: #475569;
    font-size: 0.9rem;
  }
  .fill-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.95rem;
    margin: 0.5rem 0 1rem;
  }
  .fill-table caption {
    caption-side: top;
    text-align: left;
    font-weight: 700;
    color: var(--color-forest);
    margin-bottom: 0.2rem;
  }
  .fill-table th,
  .fill-table td {
    text-align: left;
    padding: 0.55rem 0.6rem;
    border-bottom: 1px solid #e2e8f0;
  }
  .fill-table tr.recommended {
    background: #ecfdf5;
  }
  .fill-table tr.recommended td {
    border-bottom-color: #6ee7b7;
  }
  .fill-table td strong {
    font-size: 1.15rem;
    color: #0f172a;
    font-family: monospace;
  }
  .rec-tag {
    display: inline-block;
    margin-left: 0.4rem;
    background: #15803d;
    color: #fff;
    font-size: 0.7rem;
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
  }

  /* Phase 21b follow-up — print stylesheet. Hides everything except
     the Spray Card itself; surfaces the headline numbers + tables on
     a single page suitable for the operator to carry on paper or a
     phone. */
  @media print {
    :global(.app-header),
    :global(.app-nav),
    :global(footer),
    :global(.skip-link),
    :global(.opt-error),
    :global(.error) {
      display: none !important;
    }
    .no-print {
      display: none !important;
    }
    .step {
      display: none !important;
    }
    .filter-hint {
      display: none !important;
    }
    .spray-card {
      margin: 0;
      padding: 0;
      border: none;
      background: #fff;
      color: #000;
      box-shadow: none;
    }
    .spray-card-summary {
      background: transparent;
      border: 1px solid #000;
    }
    .sc-value {
      color: #000;
    }
    .fill-table tr.recommended {
      background: #f3f4f6;
    }
    .fill-table caption,
    .spray-card h3 {
      color: #000;
    }
    .audit {
      font-size: 0.7rem;
    }
    .next-actions {
      display: none !important;
    }
  }
  .audit {
    color: #666;
    font-size: 0.8rem;
    margin-top: 1rem;
  }
  .audit code {
    background: #fff;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    margin: 0 0.25rem;
    font-size: 0.75rem;
  }
  .recorded {
    background: white;
    padding: 0.75rem;
    border-radius: 4px;
    margin-top: 1rem;
    font-weight: 600;
  }
  .recorded code {
    background: #f5f5f5;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    font-family: monospace;
  }
  .recorded.queued {
    background: #fff3cd;
    color: var(--color-wheat);
    border-left: 4px solid var(--color-wheat);
    padding-left: 0.75rem;
  }
  .violations {
    list-style: none;
    padding: 0;
  }
  .violations li {
    background: white;
    padding: 0.75rem;
    border-radius: 4px;
    margin-bottom: 0.5rem;
    border-left: 4px solid var(--color-rust);
  }
  .violations li strong {
    color: var(--color-rust);
  }
  .violations p {
    margin: 0.25rem 0;
  }
  details {
    margin-top: 0.5rem;
    font-size: 0.85rem;
  }
  pre {
    background: #f5f5f5;
    padding: 0.5rem;
    border-radius: 4px;
    overflow-x: auto;
  }
</style>
