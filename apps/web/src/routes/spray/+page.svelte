<script lang="ts">
  import { goto } from '$app/navigation';
  import { untrack } from 'svelte';
  import GroupCodeBadge from '$lib/components/GroupCodeBadge.svelte';
  import Banner from '$lib/components/ui/Banner.svelte';
  import SprayPageHeader from '$lib/components/spray/SprayPageHeader.svelte';
  // Phase 25b (#85) — Almanac chrome (stepper + context strip) on top
  // of the existing herbicide flow. 1:1 with ASprayScreen.
  import SprayStepper, { type StepState } from '$lib/components/spray/SprayStepper.svelte';
  import SprayContextStrip, {
    type SprayContextBlock,
    type CompatibilityState
  } from '$lib/components/spray/SprayContextStrip.svelte';

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
      { label: 'Block & crop', state: hasBlocks ? 'done' : 'active' },
      {
        label: 'Sprayer & tank',
        state: !hasSprayer ? (hasBlocks ? 'active' : 'pending') : 'done'
      },
      {
        label: 'Mix',
        state: !hasMix ? (hasBlocks && hasSprayer ? 'active' : 'pending') : 'done'
      },
      {
        label: 'Safety check',
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
        label: 'Confirm & record',
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
          : (data.blocks[0]?.id ?? '');
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
  let windMph = $state(5);
  let tempF = $state(70);
  let rainMm = $state(0);
  let cornHeightIn = $state<number | undefined>(6);
  let tankSizeGallons = $state(50);
  let showAllHerbicides = $state(untrack(() => data.preselect.windowStage === null));

  type SprayerPrefs = {
    tankSizeGallons: number;
    windMph: number;
    tempF: number;
    rainMm: number;
    cornHeightIn?: number;
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
    if (!prefs) return;
    tankSizeGallons = prefs.tankSizeGallons;
    windMph = prefs.windMph;
    tempF = prefs.tempF;
    rainMm = prefs.rainMm;
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
    | { kind: 'updated'; eventId: string }
    | { kind: 'skipped-stop' }
    | { kind: 'skipped-locked' }
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
  };
  type TankMixStep = { order: number; instruction: string; productPluginId?: string };
  type EvaluateResult = {
    ok: boolean;
    violations: Violation[];
    requiresDecon: boolean;
    dilutions?: Dilution[];
    tankMixOrder?: TankMixStep[];
    ruleVersion: string;
    pluginHashes: Record<string, string>;
    sprayerState?: { id: string; lastChemistryClass?: string };
  };

  /** Phase 21b follow-up — array of currently-selected blocks. Driven
   *  by the `selectedBlockIds` Set so toggling is O(1) on the cards. */
  const selectedBlocks = $derived(data.blocks.filter((b) => selectedBlockIds.has(b.id)));
  const sprayer = $derived(data.sprayers.find((s) => s.id === selectedSprayerId));
  /** Corn-height input fires when ANY selected block has corn in the
   *  ground. The same height applies to all corn blocks in the pass —
   *  a reasonable simplification since operators walk the field once. */
  const isCornBlock = $derived(
    selectedBlocks.some((b) => b.crops.some((c) => c.cropFamily === 'corn'))
  );

  /**
   * Phase 21b follow-up — total acres across all selected blocks. Used
   * to scale the dilution display from "per tank" to "total spray
   * pass" so the operator sees the actual product needed and the
   * tank count required to cover everything.
   *
   * `acres === null` on a block means the operator didn't enter acres
   * AND no geometry exists to derive them. We surface a warning when
   * any selected block is missing acres so the dilution math is
   * understood to be a lower bound.
   */
  const totalAcres = $derived(selectedBlocks.reduce((sum, b) => sum + (b.acres ?? 0), 0));
  const blocksMissingAcres = $derived(
    selectedBlocks.filter((b) => b.acres == null || b.acres <= 0).map((b) => b.label)
  );

  /** acresCovered for ONE tank = tankSizeGallons / gpaUsed. We pull
   *  gpaUsed from the first dilution row when available, otherwise
   *  default to 15 GPA (the calculator's fallback). */
  const tankAcresCapacity = $derived.by(() => {
    const gpa = result?.dilutions?.[0]?.gpaUsed ?? 15;
    return tankSizeGallons / gpa;
  });
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
   * size, corn height) re-fires evaluate() after a short debounce.
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
  $effect(() => {
    // Read every input the kernel cares about so Svelte's reactivity
    // wires this effect to all of them. Order matters: declare in
    // dependency order so dead-code elimination can't drop them.
    const inputsReady = selectedBlocks.length > 0 && selectedHerbicideIds.length > 0 && !!sprayer;
    // touch shared form fields
    void tankSizeGallons;
    void cornHeightIn;
    if (!inputsReady) {
      result = null;
      perBlockResults = new Map();
      return;
    }
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
      lastError = e instanceof Error ? e.message : String(e);
    } finally {
      evaluating = false;
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
      conditions: { windMph, tempF, rainForecastMmNext24h: rainMm },
      // Phase 21b follow-up — when deep-linked from a pip popover the
      // server closes the originating task on a successful record.
      // Only attach cropId/taskId on the block the popover came from,
      // and only when that block actually has a crop in the ground.
      ...(data.preselect?.cropId && b.id === data.preselect.blockId && !b.preplant
        ? { cropId: data.preselect.cropId }
        : {}),
      ...(data.preselect?.taskId && b.id === data.preselect.blockId
        ? { taskId: data.preselect.taskId }
        : {})
    };
  }

  /**
   * Phase 21b follow-up — multi-block record dispatcher. For each
   * selected block:
   *   • Skip if kernel said STOP (partial-OK policy).
   *   • If block has an existing editable spray_event today (within
   *     the 48h lock), PATCH it (the operator is refining a recent
   *     record).
   *   • Else POST a new spray_event.
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

    saveSprayerPrefs(sprayer.id, {
      tankSizeGallons,
      windMph,
      tempF,
      rainMm,
      cornHeightIn: isCornBlock ? cornHeightIn : undefined
    });

    const outcomes = new Map<string, RecordOutcome>();
    let postedTaskRedirect = false;

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
        } catch (e) {
          outcomes.set(b.id, {
            kind: 'failed',
            error: e instanceof Error ? e.message : String(e)
          });
        }
        continue;
      }
      try {
        const existingId = b.existingEvent?.id;
        const url = existingId
          ? `/api/spray/record/${encodeURIComponent(existingId)}`
          : '/api/spray/record';
        const method = existingId ? 'PATCH' : 'POST';
        // PATCH endpoint expects a slightly different body — no
        // top-level `blockId` (the URL identifies the row). Build a
        // PATCH-friendly variant by stripping it.
        const patchBody = existingId
          ? (({ blockId: _unused, sprayer: _sprayer, tankSizeGallons: _tank, ...rest }) => rest)(
              body
            )
          : body;
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchBody)
        });
        const respData = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (res.status === 409 && existingId) {
            outcomes.set(b.id, { kind: 'skipped-locked' });
          } else {
            outcomes.set(b.id, {
              kind: 'failed',
              error: respData.error ?? `HTTP ${res.status}`
            });
          }
          continue;
        }
        outcomes.set(b.id, {
          kind: existingId ? 'updated' : 'created',
          eventId: respData.event.id
        });
        if (data.preselect?.taskId && b.id === data.preselect.blockId) {
          postedTaskRedirect = true;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const isNetworkErr = e instanceof TypeError && /(fetch|network|failed)/i.test(msg);
        if (isNetworkErr) {
          try {
            const { enqueueSprayRecord } = await import('$lib/client/syncQueue');
            const queueId = await enqueueSprayRecord(body);
            outcomes.set(b.id, { kind: 'created', eventId: queueId });
            queuedOffline = true;
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
      (o): o is RecordOutcome & { kind: 'created' | 'updated'; eventId: string } =>
        o.kind === 'created' || o.kind === 'updated'
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

    if (postedTaskRedirect) {
      goto('/plan?tab=schedule&view=swimlane');
    }
  }

  // Phase 25b (#85) — Almanac chrome derived state.
  const sprayStepperData = $derived(deriveStepperData());
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
        : `${cropFamilies.length} crop families`
  );
  const ctxCropSubtitle = $derived(
    selectedBlocks.length === 0
      ? undefined
      : selectedBlocks
          .flatMap((b) => b.crops)
          .slice(0, 3)
          .map((c) => c.displayName)
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
</script>

<SprayPageHeader chemistry="herbicide" />

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
  />
</div>

{#if data.preselect.fromScout || data.preselect.blockId}
  <Banner tone="forest">
    {#if data.preselect.fromScout}
      Continuing from scout — block pre-selected.
    {:else}
      Pre-filled from <a href="/today">today's calendar</a>.
    {/if}
  </Banner>
{/if}

{#if data.blocks.length === 0}
  <section class="step empty-state">
    <h2>No blocks with plantings yet</h2>
    <p>
      Add a block + planting on <a href="/plan">/plan</a> first. The spray flow operates on real plantings
      so the kernel knows what crops are in the block.
    </p>
  </section>
{:else}
  <section class="step">
    <h2>1. Block</h2>
    <div class="cards">
      {#each data.blocks as b (b.id)}
        {@const isSelected = selectedBlockIds.has(b.id)}
        <button
          type="button"
          class="card"
          class:selected={isSelected}
          class:preplant={b.preplant}
          aria-pressed={isSelected}
          onclick={() => toggleBlock(b.id)}
        >
          <span class="card-head">
            <span class="card-check" aria-hidden="true">{isSelected ? '☑' : '☐'}</span>
            <strong>{b.label}</strong>
          </span>
          <small>{b.description}</small>
          {#if b.preplant}
            <!-- Phase 21b follow-up — block has nothing in the ground;
                 spray is a pre-plant burndown. Crop-tox check skipped. -->
            <p class="preplant-tag">🌱 Pre-plant — no crop in ground</p>
            {#if b.plannedCropNames.length > 0}
              <small class="planned">
                Planned: {b.plannedCropNames.join(', ')}
              </small>
            {/if}
          {:else}
            <ul>
              {#each b.crops as c}
                <li>{c.displayName} <em>({c.cropFamily})</em></li>
              {/each}
            </ul>
          {/if}
          {#if b.existingEvent}
            <!-- Phase 21b follow-up — block has a still-editable spray
                 event from earlier today. Recording will PATCH it
                 instead of creating a duplicate. -->
            <p class="existing-event-tag">
              ✏ Will update event from
              {new Date(b.existingEvent.occurredAt).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit'
              })}
            </p>
          {/if}
        </button>
      {/each}
    </div>
  </section>

  <section class="step">
    <h2>2. Herbicide(s)</h2>
    {#if data.preselect.windowStage && !showAllHerbicides}
      <p class="filter-hint">
        Filtered to <strong>{data.preselect.windowStage}</strong> window from today's calendar.
        <button class="link-button" onclick={() => (showAllHerbicides = true)}>
          Show all herbicides
        </button>
      </p>
    {/if}
    <div class="cards">
      {#each showAllHerbicides ? data.allHerbicides : data.herbicides as h (h.pluginId)}
        <button
          type="button"
          class="card"
          class:selected={selectedHerbicideIds.includes(h.pluginId)}
          onclick={() => toggleHerbicide(h.pluginId)}
        >
          <strong>{h.displayName}</strong>
          {#if h.hracGroups && h.hracGroups.length > 0}
            <div class="badges">
              {#each h.hracGroups as g}
                <GroupCodeBadge kind="HRAC" group={g} />
              {/each}
            </div>
          {/if}
          <small
            >{h.applicationTiming ?? 'unspecified timing'} • {h.chemistryClasses.join(', ')}</small
          >
          <small>
            {h.ratePerAcre.amount}
            {h.ratePerAcre.unit}/A @ {h.gpaCalibration} GPA
            {#if h.requiresAMS}• AMS{/if}
            {#if h.deconRequired}• decon{/if}
          </small>
        </button>
      {/each}
    </div>
  </section>

  <section class="step">
    <h2>3. Sprayer</h2>
    <div class="cards">
      {#each data.sprayers as s (s.id)}
        <button
          type="button"
          class="card"
          class:selected={selectedSprayerId === s.id}
          onclick={() => (selectedSprayerId = s.id)}
        >
          <strong>{s.label}</strong>
          <small
            >id: {s.id} • {s.calibratedGpa != null
              ? `${s.calibratedGpa} GPA`
              : 'Uncalibrated'}</small
          >
          {#if s.lastChemistryClass}
            <small class="warn">last load: {s.lastChemistryClass}</small>
          {:else}
            <small class="ok">clean</small>
          {/if}
          {#if s.lastDeconAt}
            <small>last decon: {new Date(s.lastDeconAt).toLocaleString()}</small>
          {/if}
        </button>
      {/each}
    </div>
  </section>

  <section class="step">
    <h2>4. Tank size</h2>
    <p class="hint">
      Pick the tank you're loading. Per spec §4.2, supported sizes are 10/25/50/75/100 gal.
    </p>
    <div class="quick-picks" role="radiogroup" aria-label="Tank size in gallons">
      {#each [10, 25, 50, 75, 100] as size (size)}
        <button
          type="button"
          role="radio"
          aria-checked={tankSizeGallons === size}
          class="pick"
          class:selected={tankSizeGallons === size}
          onclick={() => (tankSizeGallons = size)}
        >
          {size} <span>gal</span>
        </button>
      {/each}
    </div>
  </section>

  <!-- Phase 21b follow-up — Conditions section removed and "Check safety"
       button removed. The kernel now runs dynamically via a debounced
       `$effect` (script section) whenever blocks / herbicides / sprayer
       / tank size change. Conservative defaults are used for wind /
       temp / rain; environmental gates still fire if those defaults
       cross a kernel threshold. Operators with a real concern can
       check the local forecast — the form no longer demands the data. -->
  {#if isCornBlock}
    <section class="step">
      <h2>Corn height</h2>
      <div class="conditions">
        <div class="stepper">
          <span class="stepper-label">Corn ht</span>
          <button
            type="button"
            aria-label="Decrease corn height"
            onclick={() => (cornHeightIn = Math.max(0, (cornHeightIn ?? 0) - 1))}>−</button
          >
          <output>{cornHeightIn ?? 0}<small> in</small></output>
          <button
            type="button"
            aria-label="Increase corn height"
            onclick={() => (cornHeightIn = (cornHeightIn ?? 0) + 1)}>+</button
          >
        </div>
      </div>
    </section>
  {/if}
{/if}

{#if lastError}
  <Banner tone="rust" urgent>Error: {lastError}</Banner>
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
        <h2>✓ Spray Card</h2>
        <button
          type="button"
          class="print-btn no-print"
          onclick={() => window.print()}
          aria-label="Print spray card">🖨 Print Spray Card</button
        >
      </header>

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
            <span class="sc-label">Total area</span>
            <span class="sc-value">{totalAcres.toFixed(2)} ac</span>
          </div>
          <div class="sc-metric">
            <span class="sc-label">Spray volume</span>
            <span class="sc-value">{totalSprayGallons.toFixed(1)} gal</span>
            <span class="sc-sublabel">{totalAcres.toFixed(2)} ac × {gpa} GPA</span>
          </div>
          <div class="sc-metric">
            <span class="sc-label">Tank fills</span>
            <span class="sc-value">{tanksNeeded}</span>
            <span class="sc-sublabel">{tankSizeGallons}-gal tank</span>
          </div>
        </div>
        {#if blocksMissingAcres.length > 0}
          <p class="dilution-warn-line">
            ⚠ Acres unknown for {blocksMissingAcres.join(', ')} — totals exclude these blocks. Set acres
            on the <a href="/plan?tab=layout">Layout tab</a> for accurate dilution.
          </p>
        {/if}
        {#if tanksNeeded > 1}
          <p class="dilution-warn-line">
            ⚠ Pass exceeds one tank — plan to refill {tanksNeeded - 1} time{tanksNeeded - 1 === 1
              ? ''
              : 's'} mid-pass.
          </p>
        {/if}

        <!-- Per-product table — totals + native + secondary units. The
             operator sees what to buy / measure overall before mixing. -->
        <h3>Chemicals needed</h3>
        <table class="dilution">
          <thead>
            <tr>
              <th>Product</th>
              <th>Total needed</th>
              <th>Per full {tankSizeGallons}-gal tank</th>
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
                <td>{d.displayName}</td>
                <td>
                  <strong>{sd ? sd.totalDisplay : d.display}</strong>
                  {#if totalSecondary.length > 0}
                    <small class="alt-units">≈ {totalSecondary.join(' · ')}</small>
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
          </tbody>
        </table>

        <!-- Last-tank fill increments. Crystal-clear "pour this much
             water, then mix in this much chemical" with round-up/down
             options so the operator can fill to a sight-glass mark. -->
        {@const remainingAcresLastTank = totalAcres - (tanksNeeded - 1) * (tankSizeGallons / gpa)}
        {#if remainingAcresLastTank > 0 && remainingAcresLastTank < tankSizeGallons / gpa}
          <h3>{tanksNeeded > 1 ? `Last (partial) tank` : `Tank fill`}</h3>
          <p class="fill-note">
            The {tanksNeeded > 1 ? 'last tank covers' : 'pass covers'}
            <strong>{remainingAcresLastTank.toFixed(2)} ac</strong>
            — fill to one of these levels, then mix the matching chemical amount.
          </p>
          {#each result.dilutions as d (d.pluginId)}
            {@const rate = d.productAmount / Math.max(0.0001, d.acresCovered)}
            {@const fills = buildLastTankFills(remainingAcresLastTank, gpa, rate, tankSizeGallons)}
            <table class="fill-table">
              <caption>{d.displayName}</caption>
              <thead>
                <tr>
                  <th>Water (gal)</th>
                  <th>Covers</th>
                  <th>Chemical</th>
                </tr>
              </thead>
              <tbody>
                {#each fills as f (f.waterGallons)}
                  {@const fillSecondary = secondaryUnits(f.chemicalAmount, d.unit as DilutionUnit)}
                  <tr class:recommended={f.recommended}>
                    <td>
                      <strong>{f.waterGallons.toFixed(f.recommended ? 2 : 0)} gal</strong>
                      {#if f.recommended}
                        <small class="rec-tag">recommended</small>
                      {/if}
                    </td>
                    <td>{f.acresCovered.toFixed(2)} ac</td>
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
        <h3>Tank-mix order</h3>
        <ol class="mix-order">
          {#each result.tankMixOrder as step (step.order)}
            <li>{step.instruction}</li>
          {/each}
        </ol>
      {/if}

      {#if selectedBlocks.length > 1 || perBlockResults.size > 1}
        <!-- Phase 21b follow-up — per-block verdict + apply intent for
             multi-block passes. The shared dilution / tank-mix output
             above applies to every OK block; STOP blocks are listed
             here so the operator can deselect them before recording. -->
        <h3>Per-block outcome</h3>
        <ul class="per-block-status">
          {#each selectedBlocks as b (b.id)}
            {@const pr = perBlockResults.get(b.id)}
            {@const oc = recordOutcomes.get(b.id)}
            <li class:ok={pr?.ok} class:stop={pr && !pr.ok}>
              <span class="pb-name">{b.label}</span>
              {#if oc?.kind === 'created'}
                <span class="pb-tag pb-ok">✓ created</span>
              {:else if oc?.kind === 'updated'}
                <span class="pb-tag pb-ok">✏ updated</span>
              {:else if oc?.kind === 'skipped-stop'}
                <span class="pb-tag pb-stop">⛔ skipped (STOP)</span>
              {:else if oc?.kind === 'skipped-locked'}
                <span class="pb-tag pb-stop">🔒 skipped (locked &gt; 48h)</span>
              {:else if oc?.kind === 'failed'}
                <span class="pb-tag pb-stop">⚠ failed: {oc.error}</span>
              {:else if pr?.ok}
                <span class="pb-tag pb-ok">✓ {b.existingEvent ? 'will update' : 'will record'}</span
                >
              {:else if pr && !pr.ok}
                <span class="pb-tag pb-stop"
                  >⛔ STOP — {pr.violations[0]?.code ?? 'see violations'}</span
                >
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      <p class="audit">
        Rule version: {result.ruleVersion} • Plugin hashes:
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
            ? 'Recording…'
            : okCount > 1
              ? `Confirm — record this spray on ${okCount} blocks`
              : 'Confirm — record this spray'}
        </button>
      {:else if queuedOffline}
        <p class="recorded queued">
          ☁ Offline — queued. Will sync to the server when connection returns.
        </p>
        <div class="next-actions" aria-label="What's next">
          <a href="/records/pending" class="secondary">View queue</a>
          <a href="/today" class="secondary">Back to today</a>
        </div>
      {:else}
        <p class="recorded">
          {#if recordedId.startsWith('multi:')}
            ✓ Recorded on {recordedId.slice('multi:'.length)} blocks
          {:else}
            ✓ Spray event recorded as <code>{recordedId.slice(0, 8)}…</code>
          {/if}
        </p>
        <div class="next-actions" aria-label="What's next">
          <a href="/today" class="secondary">Back to today</a>
          <a href="/records" class="secondary">View records</a>
          <a href="/spray" class="secondary">Plan another spray</a>
        </div>
      {/if}
    {:else}
      <h2>⛔ STOP — do not spray</h2>
      {#if result.requiresDecon}
        <p>
          The selected sprayer last carried a different chemistry. Run the decontamination wizard
          before this spray will be allowed.
        </p>
        <button type="button" class="primary" onclick={goToDecon}> Open decon wizard → </button>
      {/if}
      <ul class="violations">
        {#each result.violations as v (v.code + JSON.stringify(v.detail))}
          <li>
            <strong>{v.code}</strong>
            <p>{v.message}</p>
            {#if v.detail}
              <details>
                <summary>Show kernel evaluation detail</summary>
                <pre>{JSON.stringify(v.detail, null, 2)}</pre>
              </details>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  /* Phase 25b (#85) — Almanac chrome layout. The new stepper + context
     strip sit above the legacy flow with a small spacing buffer. */
  .spray-almanac-chrome {
    margin-bottom: 22px;
  }
  /* h1 + .lede now owned by SprayPageHeader (Phase 25b).
     .prefill-banner superseded by Banner primitive. */
  .empty-state {
    text-align: center;
    padding: 2rem;
  }
  .empty-state a {
    color: var(--color-forest);
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
