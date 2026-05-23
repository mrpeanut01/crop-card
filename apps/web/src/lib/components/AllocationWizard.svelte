<script lang="ts">
  import { seedsToPlants, type SeedPluginShape } from '$lib/seed/quantity';
  import type { CropPlugin } from '$lib/plugins/schemas';
  import type { CompanionGroupMarker, PollinationConstraint } from '$lib/plan/types';
  import { untrack } from 'svelte';
  import type { SeasonSetup } from '$lib/season/setup';
  import SeasonSetupStep from '$lib/components/SeasonSetupStep.svelte';
  import SeasonSetupChip from '$lib/components/SeasonSetupChip.svelte';
  import InputsPlanStep from '$lib/components/InputsPlanStep.svelte';
  import type {
    InputsPlanApplication,
    InputsPlanProvisionalPlanting,
    InputsPlanScoutTask
  } from '$lib/plan/inputsPlan';

  type SeedStockEntry = {
    stockItemId: string;
    displayName: string;
    /** Phase 15d — short label; falls back to displayName when absent. */
    shortName?: string;
    onHand: number;
    defaultUnit: string;
    cropPluginId: string | null;
    cropFamily: string | null;
  };

  type BlockEntry = {
    id: string;
    name: string;
    blockLabel?: string;
    acres?: number;
    sunExposure?: 'full' | 'partial' | 'shade';
    plantings: Array<{ varietyDisplayName: string }>;
  };

  type CropCatalogItem = {
    pluginId: string;
    displayName: string;
    cropFamily: string;
  };

  type SufficiencyResult = {
    status: 'deficit' | 'match' | 'surplus';
    plantsAvailable: number;
    plantsFit: number;
    utilizationPct: number;
    leftoverPlants: number;
  };

  type AllocationResponse = {
    assignments: Array<{
      stockItemId: string;
      cropPluginId: string;
      varietyDisplayName: string;
      blockId: string;
      plants: number;
    }>;
    unplaced: Array<{ stockItemId: string; cropPluginId: string; quantityPlants: number }>;
    sufficiency: Record<string, SufficiencyResult>;
    rationale: string;
    perRowRationale: Record<string, string>;
    advisories: string[];
    pollinationConstraints?: PollinationConstraint[];
    geometryMissingBlockIds?: string[];
    companionGroups?: CompanionGroupMarker[];
    meta: {
      model: string;
      usdEstimate: number;
      fallback?: 'engine-only' | 'no-api-key';
      violationsOnFirstAttempt?: string[];
    };
  };

  let {
    seedStock,
    blocks,
    plantingGuides,
    cropCatalog,
    seasonSetup = null,
    lastYearSetup = null,
    currentYear = new Date().getFullYear(),
    onClose,
    onCommitted,
    onRefreshParent
  }: {
    seedStock: SeedStockEntry[];
    blocks: BlockEntry[];
    plantingGuides: Record<string, NonNullable<CropPlugin['plantingGuide']>>;
    cropCatalog: CropCatalogItem[];
    seasonSetup?: SeasonSetup | null;
    lastYearSetup?: SeasonSetup | null;
    currentYear?: number;
    onClose: () => void;
    onCommitted: () => void;
    /** Optional — refresh parent data WITHOUT closing the wizard. Used by
     *  the Start Over flow so the post-wipe seed/block list is fresh in
     *  the modal. When omitted, Start Over still wipes the DB but the
     *  wizard keeps its initial props until the next commit closes the
     *  modal naturally. */
    onRefreshParent?: () => void | Promise<void>;
  } = $props();

  type Step =
    | 'season-setup'
    | 'plan-state'
    | 'seeds'
    | 'blocks'
    | 'review'
    | 'schedule'
    | 'inputs'
    | 'commit';
  // Phase 21: when the operator has never set up the active year, gate the
  // whole flow on the Season Setup form. Otherwise fall into the existing
  // 'seeds' step and surface the saved setup as a chip in the header. The
  // initial wizard state is read from props once at mount; subsequent
  // changes are owned locally (handleSeasonSetupSaved updates `activeSetup`
  // after a successful save).
  //
  // Phase 21 follow-up: when an existing plan is detected (any block
  // already has plantings), gate on the new 'plan-state' chooser so the
  // operator can pick between "Continue planning (add more)" and "Start
  // over (clear current plan)". Without this gate, clicking "Plan
  // Plantings" with a plan in place silently dropped them into the
  // additive flow with no way to reset.
  let activeSetup = $state<SeasonSetup | null>(untrack(() => seasonSetup));
  const hasExistingPlan = untrack(() => blocks.some((b) => b.plantings && b.plantings.length > 0));
  let step: Step = $state(
    untrack(() => {
      if (!activeSetup) return 'season-setup';
      if (hasExistingPlan) return 'plan-state';
      return 'seeds';
    })
  );

  function handleSeasonSetupSaved(saved: SeasonSetup) {
    activeSetup = saved;
    step = hasExistingPlan ? 'plan-state' : 'seeds';
  }

  // ─── Plan-state step handlers (Phase 21 follow-up) ───────────────────
  let resetConfirmOpen = $state(false);
  let resetting = $state(false);
  let resetError = $state<string | null>(null);
  let resetSummary = $state<Record<string, number> | null>(null);

  function continueExistingPlan() {
    step = 'seeds';
  }

  function openResetConfirm() {
    resetError = null;
    resetSummary = null;
    resetConfirmOpen = true;
  }

  function cancelReset() {
    resetConfirmOpen = false;
  }

  async function confirmReset() {
    resetting = true;
    resetError = null;
    try {
      const res = await fetch('/api/plan/reset', { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok) {
        resetError = body.error ?? `HTTP ${res.status}`;
        return;
      }
      resetSummary = body.removed ?? {};
      resetConfirmOpen = false;
      // Advance to 'seeds'. We deliberately do NOT call onCommitted here
      // (that's the parent's signal to CLOSE the wizard). Instead, refresh
      // the parent's data in-place via onRefreshParent so the wizard stays
      // open and the operator can immediately start a fresh plan.
      step = 'seeds';
      if (onRefreshParent) {
        try {
          await onRefreshParent();
        } catch {
          /* refresh failures are non-fatal — wizard keeps its initial props */
        }
      }
    } catch (e) {
      resetError = e instanceof Error ? e.message : String(e);
    } finally {
      resetting = false;
    }
  }

  let seedSearch = $state('');

  const eligibleStock = $derived(seedStock.filter((s) => !!s.cropPluginId && s.onHand > 0));

  const filteredEligibleStock = $derived.by(() => {
    const q = seedSearch.trim().toLowerCase();
    const matches = q
      ? eligibleStock.filter(
          (s) =>
            s.displayName.toLowerCase().includes(q) ||
            (s.cropFamily ?? '').toLowerCase().includes(q)
        )
      : eligibleStock;
    return [...matches].sort((a, b) => {
      const fa = a.cropFamily ?? 'zz';
      const fb = b.cropFamily ?? 'zz';
      if (fa !== fb) return fa.localeCompare(fb);
      return a.displayName.localeCompare(b.displayName);
    });
  });

  const seedFamilyGroups = $derived.by(() => {
    const groups = new Map<string, typeof filteredEligibleStock>();
    for (const s of filteredEligibleStock) {
      const key = s.cropFamily ?? '';
      const list = groups.get(key) ?? [];
      list.push(s);
      groups.set(key, list);
    }
    return [...groups.entries()].map(([family, items]) => ({
      family: family || null,
      items
    }));
  });

  let selectedSeeds = $state<Map<string, number>>(new Map());
  let selectedBlockIds = $state<Set<string>>(new Set());

  let response = $state<AllocationResponse | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  /** Phase 21b follow-up — the AI's last rejected proposal, captured from
   *  refine fallback responses so we can offer "Apply anyway." Cleared on
   *  successful refine or step transitions. */
  let lastRejectedAssignments = $state<AllocationResponse['assignments'] | null>(null);
  let lastRejectedRationale = $state<string>('');
  let lastRejectedViolations = $state<string[]>([]);

  /** Translate a raw validator violation string into operator-friendly
   *  text. Replaces UUIDs with block/variety names from props and
   *  rewrites the known "family density" pattern into plain English.
   *  Anything we don't recognize falls through to UUID-replacement only —
   *  the operator still gets readable names even when the rule wording
   *  stays technical. */
  function humanizeAllocationViolation(v: string): string {
    const blockNames = new Map<string, string>();
    for (const b of blocks) blockNames.set(b.id, b.name);
    const seedNames = new Map<string, string>();
    for (const s of seedStock) {
      seedNames.set(s.stockItemId, s.shortName ?? s.displayName);
    }
    const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
    const replaceIds = (str: string) =>
      str.replace(UUID_RE, (id) => {
        const b = blockNames.get(id);
        if (b) return `“${b}”`;
        const s = seedNames.get(id);
        if (s) return `“${s}”`;
        return id;
      });

    // Family-density pattern: "block <id> packs multiple <family>
    // varieties: total N plants exceeds 1.25× the largest plantsFit (M)"
    const familyMatch = v.match(
      /^block ([0-9a-f-]{36}) packs multiple (\S+) varieties: total (\d+) plants exceeds 1\.25× the largest plantsFit \((\d+)\)/i
    );
    if (familyMatch) {
      const [, blockId, family, totalStr, capStr] = familyMatch;
      const blockName = blockNames.get(blockId) ?? blockId;
      const total = Number(totalStr);
      const cap = Number(capStr);
      const overBy = total - cap;
      const detail = replaceIds(v).replace(/^.*\(/, '(');
      return (
        `Too many ${family} varieties packed onto “${blockName}”: ${total} plants total, ` +
        `but the block's largest single-variety capacity is ${cap}. That's ${overBy} plants ` +
        `over the recommended density. Spread some varieties to another block, or reduce ` +
        `plant counts. ${detail}`
      );
    }

    // Per-assignment density pattern: "assignment X→Y packs N/M plants
    // (R× capacity). Reduce or split..."
    const perAssign = v.match(
      /^assignment ([0-9a-f-]{36})→([0-9a-f-]{36}) packs (\d+)\/(\d+) plants \(([0-9.]+)× capacity\)/
    );
    if (perAssign) {
      const [, sid, bid, plantsStr, capStr] = perAssign;
      const seedName = seedNames.get(sid) ?? sid;
      const blockName = blockNames.get(bid) ?? bid;
      return (
        `“${seedName}” is over-packed on “${blockName}” (${plantsStr} plants vs. ` +
        `${capStr} recommended). This variety has other viable blocks — splitting or ` +
        `reducing would clear the density check.`
      );
    }

    // plantsFit cap pattern: "assignment[N] plants=X exceeds plantsFit=Y for (sid, bid)"
    const plantsFit = v.match(
      /plants=(\d+) exceeds plantsFit=(\d+) for \(([0-9a-f-]{36}), ([0-9a-f-]{36})\)/
    );
    if (plantsFit) {
      const [, plantsStr, capStr, sid, bid] = plantsFit;
      const seedName = seedNames.get(sid) ?? sid;
      const blockName = blockNames.get(bid) ?? bid;
      return `“${seedName}” on “${blockName}” has ${plantsStr} plants but the block only fits ${capStr}.`;
    }

    // Matrix-not-candidate pattern.
    const notCand = v.match(
      /assignment\[\d+\] \(([0-9a-f-]{36}) → ([0-9a-f-]{36})\) is not in the candidacy matrix/
    );
    if (notCand) {
      const [, sid, bid] = notCand;
      const seedName = seedNames.get(sid) ?? sid;
      const blockName = blockNames.get(bid) ?? bid;
      return `The AI proposed planting “${seedName}” on “${blockName}”, but this combination wasn't on the candidacy list (likely a sun, rotation, or capacity mismatch from the original blocks step).`;
    }

    // Default: UUID-replacement only.
    return replaceIds(v);
  }

  /** Phase 17 — chat refinement state. The transcript is the source of truth
   *  for what's rendered in the bubble list and what gets sent to the refine
   *  endpoint on each turn. Seeded with an assistant message synthesized
   *  from the initial plan's advisories so the chat opens with the same
   *  observations the old "Worth considering" block used to show. */
  type ChatMsg = { role: 'user' | 'assistant'; content: string };
  // Two separate transcripts — allocation chat lives with step 3 (Review),
  // schedule chat lives with step 4. Switching steps preserves each
  // transcript so the user can refine either independently, but the
  // schedule chat doesn't carry over allocation-level pollination notes
  // (those are already shown on the Review step).
  let allocationChatMessages = $state<ChatMsg[]>([]);
  let scheduleChatMessages = $state<ChatMsg[]>([]);
  const chatMessages = $derived(
    (step as Step) === 'schedule' ? scheduleChatMessages : allocationChatMessages
  );
  let chatDraft = $state('');
  let chatBusy = $state(false);
  let chatError = $state<string | null>(null);
  let chatLogEl = $state<HTMLDivElement | null>(null);

  function seedChatFromAdvisories(r: AllocationResponse) {
    const lines: string[] = [];
    const pollination = r.pollinationConstraints ?? [];
    const mustStagger = pollination.filter((p) => p.kind === 'must-stagger');
    const isolated = pollination.filter((p) => p.kind === 'isolated-spatially');
    const geomMissing = (r.geometryMissingBlockIds ?? []).length;

    if (mustStagger.length > 0 || isolated.length > 0 || geomMissing > 0) {
      lines.push('Cross-pollination notes:');
      for (const p of isolated) lines.push(`• ${p.note}`);
      for (const p of mustStagger) lines.push(`• ⚠ ${p.note}`);
      if (geomMissing > 0) {
        lines.push(
          `• Couldn't check ${geomMissing} block${geomMissing === 1 ? '' : 's'} without geometry — add field boundaries to enable the spatial check.`
        );
      }
      lines.push('');
    }

    if (r.advisories.length > 0) {
      lines.push('Other things worth thinking about:');
      for (const a of r.advisories) lines.push(`• ${a}`);
      lines.push('');
    }

    if (mustStagger.length > 0) {
      lines.push(
        'These crossing pairs will be carried into the schedule step as required planting offsets. Tell me anything you\'d like to change before then — for example: "swap the Bantam onto Block C to gain more isolation" or "split the brassicas onto two beds."'
      );
    } else if (lines.length === 0) {
      lines.push(
        'Plan looks clean — nothing jumped out to flag. If you\'d like to tweak it, just tell me what to change (e.g., "move the corn off the narrow block" or "give the brassicas more room").'
      );
    } else {
      lines.push(
        'Tell me anything you\'d like to change — for example: "move the corn off the narrow block" or "split the tomatoes onto two beds."'
      );
    }

    allocationChatMessages = [{ role: 'assistant', content: lines.join('\n') }];
    chatDraft = '';
    chatError = null;
  }

  /** Pollination chips for a single assignment row. Surfaces only the
   *  unresolved (must-stagger) constraints so the table doesn't bloat. */
  function pollinationChipsFor(stockItemId: string, blockId: string): PollinationConstraint[] {
    const list = response?.pollinationConstraints ?? [];
    return list.filter(
      (p) =>
        p.kind === 'must-stagger' &&
        ((p.pair[0] === stockItemId && p.blockIds[0] === blockId) ||
          (p.pair[1] === stockItemId && p.blockIds[1] === blockId))
    );
  }

  function partnerStockId(p: PollinationConstraint, stockItemId: string): string {
    return p.pair[0] === stockItemId ? p.pair[1] : p.pair[0];
  }

  /** Single compact stagger summary per row. Lists up to 3 partners by
   *  shortName, "+N more" for the rest, and stuffs the full list into a
   *  tooltip for hover. Returns null when no staggers apply. */
  function pollinationSummary(
    stockItemId: string,
    blockId: string
  ): { label: string; tooltip: string; days: number } | null {
    const chips = pollinationChipsFor(stockItemId, blockId);
    if (chips.length === 0) return null;
    const days = Math.max(...chips.map((c) => c.staggerDays));
    const partners = Array.from(
      new Set(chips.map((c) => varietyDisplayFor(partnerStockId(c, stockItemId))))
    );
    const visible = partners.slice(0, 3);
    const overflow = partners.length - visible.length;
    const label =
      `⚠ ${days}d stagger from ${visible.join(' · ')}` + (overflow > 0 ? ` +${overflow} more` : '');
    const tooltip = `Plant ≥${days} d apart from: ${partners.join(', ')}.`;
    return { label, tooltip, days };
  }

  let commitProgress = $state<{ done: number; total: number; failed: string[] }>({
    done: 0,
    total: 0,
    failed: []
  });

  type ScheduledPlanting = {
    stockItemId: string;
    blockId: string;
    cropPluginId: string;
    varietyDisplayName: string;
    plantingDateMs: number;
    plants: number;
    successionIndex?: { i: number; n: number };
    rationale: string;
  };
  type ScheduleDiagnosis = { summary: string; suggestions: string[] };
  type ScheduleResponse = {
    scheduled: ScheduledPlanting[];
    rationale: string;
    advisories: string[];
    meta: {
      model: string;
      usdEstimate: number;
      fallback?: 'deterministic' | 'no-api-key';
      violations?: string[];
      diagnosis?: ScheduleDiagnosis;
    };
  };

  let scheduleResponse = $state<ScheduleResponse | null>(null);

  // Phase 21b / B-28 — inputs plan state held across the inputs →
  // commit transition. `acceptedInputs` is populated by
  // InputsPlanStep.onCommit and consumed by `commit()` so the
  // planting persistence + task materialization happen as one
  // operator-visible action.
  let acceptedInputs = $state<{
    applications: InputsPlanApplication[];
    scoutTasks: InputsPlanScoutTask[];
  } | null>(null);
  let inputsCommitError = $state<string | null>(null);
  let scheduleLoading = $state(false);
  let scheduleError = $state<string | null>(null);

  function fmtDateMs(ms: number): string {
    return new Date(ms).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  // ─── AI progress heartbeat ──────────────────────────────────────────────
  // Long Sonnet calls (allocator, scheduler, chat refinement) can run 30-120s.
  // Without feedback "Generating…" reads as a hang. We track start time per
  // operation and tick a shared `nowMs` state every 500ms so elapsed time
  // + a rotating stage label can re-render. Stage labels are time-windowed
  // narration — not real progress from the server, but plenty to communicate
  // "the system is alive and working."
  let nowMs = $state(Date.now());
  let allocateStartMs = $state<number | null>(null);
  let scheduleStartMs = $state<number | null>(null);
  let chatStartMs = $state<number | null>(null);

  $effect(() => {
    const active = allocateStartMs != null || scheduleStartMs != null || chatStartMs != null;
    if (!active) return;
    const id = setInterval(() => {
      nowMs = Date.now();
    }, 500);
    return () => clearInterval(id);
  });

  // Diagnostic: log every step transition so we can trace the wizard's
  // path in the browser console. Cheap; only fires when `step` changes.
  $effect(() => {
    console.info('[AllocationWizard] step →', step);
  });

  type ProgressStage = 'allocate' | 'schedule' | 'chat-allocate' | 'chat-schedule';
  function aiProgressLabel(stage: ProgressStage, elapsedMs: number): string {
    const s = Math.floor(elapsedMs / 1000);
    if (stage === 'allocate') {
      if (s < 3) return 'Building candidacy matrix…';
      if (s < 12) return 'Asking Claude to allocate seeds across your blocks…';
      if (s < 30) return 'Weighing sun, rotation, companions, and cross-pollination…';
      if (s < 60) return 'Refining placements to maximize spacing…';
      if (s < 120) return 'Still working — complex farms take a minute or two…';
      return 'Almost there — the API is slower than usual right now…';
    }
    if (stage === 'schedule') {
      if (s < 3) return 'Computing planting windows from frost dates and DTM…';
      if (s < 12) return 'Asking Claude to pick planting dates…';
      if (s < 30) return 'Honoring cross-pollination staggers and companion offsets…';
      if (s < 60) return 'Checking succession spacing for fast-growing crops…';
      if (s < 120) return 'Still scheduling — staggers across many varieties take time…';
      return 'Almost there — the API is slower than usual right now…';
    }
    // Chat refinements are shorter prompts → quicker stages.
    if (s < 2) return 'Reading your message…';
    if (s < 8)
      return stage === 'chat-schedule' ? 'Reconsidering the dates…' : 'Reconsidering the plan…';
    if (s < 20) return 'Validating against constraints…';
    if (s < 45) return 'Still thinking — refinement turn taking longer than usual…';
    return 'Almost there…';
  }

  function fmtElapsed(ms: number): string {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}m ${String(rem).padStart(2, '0')}s`;
  }

  function pluginShapeFor(stockItemId: string): SeedPluginShape | undefined {
    const entry = seedStock.find((s) => s.stockItemId === stockItemId);
    if (!entry?.cropPluginId) return undefined;
    return {
      cropFamily: entry.cropFamily ?? undefined,
      plantingGuide: plantingGuides[entry.cropPluginId]
    };
  }

  function plantsFor(stockItemId: string, quantity: number): number | null {
    const entry = seedStock.find((s) => s.stockItemId === stockItemId);
    if (!entry) return null;
    const result = seedsToPlants({
      unit: entry.defaultUnit,
      quantity,
      plugin: pluginShapeFor(stockItemId)
    });
    return result?.plants ?? null;
  }

  function selectAllInFamily(items: ReadonlyArray<SeedStockEntry>) {
    for (const s of items) {
      if (!selectedSeeds.has(s.stockItemId)) selectedSeeds.set(s.stockItemId, s.onHand);
    }
    selectedSeeds = new Map(selectedSeeds);
  }

  function clearFamily(items: ReadonlyArray<SeedStockEntry>) {
    for (const s of items) selectedSeeds.delete(s.stockItemId);
    selectedSeeds = new Map(selectedSeeds);
  }

  function familySelectedCount(items: ReadonlyArray<SeedStockEntry>): number {
    let n = 0;
    for (const s of items) if (selectedSeeds.has(s.stockItemId)) n++;
    return n;
  }

  function toggleSeed(s: SeedStockEntry) {
    if (selectedSeeds.has(s.stockItemId)) {
      selectedSeeds.delete(s.stockItemId);
    } else {
      selectedSeeds.set(s.stockItemId, s.onHand);
    }
    selectedSeeds = new Map(selectedSeeds);
  }

  function setSeedQuantity(stockItemId: string, quantity: number) {
    const entry = seedStock.find((s) => s.stockItemId === stockItemId);
    if (!entry) return;
    const clamped = Math.max(0, Math.min(entry.onHand, quantity));
    selectedSeeds.set(stockItemId, clamped);
    selectedSeeds = new Map(selectedSeeds);
  }

  function toggleBlock(id: string) {
    if (selectedBlockIds.has(id)) selectedBlockIds.delete(id);
    else selectedBlockIds.add(id);
    selectedBlockIds = new Set(selectedBlockIds);
  }

  function selectAllBlocks() {
    selectedBlockIds = new Set(blocks.map((b) => b.id));
  }

  async function generatePlan() {
    loading = true;
    error = null;
    response = null;
    allocateStartMs = Date.now();
    nowMs = Date.now();
    // Advance to the Review step immediately so the operator sees the
    // staged AI-progress indicator (label + spinner + elapsed time) from
    // second 0, instead of staring at "Generating…" on the Blocks-step
    // button for a minute.
    step = 'review';
    try {
      const seedSelections = [...selectedSeeds.entries()]
        .filter(([, qty]) => qty > 0)
        .map(([stockItemId, quantity]) => {
          const entry = seedStock.find((s) => s.stockItemId === stockItemId)!;
          const plants = plantsFor(stockItemId, quantity);
          return {
            stockItemId,
            cropPluginId: entry.cropPluginId!,
            // Prefer the curated shortName so Claude's rationale + chips
            // surface "Bloody Butcher" instead of "Bloody Butcher
            // Ornamental Corn — Raw Untreated Non-GMO (1/2 lb)". Falls back
            // to displayName when no shortName is set.
            varietyDisplayName: entry.shortName ?? entry.displayName,
            quantityPlants: Math.max(1, plants ?? Math.round(quantity))
          };
        });

      const res = await fetch('/api/plan/allocate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          seedSelections,
          blockIds: [...selectedBlockIds]
        })
      });
      const body = (await res.json()) as AllocationResponse | { error: string };
      if (!res.ok) {
        error = 'error' in body ? body.error : `HTTP ${res.status}`;
        return;
      }
      response = body as AllocationResponse;
      seedChatFromAdvisories(response);
    } catch (err) {
      error = err instanceof Error ? err.message : 'request failed';
    } finally {
      loading = false;
      allocateStartMs = null;
    }
  }

  async function sendChat() {
    const text = chatDraft.trim();
    if (!text || chatBusy || !response) return;
    chatError = null;
    const userTurn: ChatMsg = { role: 'user', content: text };
    // Append to the active step's transcript optimistically.
    if (step === 'schedule') {
      scheduleChatMessages = [...scheduleChatMessages, userTurn];
    } else {
      allocationChatMessages = [...allocationChatMessages, userTurn];
    }
    chatDraft = '';
    chatBusy = true;
    chatStartMs = Date.now();
    nowMs = Date.now();
    queueScrollChat();
    try {
      // Chat routes through schedule-refinement when in step 4, otherwise
      // allocator-refinement. Each path mutates its own transcript.
      if (step === 'schedule' && scheduleResponse) {
        await sendScheduleChat(text);
      } else {
        await sendAllocationChat(text);
      }
      queueScrollChat();
    } catch (err) {
      chatError = err instanceof Error ? err.message : 'chat request failed';
      // Roll back the optimistic user message on hard error.
      if (step === 'schedule') {
        scheduleChatMessages = scheduleChatMessages.slice(0, -1);
      } else {
        allocationChatMessages = allocationChatMessages.slice(0, -1);
      }
      chatDraft = text;
    } finally {
      chatBusy = false;
      chatStartMs = null;
    }
  }

  async function sendAllocationChat(text: string) {
    if (!response) return;
    const seedSelections = [...selectedSeeds.entries()]
      .filter(([, qty]) => qty > 0)
      .map(([stockItemId, quantity]) => {
        const entry = seedStock.find((s) => s.stockItemId === stockItemId)!;
        const plants = plantsFor(stockItemId, quantity);
        return {
          stockItemId,
          cropPluginId: entry.cropPluginId!,
          varietyDisplayName: entry.shortName ?? entry.displayName,
          quantityPlants: Math.max(1, plants ?? Math.round(quantity))
        };
      });
    const previousPlan = {
      assignments: response.assignments.map((a) => ({
        stockItemId: a.stockItemId,
        blockId: a.blockId,
        plants: a.plants,
        rationale: response!.perRowRationale[`${a.stockItemId}:${a.blockId}`] ?? ''
      })),
      rationale: response.rationale,
      advisories: response.advisories
    };
    const sendable = allocationChatMessages.slice(1);
    const res = await fetch('/api/plan/allocate/refine', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        seedSelections,
        blockIds: [...selectedBlockIds],
        previousPlan,
        transcript: sendable
      })
    });
    const body = await res.json();
    if (!res.ok) {
      chatError = body?.error ?? `HTTP ${res.status}`;
      allocationChatMessages = allocationChatMessages.slice(0, -1);
      chatDraft = text;
      return;
    }
    // When the server fell back (validation failed both passes, parse
    // failed, etc.), body.assignments is the PREVIOUS unchanged plan
    // but the AI's reply may still confidently claim it made changes.
    // Prefix a warning + humanized violations so the operator sees the
    // table didn't update, then capture the AI's rejected proposal so
    // the "Apply anyway" affordance can offer it.
    const fallback: string | undefined = body?.meta?.fallback;
    const rawViolations: string[] = Array.isArray(body?.meta?.violationsOnFirstAttempt)
      ? body.meta.violationsOnFirstAttempt
      : [];
    const violations = rawViolations.map(humanizeAllocationViolation);
    const aiReply: string =
      typeof body.reply === 'string' && body.reply.trim().length > 0
        ? body.reply
        : fallback
          ? 'The plan above is unchanged.'
          : 'Done — updated the plan above.';
    let reply = aiReply;
    if (fallback) {
      const header =
        fallback === 'engine-only'
          ? '⚠ Could not apply the change cleanly — the planning rules flagged it. The plan above is unchanged.'
          : `⚠ The plan above is unchanged (${fallback}).`;
      const violationLine = violations.length > 0 ? `\n\nWhy:\n• ${violations.join('\n• ')}` : '';
      const overrideHint =
        Array.isArray(body?.meta?.rejectedAssignments) && body.meta.rejectedAssignments.length > 0
          ? "\n\nIf you've reviewed and want to accept the AI's plan anyway, use “Apply anyway” below."
          : '';
      reply = `${header}${violationLine}${overrideHint}\n\n${aiReply}`;

      // Capture the rejected proposal + a sticky violation list so the
      // template can render the override button.
      if (Array.isArray(body?.meta?.rejectedAssignments)) {
        lastRejectedAssignments = body.meta.rejectedAssignments;
        lastRejectedRationale =
          typeof body.meta.rejectedRationale === 'string' ? body.meta.rejectedRationale : '';
        lastRejectedViolations = violations;
      } else {
        lastRejectedAssignments = null;
        lastRejectedRationale = '';
        lastRejectedViolations = [];
      }
    } else {
      // Successful refine — clear any stale rejected proposal.
      lastRejectedAssignments = null;
      lastRejectedRationale = '';
      lastRejectedViolations = [];
    }
    allocationChatMessages = [...allocationChatMessages, { role: 'assistant', content: reply }];
    response = {
      assignments: body.assignments,
      unplaced: body.unplaced ?? [],
      sufficiency: body.sufficiency ?? {},
      rationale: body.rationale ?? response.rationale,
      perRowRationale: body.perRowRationale ?? {},
      advisories: Array.isArray(body.advisories) ? body.advisories : [],
      pollinationConstraints: Array.isArray(body.pollinationConstraints)
        ? body.pollinationConstraints
        : response.pollinationConstraints,
      geometryMissingBlockIds: Array.isArray(body.geometryMissingBlockIds)
        ? body.geometryMissingBlockIds
        : response.geometryMissingBlockIds,
      companionGroups: Array.isArray(body.companionGroups)
        ? body.companionGroups
        : response.companionGroups,
      meta: body.meta ?? response.meta
    };
  }

  /** Phase 21b follow-up — operator override. Swaps the response in
   *  place with the AI's last rejected proposal so the planning grid
   *  reflects the operator's accepted-anyway plan. Adds an assistant
   *  message noting the override so the audit trail lives in the chat. */
  function applyRejectedAnyway() {
    if (!response || !lastRejectedAssignments) return;
    const overridden = [...lastRejectedAssignments];
    response = {
      ...response,
      assignments: overridden,
      rationale: lastRejectedRationale || response.rationale,
      // Per-row rationale is cleared — the detailed per-pair text lived
      // only in the rejected proposal before validation stripped it.
      perRowRationale: {},
      // Unplaced + sufficiency are recomputed by the next refine; until
      // then, clear them so the operator doesn't read stale numbers.
      unplaced: [],
      sufficiency: {}
    };
    allocationChatMessages = [
      ...allocationChatMessages,
      {
        role: 'assistant',
        content:
          '✅ Applied the AI plan over the validator. The grid above shows the new layout. ' +
          'Density / capacity checks were overridden — review the plant counts before committing.'
      }
    ];
    lastRejectedAssignments = null;
    lastRejectedRationale = '';
    lastRejectedViolations = [];
  }

  async function sendScheduleChat(text: string) {
    if (!response || !scheduleResponse) return;
    const sendable = scheduleChatMessages.slice(1);
    const res = await fetch('/api/plan/schedule/refine', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        assignments: response.assignments.map((a) => ({
          stockItemId: a.stockItemId,
          blockId: a.blockId,
          cropPluginId: a.cropPluginId,
          varietyDisplayName: a.varietyDisplayName,
          plants: a.plants
        })),
        pollinationConstraints: response.pollinationConstraints ?? [],
        companionGroups: response.companionGroups ?? [],
        previousScheduled: scheduleResponse.scheduled,
        previousRationale: scheduleResponse.rationale,
        previousAdvisories: scheduleResponse.advisories,
        transcript: sendable
      })
    });
    const body = await res.json();
    if (!res.ok) {
      chatError = body?.error ?? `HTTP ${res.status}`;
      scheduleChatMessages = scheduleChatMessages.slice(0, -1);
      chatDraft = text;
      return;
    }
    // When the server fell back (validation failed, parse failed, no API
    // key), the `scheduled` array is the PREVIOUS unchanged plan — the
    // AI's reply may still confidently claim "I moved planting X to date
    // Y", which is misleading. Prefix the chat message with a warning
    // banner so the operator knows the table above did NOT update, and
    // surface the violation list when available.
    const fallback: string | undefined = body?.meta?.fallback;
    const violations: string[] = Array.isArray(body?.meta?.violations) ? body.meta.violations : [];
    const aiReply: string =
      typeof body.reply === 'string' && body.reply.trim().length > 0
        ? body.reply
        : fallback
          ? 'The schedule above is unchanged.'
          : 'Done — updated the dates above.';
    let reply = aiReply;
    if (fallback) {
      const header =
        fallback === 'no-api-key'
          ? '⚠ No Anthropic API key configured — the schedule above is unchanged.'
          : '⚠ Could not apply the change — it would break a planting window, stagger, or companion offset. The schedule above is unchanged.';
      const violationLine =
        violations.length > 0 ? `\n\nValidator violations:\n• ${violations.join('\n• ')}` : '';
      reply = `${header}${violationLine}\n\n${aiReply}`;
    }
    scheduleChatMessages = [...scheduleChatMessages, { role: 'assistant', content: reply }];
    scheduleResponse = {
      scheduled: Array.isArray(body.scheduled) ? body.scheduled : scheduleResponse.scheduled,
      rationale: typeof body.rationale === 'string' ? body.rationale : scheduleResponse.rationale,
      advisories: Array.isArray(body.advisories) ? body.advisories : scheduleResponse.advisories,
      meta: body.meta ?? scheduleResponse.meta
    };
  }

  function queueScrollChat() {
    requestAnimationFrame(() => {
      if (chatLogEl) chatLogEl.scrollTop = chatLogEl.scrollHeight;
    });
  }

  function onChatKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendChat();
    }
  }

  /** Phase B1 — "Accept all" no longer commits. It locks the spatial
   *  allocation in place and advances to the Schedule step, where the
   *  scheduler proposes planting dates (Phase B3+) before the operator
   *  commits crops to the DB. The same chat panel continues in step 4. */
  async function advanceToSchedule() {
    if (!response) return;
    step = 'schedule';
    scheduleResponse = null;
    scheduleError = null;
    scheduleLoading = true;
    scheduleStartMs = Date.now();
    nowMs = Date.now();
    try {
      const res = await fetch('/api/plan/schedule', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          assignments: response.assignments,
          pollinationConstraints: response.pollinationConstraints ?? [],
          companionGroups: response.companionGroups ?? []
        })
      });
      const body = (await res.json()) as ScheduleResponse | { error: string };
      if (!res.ok) {
        scheduleError = 'error' in body ? body.error : `HTTP ${res.status}`;
        return;
      }
      scheduleResponse = body as ScheduleResponse;
      const lines: string[] = [];
      const fb = scheduleResponse.meta.fallback;
      if (fb === 'no-api-key') {
        lines.push(
          '🛟 I picked dates with the deterministic scheduler (no Anthropic API key configured). Staggers and companion offsets are honored.'
        );
        if (scheduleResponse.rationale) lines.push(scheduleResponse.rationale);
        lines.push('');
        lines.push(
          'Tell me anything to change — e.g., "plant the corn the first week of May" or "push the brassicas two weeks later."'
        );
      } else if (fb === 'deterministic') {
        // Help-seeking chat dialogue: the server's diagnosis names specific
        // varieties + actionable suggestions in plain English. We don't show
        // raw validator strings.
        const dx = scheduleResponse.meta.diagnosis;
        if (dx && (dx.summary || dx.suggestions.length > 0)) {
          if (dx.summary) {
            lines.push(`🛟 ${dx.summary}`);
            lines.push('');
            lines.push(
              "I went with a safe-default plan above so you're not stuck — but you can probably do better. Here's what might help:"
            );
          } else {
            lines.push(
              "🛟 I couldn't fit your schedule cleanly. The deterministic plan above is a safe default, but here's what might help:"
            );
          }
          if (dx.suggestions.length > 0) {
            lines.push('');
            for (const s of dx.suggestions) lines.push(`  • ${s}`);
          }
          lines.push('');
          lines.push('What would you like me to try?');
        } else {
          // Diagnosis missing (older server, edge case) — keep a clean
          // fallback message without the technical violation list.
          lines.push(
            "🛟 I couldn't fit your schedule cleanly, even after a retry. The deterministic plan above honors every hard constraint but isn't necessarily the most elegant arrangement."
          );
          lines.push('');
          lines.push(
            'Tell me what to adjust — for example: "drop one corn variety", "skip successions for sweet corn", or "just keep these dates and commit".'
          );
        }
      } else {
        lines.push('📅 Planting dates proposed above.');
        if (scheduleResponse.rationale) lines.push(scheduleResponse.rationale);
        if (scheduleResponse.advisories.length > 0) {
          lines.push('');
          for (const a of scheduleResponse.advisories) lines.push(`• ${a}`);
        }
        lines.push('');
        lines.push(
          'Tell me anything to change — e.g., "plant the corn the first week of May" or "push the brassicas two weeks later."'
        );
      }
      // Start the schedule chat clean — don't carry allocation-step
      // pollination notes or rationale into this conversation. Anything the
      // user wants to revisit about the layout is on the Review step.
      scheduleChatMessages = [{ role: 'assistant', content: lines.join('\n') }];
      queueScrollChat();
    } catch (e) {
      scheduleError = e instanceof Error ? e.message : 'schedule request failed';
    } finally {
      scheduleLoading = false;
      scheduleStartMs = null;
    }
  }

  /** Phase 21b / B-28 — between Schedule and Commit. Advances to the
   *  Inputs Plan step where the deterministic planner proposes per-
   *  planting product applications + IPM scout cadences against the
   *  current season setup. The accept handler stashes the operator's
   *  chosen subset and then calls `commit()` so plantings + tasks
   *  persist as one action. */
  function advanceToInputs() {
    if (!response || !scheduleResponse) return;
    step = 'inputs';
    acceptedInputs = null;
    inputsCommitError = null;
  }

  /** Provisional plantings (in-memory shape) handed to the Inputs Plan
   *  step. The planner uses these as the basis for per-block work; the
   *  underlying `crops` rows don't exist yet — they get persisted when
   *  the operator clicks "Accept and commit" inside the step. */
  function provisionalPlantings(): InputsPlanProvisionalPlanting[] {
    if (!scheduleResponse) return [];
    return scheduleResponse.scheduled.map((s, i) => ({
      id: `${s.stockItemId}:${s.blockId}:${i}`,
      blockId: s.blockId,
      cropPluginId: s.cropPluginId,
      varietyDisplayName: s.varietyDisplayName,
      plantingDate: s.plantingDateMs
    }));
  }

  async function handleInputsAccepted(accepted: {
    applications: InputsPlanApplication[];
    scoutTasks: InputsPlanScoutTask[];
  }) {
    acceptedInputs = accepted;
    await commit();
  }

  async function commit() {
    if (!response) return;
    step = 'commit';
    error = null;

    // Phase B5 — if the scheduler ran, commit one dated row per scheduled
    // planting (successions are already split). Otherwise (no scheduler) fall
    // back to the pre-B5 path that commits one undated row per assignment.
    if (scheduleResponse && scheduleResponse.scheduled.length > 0) {
      await commitScheduled(scheduleResponse.scheduled);
      return;
    }

    commitProgress = {
      done: 0,
      total: response.assignments.length,
      failed: []
    };
    const quantities = buildCommitQuantities(response.assignments);
    for (const a of response.assignments) {
      const seedEntry = seedStock.find((s) => s.stockItemId === a.stockItemId);
      const unit = seedEntry?.defaultUnit ?? 'seeds';
      const quantityForCommit = quantities.get(`${a.stockItemId}:${a.blockId}`) ?? 0;
      try {
        const res = await fetch(`/api/blocks/${a.blockId}/plantings`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            cropPluginId: a.cropPluginId,
            varietyDisplayName: a.varietyDisplayName,
            quantityPlanted: quantityForCommit,
            quantityUnit: unit,
            stockItemId: a.stockItemId
          })
        });
        if (!res.ok) {
          commitProgress.failed.push(`${a.varietyDisplayName} → ${blockNameFor(a.blockId)}`);
        }
      } catch {
        commitProgress.failed.push(`${a.varietyDisplayName} → ${blockNameFor(a.blockId)}`);
      }
      commitProgress = { ...commitProgress, done: commitProgress.done + 1 };
    }
    if (commitProgress.failed.length === 0) {
      await commitAcceptedInputs();
      onCommitted();
    }
  }

  /** Phase B5 — dated commit. Walks the scheduler's `scheduled[]` and posts
   *  one planting per dated row, including succession entries. Seed quantity
   *  per row = (plants_i / total_plants_per_stock) × operator's original
   *  selectedSeeds quantity so stock decrement matches what was actually
   *  consumed. */
  async function commitScheduled(plantings: ScheduledPlanting[]) {
    commitProgress = {
      done: 0,
      total: plantings.length,
      failed: []
    };
    // Pre-compute total plants per (stockItemId) and the operator's seed
    // quantity so we can apportion per-row seed accurately.
    const totalPlantsByStock = new Map<string, number>();
    for (const p of plantings) {
      totalPlantsByStock.set(
        p.stockItemId,
        (totalPlantsByStock.get(p.stockItemId) ?? 0) + p.plants
      );
    }

    for (const p of plantings) {
      const seedEntry = seedStock.find((s) => s.stockItemId === p.stockItemId);
      const unit = seedEntry?.defaultUnit ?? 'seeds';
      const selectedQty = selectedSeeds.get(p.stockItemId) ?? 0;
      const totalPlants = totalPlantsByStock.get(p.stockItemId) ?? 0;
      const seedQty = totalPlants > 0 ? (p.plants / totalPlants) * selectedQty : 0;
      const isInteger = unit === 'seeds' || unit === 'count' || unit === 'packets';
      const quantityForCommit = isInteger
        ? Math.max(0, Math.round(seedQty))
        : Number(seedQty.toFixed(3));
      try {
        const res = await fetch(`/api/blocks/${p.blockId}/plantings`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            cropPluginId: p.cropPluginId,
            varietyDisplayName: p.varietyDisplayName,
            quantityPlanted: quantityForCommit,
            quantityUnit: unit,
            stockItemId: p.stockItemId,
            plantingDate: p.plantingDateMs
          })
        });
        if (!res.ok) {
          commitProgress.failed.push(
            `${p.varietyDisplayName} → ${blockNameFor(p.blockId)} (${fmtDateMs(p.plantingDateMs)})`
          );
        }
      } catch {
        commitProgress.failed.push(
          `${p.varietyDisplayName} → ${blockNameFor(p.blockId)} (${fmtDateMs(p.plantingDateMs)})`
        );
      }
      commitProgress = { ...commitProgress, done: commitProgress.done + 1 };
    }
    if (commitProgress.failed.length === 0) {
      await commitAcceptedInputs();
      onCommitted();
    }
  }

  /** POST the operator-accepted Inputs Plan rows as tasks (Phase 21 /
   *  B-28). Runs after plantings persist so the commit endpoint can
   *  resolve cropId via the (blockId, cropPluginId) lookup. A failure
   *  here doesn't block the planting commit — the operator can rerun
   *  the wizard or build tasks manually. */
  async function commitAcceptedInputs(): Promise<void> {
    if (!acceptedInputs) return;
    if (acceptedInputs.applications.length === 0 && acceptedInputs.scoutTasks.length === 0) {
      return;
    }
    try {
      const res = await fetch('/api/plan/inputs/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(acceptedInputs)
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        inputsCommitError = body.error ?? `HTTP ${res.status}`;
      }
    } catch (e) {
      inputsCommitError = e instanceof Error ? e.message : String(e);
    }
  }

  /** Apportion the user's original seed quantity (selectedSeeds) across the
   *  AI's per-block plant assignments. Stock decrement runs against this
   *  number, so the seed quantity actually planted is what gets debited —
   *  not the post-germination plant count. Integer-required units (`seeds`,
   *  `count`, `packets`) use largest-remainder rounding so the per-assignment
   *  values sum back to the user's original quantity. */
  function buildCommitQuantities(
    assignments: AllocationResponse['assignments']
  ): Map<string, number> {
    const out = new Map<string, number>();
    const byStock = new Map<string, AllocationResponse['assignments']>();
    for (const a of assignments) {
      const list = byStock.get(a.stockItemId) ?? [];
      list.push(a);
      byStock.set(a.stockItemId, list);
    }
    for (const [stockItemId, items] of byStock) {
      const entry = seedStock.find((s) => s.stockItemId === stockItemId);
      if (!entry) continue;
      const selectedQty = selectedSeeds.get(stockItemId) ?? 0;
      if (selectedQty <= 0) continue;
      const totalPlants = items.reduce((s, x) => s + x.plants, 0);
      if (totalPlants <= 0) continue;
      const unit = entry.defaultUnit;
      const isInteger = unit === 'seeds' || unit === 'count' || unit === 'packets';
      const raw = items.map((a) => ({
        a,
        raw: (a.plants / totalPlants) * selectedQty
      }));
      if (!isInteger) {
        for (const { a, raw: r } of raw) {
          out.set(`${stockItemId}:${a.blockId}`, Number(r.toFixed(3)));
        }
        continue;
      }
      const target = Math.round(selectedQty);
      const rounded = raw.map((x) => ({
        a: x.a,
        floor: Math.floor(x.raw),
        frac: x.raw - Math.floor(x.raw)
      }));
      let used = rounded.reduce((s, x) => s + x.floor, 0);
      let remainder = target - used;
      const order = [...rounded].sort((x, y) => y.frac - x.frac);
      for (const x of order) {
        if (remainder <= 0) break;
        x.floor += 1;
        remainder -= 1;
      }
      for (const x of rounded) {
        out.set(`${stockItemId}:${x.a.blockId}`, x.floor);
      }
    }
    return out;
  }

  function blockNameFor(blockId: string): string {
    return blocks.find((b) => b.id === blockId)?.name ?? blockId;
  }

  function varietyDisplayFor(stockItemId: string): string {
    const entry = seedStock.find((s) => s.stockItemId === stockItemId);
    return entry?.shortName ?? entry?.displayName ?? stockItemId;
  }

  function sufficiencyChip(s: SufficiencyResult): { label: string; cls: string; tooltip: string } {
    const pct = Math.round(s.utilizationPct * 100);
    if (s.status === 'match') {
      return {
        label: `Fills block · ${pct}%`,
        cls: 'chip-match',
        tooltip: `Your seed quantity (${s.plantsAvailable.toLocaleString()} plants) is the right size for this block (fits ${s.plantsFit.toLocaleString()}).`
      };
    }
    if (s.status === 'surplus') {
      return {
        label: `${s.leftoverPlants.toLocaleString()} extra plants`,
        cls: 'chip-surplus',
        tooltip: `You have seed for ${s.plantsAvailable.toLocaleString()} plants but the block only fits ${s.plantsFit.toLocaleString()} — about ${s.leftoverPlants.toLocaleString()} plants worth of seed will be left over.`
      };
    }
    return {
      label: `Only fills ${pct}% of block`,
      cls: 'chip-deficit',
      tooltip: `Your seed quantity (${s.plantsAvailable.toLocaleString()} plants) only covers ${pct}% of the block's capacity (${s.plantsFit.toLocaleString()} plants).`
    };
  }

  const totalPlantsSelected = $derived(
    [...selectedSeeds.entries()]
      .filter(([, qty]) => qty > 0)
      .reduce((sum, [stockItemId, quantity]) => {
        return sum + (plantsFor(stockItemId, quantity) ?? 0);
      }, 0)
  );

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && step !== 'commit') onClose();
  }
</script>

{#snippet aiProgress(stage: ProgressStage, startMs: number | null)}
  {@const elapsed = startMs == null ? 0 : Math.max(0, nowMs - startMs)}
  <div class="ai-progress" role="status" aria-live="polite">
    <span class="ai-spinner" aria-hidden="true"></span>
    <div class="ai-progress-text">
      <span class="ai-progress-label">{aiProgressLabel(stage, elapsed)}</span>
      <span class="ai-progress-elapsed" aria-label="elapsed time">{fmtElapsed(elapsed)}</span>
    </div>
  </div>
{/snippet}

{#snippet chatPanel()}
  <section class="aw-chat" aria-label="Refine plan with AI">
    <header class="aw-chat-header">
      <h3>💬 Refine with AI</h3>
      <span class="muted">
        {#if step === 'schedule'}Ask for date changes; the schedule above updates each turn.
        {:else}Ask for changes; the plan above updates each turn.
        {/if}
      </span>
    </header>
    <div class="aw-chat-log" bind:this={chatLogEl} role="log" aria-live="polite">
      {#each chatMessages as msg, i (i)}
        <div class={`chat-msg chat-${msg.role}`}>
          <span class="chat-role" aria-hidden="true">{msg.role === 'assistant' ? '🌱' : '👤'}</span>
          <pre class="chat-bubble">{msg.content}</pre>
        </div>
      {/each}
      {#if chatBusy}
        <div class="chat-msg chat-assistant">
          <span class="chat-role" aria-hidden="true">🌱</span>
          <span class="chat-bubble chat-thinking">
            {aiProgressLabel(
              step === 'schedule' ? 'chat-schedule' : 'chat-allocate',
              chatStartMs == null ? 0 : Math.max(0, nowMs - chatStartMs)
            )}
            <span class="chat-elapsed"
              >{fmtElapsed(chatStartMs == null ? 0 : Math.max(0, nowMs - chatStartMs))}</span
            >
          </span>
        </div>
      {/if}
    </div>
    {#if chatError}<p class="aw-error chat-error" role="alert">{chatError}</p>{/if}
    {#if step === 'review' && lastRejectedAssignments && lastRejectedAssignments.length > 0}
      <div class="aw-override-row" role="region" aria-label="Override validators">
        <button
          type="button"
          class="btn-secondary btn-override"
          onclick={applyRejectedAnyway}
          title="Apply the AI's proposed plan even though it failed agronomic validation."
        >
          🛠 Apply anyway ({lastRejectedAssignments.length} rows)
        </button>
        <span class="muted override-hint">
          Bypasses density / capacity checks. Spray-time safety rules are NOT affected.
        </span>
      </div>
    {/if}
    <form
      class="aw-chat-input"
      onsubmit={(e) => {
        e.preventDefault();
        void sendChat();
      }}
    >
      <textarea
        rows="2"
        placeholder={step === 'schedule'
          ? 'e.g. "Plant the corn the first week of May" or "Push brassicas two weeks later"'
          : 'e.g. "Move the corn off the narrow block" or "Give the brassicas more room"'}
        bind:value={chatDraft}
        onkeydown={onChatKeydown}
        disabled={chatBusy}
        aria-label="Refinement request"
      ></textarea>
      <button type="submit" class="btn-primary chat-send" disabled={chatBusy || !chatDraft.trim()}>
        {chatBusy ? '…' : 'Send'}
      </button>
    </form>
  </section>
{/snippet}

<svelte:window on:keydown={onKeydown} />

<div
  class="aw-backdrop"
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget && step !== 'commit') onClose();
  }}
>
  <div class="aw-modal" role="dialog" aria-modal="true" aria-labelledby="aw-title">
    <header class="aw-header">
      <h2 id="aw-title">✨ Plan Plantings</h2>
      <button class="aw-close" type="button" aria-label="Close" onclick={onClose}>✕</button>
    </header>

    {#if activeSetup && step !== 'season-setup'}
      <div class="aw-chip-row">
        <SeasonSetupChip setup={activeSetup} onEdit={() => (step = 'season-setup')} />
      </div>
    {/if}

    <ol class="aw-stepper" aria-label="Wizard steps">
      <li class:active={step === 'season-setup'} class:done={step !== 'season-setup'}>0. Season</li>
      <li class:active={step === 'seeds'} class:done={step !== 'season-setup' && step !== 'seeds'}>
        1. Seeds
      </li>
      <li
        class:active={step === 'blocks'}
        class:done={step === 'review' ||
          step === 'schedule' ||
          step === 'inputs' ||
          step === 'commit'}
      >
        2. Blocks
      </li>
      <li
        class:active={step === 'review'}
        class:done={step === 'schedule' || step === 'inputs' || step === 'commit'}
      >
        3. Review
      </li>
      <li class:active={step === 'schedule'} class:done={step === 'inputs' || step === 'commit'}>
        4. Schedule
      </li>
      <li class:active={step === 'inputs'} class:done={step === 'commit'}>5. Inputs</li>
      <li class:active={step === 'commit'}>6. Commit</li>
    </ol>

    {#if error && step !== 'commit' && step !== 'review' && step !== 'season-setup'}
      <div class="aw-error-banner" role="alert">
        <strong>Couldn't generate plan:</strong>
        {error}
      </div>
    {/if}

    <div class="aw-body">
      {#if step === 'season-setup'}
        <SeasonSetupStep
          existing={activeSetup}
          {lastYearSetup}
          {currentYear}
          onSave={handleSeasonSetupSaved}
        />
      {:else if step === 'plan-state'}
        <section class="aw-plan-state">
          <h3>You have a plan in place</h3>
          <p class="aw-plan-state-lede">
            {#each blocks.filter((b) => b.plantings.length > 0) as b, i (b.id)}
              {#if i > 0},
              {/if}
              <strong>{b.name}</strong>: {b.plantings.length} planting{b.plantings.length === 1
                ? ''
                : 's'}
            {/each}
          </p>
          <p>Pick what to do next:</p>
          <div class="aw-plan-state-actions">
            <button
              type="button"
              class="aw-plan-state-btn aw-plan-state-continue"
              onclick={continueExistingPlan}
            >
              <span class="aw-plan-state-icon" aria-hidden="true">✚</span>
              <span class="aw-plan-state-title">Continue planning</span>
              <span class="aw-plan-state-sub">Add more plantings to the current plan.</span>
            </button>
            <button
              type="button"
              class="aw-plan-state-btn aw-plan-state-reset"
              onclick={openResetConfirm}
            >
              <span class="aw-plan-state-icon" aria-hidden="true">↻</span>
              <span class="aw-plan-state-title">Start over</span>
              <span class="aw-plan-state-sub">
                Clear the current plan and start fresh. Historical (planted / harvested) crops are
                preserved.
              </span>
            </button>
          </div>
          {#if resetError}
            <p class="aw-error" role="alert">Reset failed: {resetError}</p>
          {/if}

          {#if resetConfirmOpen}
            <div
              class="aw-confirm-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="aw-reset-title"
            >
              <div class="aw-confirm-card">
                <h4 id="aw-reset-title">Clear the current plan?</h4>
                <p>
                  This deletes every <strong>planned</strong> crop on your blocks and any open Inputs
                  Plan tasks. Active and harvested crops are kept. This cannot be undone.
                </p>
                <div class="aw-confirm-actions">
                  <button
                    type="button"
                    class="btn-secondary"
                    onclick={cancelReset}
                    disabled={resetting}>Cancel</button
                  >
                  <button
                    type="button"
                    class="btn-danger"
                    onclick={confirmReset}
                    disabled={resetting}
                  >
                    {resetting ? 'Clearing…' : 'Yes — clear the plan'}
                  </button>
                </div>
              </div>
            </div>
          {/if}
        </section>
      {:else if step === 'seeds'}
        <p class="aw-intro">
          Pick the seed lots you want to plant. Adjust quantity per row — defaults to on-hand.
        </p>
        {#if eligibleStock.length === 0}
          <p class="empty">No seed stock with a known crop plugin and on-hand &gt; 0.</p>
        {:else}
          <div class="aw-search-row">
            <input
              type="search"
              class="aw-search"
              placeholder="Search by variety or family…"
              aria-label="Search seed lots"
              bind:value={seedSearch}
            />
            {#if seedSearch.trim().length > 0}
              <span class="muted">
                {filteredEligibleStock.length} of {eligibleStock.length}
              </span>
            {/if}
          </div>
          {#if filteredEligibleStock.length === 0}
            <p class="empty">No seeds match “{seedSearch}”.</p>
          {:else}
            <table class="aw-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Variety</th>
                  <th>On hand</th>
                  <th>Quantity</th>
                  <th>
                    ≈ plants
                    <button
                      type="button"
                      class="aw-info"
                      aria-label="Why is this less than the seed count?"
                      title="Estimated plants the seed will yield, applying an 85% germination assumption.&#10;&#10;• Seeds: count × 0.85 (e.g. 25 seeds → ~21 plants)&#10;• lb / oz / g: converted to seeds via the crop's seeds-per-lb (from the plugin if known, else a family default), then × 0.85&#10;• Count: treated 1:1 (no germination discount — already discrete plants like transplants or plugs)&#10;&#10;Real germination varies by lot and conditions; treat this as a sizing estimate, not a guarantee."
                      >ⓘ</button
                    >
                  </th>
                </tr>
              </thead>
              <tbody>
                {#each seedFamilyGroups as g (g.family ?? '__unc__')}
                  {@const famCount = familySelectedCount(g.items)}
                  <tr class="family-row">
                    <td colspan="5">
                      <span class="family-name">{g.family ?? 'Unclassified'}</span>
                      <span class="muted">({famCount} of {g.items.length} selected)</span>
                      <span class="family-actions">
                        <button
                          type="button"
                          class="family-action-btn"
                          onclick={() => selectAllInFamily(g.items)}
                          disabled={famCount === g.items.length}
                          aria-label={`Select all ${g.family ?? 'unclassified'} seeds`}
                          >Select all</button
                        >
                        {#if famCount > 0}
                          <button
                            type="button"
                            class="family-action-btn family-action-clear"
                            onclick={() => clearFamily(g.items)}
                            aria-label={`Clear ${g.family ?? 'unclassified'} selection`}
                            >Clear</button
                          >
                        {/if}
                      </span>
                    </td>
                  </tr>
                  {#each g.items as s (s.stockItemId)}
                    {@const checked = selectedSeeds.has(s.stockItemId)}
                    {@const qty = selectedSeeds.get(s.stockItemId) ?? s.onHand}
                    {@const plants = plantsFor(s.stockItemId, qty)}
                    <tr class:row-checked={checked}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${s.shortName ?? s.displayName}`}
                          {checked}
                          onchange={() => toggleSeed(s)}
                        />
                      </td>
                      <td title={s.displayName}>
                        <div class="seed-name-cell">
                          <span class="seed-name-primary">{s.shortName ?? s.displayName}</span>
                          {#if s.shortName && s.shortName !== s.displayName}
                            <span class="seed-name-sub">{s.displayName}</span>
                          {/if}
                        </div>
                      </td>
                      <td>{s.onHand} {s.defaultUnit}</td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          max={s.onHand}
                          step="0.25"
                          value={qty}
                          disabled={!checked}
                          oninput={(e) =>
                            setSeedQuantity(
                              s.stockItemId,
                              Number((e.target as HTMLInputElement).value)
                            )}
                        />
                        {s.defaultUnit}
                      </td>
                      <td>{plants !== null ? plants.toLocaleString() : '—'}</td>
                    </tr>
                  {/each}
                {/each}
              </tbody>
            </table>
          {/if}
        {/if}
      {:else if step === 'blocks'}
        <div class="aw-blocks-header">
          <p class="aw-intro">Pick the blocks the wizard may use.</p>
          <div class="aw-blocks-actions">
            <span class="muted">{selectedBlockIds.size} of {blocks.length} selected</span>
            <button type="button" class="aw-link" onclick={selectAllBlocks}>Select all</button>
            {#if selectedBlockIds.size > 0}
              <button type="button" class="aw-link" onclick={() => (selectedBlockIds = new Set())}>
                Clear
              </button>
            {/if}
          </div>
        </div>
        <ul class="aw-blocklist">
          {#each blocks as b (b.id)}
            {@const checked = selectedBlockIds.has(b.id)}
            {@const acresText = b.acres !== undefined ? `${b.acres.toFixed(2)} ac` : null}
            {@const sunText = b.sunExposure ? `${b.sunExposure} sun` : null}
            {@const plantingsText =
              b.plantings.length > 0
                ? `${b.plantings.length} active planting${b.plantings.length === 1 ? '' : 's'}`
                : null}
            <li class:checked>
              <label>
                <input type="checkbox" {checked} onchange={() => toggleBlock(b.id)} />
                <span class="aw-block-info">
                  <span class="aw-block-name">{b.blockLabel ?? b.name}</span>
                  <span class="aw-chips">
                    {#if acresText}<span class="aw-chip">{acresText}</span>{/if}
                    {#if sunText}<span class="aw-chip">☀ {sunText}</span>{/if}
                    {#if plantingsText}<span class="aw-chip aw-chip-warn">🌱 {plantingsText}</span
                      >{/if}
                  </span>
                </span>
              </label>
            </li>
          {/each}
        </ul>
      {:else if step === 'review'}
        {#if loading}
          {@render aiProgress('allocate', allocateStartMs)}
        {:else if error}
          <p class="aw-error">Error: {error}</p>
        {:else if response}
          {#if response.meta.fallback}
            <div class="aw-banner warn">
              {response.meta.fallback === 'no-api-key'
                ? 'No Anthropic API key configured — plan generated by the deterministic engine. Add a key on the Settings page to enable the AI rationale layer.'
                : 'AI output failed validation; falling back to the deterministic engine.'}
            </div>
          {/if}
          {#if (response.geometryMissingBlockIds ?? []).length > 0}
            <div class="aw-banner info">
              📐 Pollination check skipped for {response.geometryMissingBlockIds!.length} block{response
                .geometryMissingBlockIds!.length === 1
                ? ''
                : 's'}
              ({response.geometryMissingBlockIds!.map((id) => blockNameFor(id)).join(', ')}) — add
              field geometry on /fields to enable.
            </div>
          {/if}
          <p class="aw-rationale">{response.rationale}</p>
          <table class="aw-table">
            <thead>
              <tr>
                <th>Seed</th>
                <th>Block</th>
                <th>Plants</th>
                <th>Block fit</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {#each response.assignments as a}
                {@const key = `${a.stockItemId}:${a.blockId}`}
                {@const suff = response.sufficiency[key]}
                {@const chip = suff ? sufficiencyChip(suff) : null}
                {@const poll = pollinationSummary(a.stockItemId, a.blockId)}
                <tr>
                  <td>{varietyDisplayFor(a.stockItemId)}</td>
                  <td>{blockNameFor(a.blockId)}</td>
                  <td>{a.plants.toLocaleString()}</td>
                  <td class="cell-fit">
                    {#if chip}
                      <span class={`chip chip-sm ${chip.cls}`} title={chip.tooltip}
                        >{chip.label}</span
                      >
                    {/if}
                    {#if poll}
                      <span class="chip chip-sm chip-pollination" title={poll.tooltip}
                        >{poll.label}</span
                      >
                    {/if}
                  </td>
                  <td class="why">{response.perRowRationale[key] ?? ''}</td>
                </tr>
              {/each}
            </tbody>
          </table>

          {@render chatPanel()}

          {#if response.unplaced.length > 0}
            <h3>Unplaced</h3>
            <ul>
              {#each response.unplaced as u}
                <li>
                  {varietyDisplayFor(u.stockItemId)}: {u.quantityPlants} plants couldn't be placed.
                </li>
              {/each}
            </ul>
          {/if}

          {#if response.meta.usdEstimate > 0}
            <p class="aw-cost">
              Cost: ${response.meta.usdEstimate.toFixed(4)} ({response.meta.model})
            </p>
          {/if}
        {/if}
      {:else if step === 'schedule'}
        {#if response}
          {#if scheduleLoading}
            {@render aiProgress('schedule', scheduleStartMs)}
          {:else if scheduleError}
            <p class="aw-error">Error: {scheduleError}</p>
            <button class="btn-secondary" onclick={advanceToSchedule}>Retry</button>
          {:else if scheduleResponse}
            {#if scheduleResponse.meta.fallback}
              <div class="aw-banner info">
                {scheduleResponse.meta.fallback === 'no-api-key'
                  ? '🛟 Dates picked by the deterministic scheduler (no Anthropic API key). Staggers + companion offsets honored.'
                  : '🛟 AI needed help — deterministic scheduler took over. See chat below for what tripped it up and refine from there.'}
              </div>
            {/if}
            <p class="aw-rationale">{scheduleResponse.rationale}</p>
            <table class="aw-table">
              <thead>
                <tr>
                  <th>Seed</th>
                  <th>Block</th>
                  <th>Planting date</th>
                  <th>Plants</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {#each scheduleResponse.scheduled as p, i (i)}
                  <tr>
                    <td>
                      {p.varietyDisplayName}
                      {#if p.successionIndex}
                        <span class="chip chip-succession" title="Succession sowing">
                          {p.successionIndex.i}/{p.successionIndex.n}
                        </span>
                      {/if}
                    </td>
                    <td>{blockNameFor(p.blockId)}</td>
                    <td>{fmtDateMs(p.plantingDateMs)}</td>
                    <td>{p.plants.toLocaleString()}</td>
                    <td class="why">{p.rationale}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
            {#if scheduleResponse.advisories.length > 0}
              <section class="aw-banner info">
                <strong>Schedule notes:</strong>
                <ul>
                  {#each scheduleResponse.advisories as a}<li>{a}</li>{/each}
                </ul>
              </section>
            {/if}
            {@render chatPanel()}
          {/if}
        {/if}
      {:else if step === 'inputs'}
        <InputsPlanStep
          plantings={provisionalPlantings()}
          year={currentYear}
          onCommit={handleInputsAccepted}
          onBack={() => (step = 'schedule')}
        />
      {:else if step === 'commit'}
        <p class="aw-loading">
          Committing… {commitProgress.done} / {commitProgress.total}
        </p>
        <progress value={commitProgress.done} max={commitProgress.total}></progress>
        {#if inputsCommitError}
          <p class="aw-error">Inputs plan tasks failed to commit: {inputsCommitError}</p>
        {/if}
        {#if commitProgress.failed.length > 0}
          <p class="aw-error">Failed: {commitProgress.failed.length}</p>
          <ul>
            {#each commitProgress.failed as f}
              <li>{f}</li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>

    <footer class="aw-footer">
      {#if step === 'season-setup'}
        <button class="btn-secondary" onclick={onClose}>Cancel</button>
        {#if activeSetup}
          <button
            class="btn-secondary"
            onclick={() => (step = hasExistingPlan ? 'plan-state' : 'seeds')}
          >
            Keep current & continue
          </button>
        {/if}
      {:else if step === 'plan-state'}
        <button class="btn-secondary" onclick={onClose}>Cancel</button>
      {:else if step === 'seeds'}
        <button class="btn-secondary" onclick={onClose}>Cancel</button>
        <button
          class="btn-primary"
          disabled={[...selectedSeeds.values()].every((v) => v <= 0)}
          onclick={() => (step = 'blocks')}
        >
          Next: blocks ({totalPlantsSelected.toLocaleString()} plants)
        </button>
      {:else if step === 'blocks'}
        <button class="btn-secondary" onclick={() => (step = 'seeds')}>Back</button>
        <button
          class="btn-primary"
          disabled={selectedBlockIds.size === 0 || loading}
          onclick={generatePlan}
        >
          {loading ? 'Generating…' : `Generate plan (${selectedBlockIds.size} blocks)`}
        </button>
      {:else if step === 'review'}
        <button class="btn-secondary" onclick={() => (step = 'blocks')}>Back</button>
        <button class="btn-secondary" onclick={generatePlan} disabled={loading}>Regenerate</button>
        <button
          class="btn-primary"
          onclick={advanceToSchedule}
          disabled={!response || response.assignments.length === 0}
          title="Locks the layout above and moves on to picking planting dates."
        >
          Accept all → schedule
        </button>
      {:else if step === 'schedule'}
        <button class="btn-secondary" onclick={() => (step = 'review')}>Back to allocation</button>
        <button class="btn-secondary" onclick={advanceToSchedule} disabled={scheduleLoading}
          >Re-schedule</button
        >
        <button
          class="btn-primary"
          onclick={advanceToInputs}
          disabled={scheduleLoading || !scheduleResponse || scheduleResponse.scheduled.length === 0}
        >
          Accept dates → inputs plan ({scheduleResponse?.scheduled.length ?? 0})
        </button>
      {:else if step === 'inputs'}
        <!-- Footer actions live inside InputsPlanStep; no parent buttons here. -->
      {:else if step === 'commit'}
        <button
          class="btn-primary"
          onclick={onClose}
          disabled={commitProgress.done < commitProgress.total}
        >
          {commitProgress.done < commitProgress.total ? 'Committing…' : 'Done'}
        </button>
      {/if}
    </footer>
  </div>
</div>

<style>
  .aw-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 1400;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  .aw-modal {
    background: white;
    border-radius: 12px;
    width: 100%;
    max-width: 1080px;
    max-height: 92vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-top: 6px solid #1f5e3a;
  }
  .aw-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.9rem 1.25rem;
    border-bottom: 1px solid #e4e9e4;
  }
  .aw-header h2 {
    margin: 0;
    font-size: 1.15rem;
    color: #1f5e3a;
  }
  .aw-close {
    background: none;
    border: none;
    font-size: 1.2rem;
    color: #666;
    min-width: 48px;
    min-height: 48px;
    border-radius: 4px;
    cursor: pointer;
  }
  .aw-chip-row {
    padding: 0.5rem 1.25rem 0;
    background: #f8fbf9;
    border-bottom: none;
  }
  .aw-stepper {
    display: flex;
    list-style: none;
    margin: 0;
    padding: 0.6rem 1.25rem;
    gap: 0.75rem;
    border-bottom: 1px solid #e4e9e4;
    background: #f8fbf9;
    color: #6a7d6a;
  }
  .aw-stepper li {
    font-size: 0.95rem;
  }
  .aw-stepper li.active {
    color: #1f5e3a;
    font-weight: 700;
  }
  .aw-stepper li.done {
    color: #1f5e3a;
    opacity: 0.6;
  }
  .aw-body {
    padding: 1rem 1.25rem;
    overflow-y: auto;
    flex: 1;
  }
  .aw-intro {
    margin: 0 0 0.75rem;
    color: #4a5d4a;
  }
  .aw-plan-state {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .aw-plan-state h3 {
    margin: 0;
    color: #1f5e3a;
  }
  .aw-plan-state-lede {
    margin: 0;
    color: #555;
    font-size: 0.95rem;
  }
  .aw-plan-state-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }
  @media (max-width: 600px) {
    .aw-plan-state-actions {
      grid-template-columns: 1fr;
    }
  }
  .aw-plan-state-btn {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    align-items: flex-start;
    padding: 1rem;
    border: 2px solid #ddd;
    border-radius: 8px;
    background: #fff;
    cursor: pointer;
    text-align: left;
    min-height: 96px;
  }
  .aw-plan-state-btn:hover {
    border-color: #1f5e3a;
    background: #f4f9f5;
  }
  .aw-plan-state-icon {
    font-size: 1.5rem;
    line-height: 1;
  }
  .aw-plan-state-title {
    font-size: 1.1rem;
    font-weight: 700;
    color: #1f5e3a;
  }
  .aw-plan-state-reset .aw-plan-state-title {
    color: #b71c1c;
  }
  .aw-plan-state-reset:hover {
    border-color: #b71c1c;
    background: #fdecea;
  }
  .aw-plan-state-sub {
    font-size: 0.9rem;
    color: #555;
    font-weight: normal;
  }
  .aw-confirm-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .aw-confirm-card {
    background: #fff;
    border-radius: 8px;
    padding: 1.25rem 1.5rem;
    max-width: 480px;
    width: calc(100% - 2rem);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  }
  .aw-confirm-card h4 {
    margin: 0 0 0.5rem;
    color: #b71c1c;
  }
  .aw-confirm-card p {
    margin: 0 0 1rem;
    color: #333;
  }
  .aw-confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  .btn-danger {
    min-height: 48px;
    padding: 0 1.25rem;
    background: #b71c1c;
    color: #fff;
    border: none;
    border-radius: 6px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
  }
  .btn-danger:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .aw-table {
    width: 100%;
    border-collapse: collapse;
  }
  .aw-table th,
  .aw-table td {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid #e4e9e4;
    text-align: left;
    vertical-align: middle;
  }
  .aw-table th {
    background: #f8fbf9;
    color: #1f5e3a;
    font-weight: 700;
    font-size: 0.9rem;
  }
  .aw-table input[type='number'] {
    width: 5rem;
    min-height: 32px;
    padding: 0.25rem 0.4rem;
    border: 1px solid #cbd5cb;
    border-radius: 4px;
    text-align: right;
  }
  .row-checked {
    background: #f3f9f4;
  }
  .seed-name-cell {
    display: flex;
    flex-direction: column;
    gap: 0.05rem;
    line-height: 1.2;
  }
  .seed-name-primary {
    font-weight: 600;
    color: #1a1a1a;
  }
  .seed-name-sub {
    font-size: 0.78rem;
    color: #6b7280;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 320px;
  }
  .muted {
    color: #6a7d6a;
    font-size: 0.9rem;
  }
  .aw-search-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.6rem;
  }
  .aw-search {
    flex: 1;
    min-height: 36px;
    padding: 0.4rem 0.6rem;
    border: 1px solid #cbd5cb;
    border-radius: 6px;
    font-size: 0.95rem;
  }
  .family-row td {
    background: #eef4ef;
    color: #1f5e3a;
    font-weight: 700;
    font-size: 0.85rem;
    text-transform: capitalize;
    padding: 0.35rem 0.75rem;
  }
  .family-row .family-name {
    margin-right: 0.4rem;
  }
  .family-actions {
    float: right;
    display: inline-flex;
    gap: 0.4rem;
  }
  .family-action-btn {
    background: white;
    color: #1f5e3a;
    border: 1px solid #1f5e3a;
    border-radius: 4px;
    padding: 0.12rem 0.55rem;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    line-height: 1.4;
    min-height: 24px;
  }
  .family-action-btn:hover:not(:disabled) {
    background: #f0f5f1;
  }
  .family-action-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .family-action-clear {
    border-color: #b8860b;
    color: #6a4f00;
  }
  .family-action-clear:hover {
    background: #fff8e6;
  }
  .aw-info {
    display: inline-block;
    margin-left: 0.25rem;
    padding: 0;
    background: none;
    border: 0;
    color: #6a7d6a;
    cursor: help;
    font-size: 0.85em;
    line-height: 1;
    user-select: none;
  }
  .aw-info:hover,
  .aw-info:focus {
    color: #1f5e3a;
    outline: none;
  }
  .aw-blocks-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.5rem;
  }
  .aw-blocks-header .aw-intro {
    margin: 0;
  }
  .aw-blocks-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.9rem;
  }
  .aw-blocklist {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 0.5rem;
  }
  .aw-blocklist li {
    border: 1px solid #cbd5cb;
    border-radius: 8px;
    background: white;
    transition:
      border-color 0.1s,
      background 0.1s;
  }
  .aw-blocklist li:hover {
    border-color: #1f5e3a;
  }
  .aw-blocklist li.checked {
    border-color: #1f5e3a;
    background: #f3f9f4;
  }
  .aw-blocklist label {
    display: flex;
    align-items: flex-start;
    gap: 0.65rem;
    padding: 0.65rem 0.8rem;
    cursor: pointer;
    width: 100%;
  }
  .aw-blocklist input[type='checkbox'] {
    margin-top: 0.15rem;
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    accent-color: #1f5e3a;
  }
  .aw-block-info {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-width: 0;
    flex: 1;
  }
  .aw-block-name {
    font-weight: 700;
    color: #1f3a26;
    font-size: 0.95rem;
    line-height: 1.2;
  }
  .aw-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .aw-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.1rem 0.5rem;
    background: #eef4ef;
    color: #4a5d4a;
    border-radius: 999px;
    font-size: 0.78rem;
    line-height: 1.4;
    white-space: nowrap;
    text-transform: capitalize;
  }
  .aw-chip-warn {
    background: #fff1cc;
    color: #6a4f00;
  }
  .aw-link {
    background: none;
    border: none;
    color: #1f5e3a;
    text-decoration: underline;
    cursor: pointer;
    font-size: inherit;
    padding: 0;
  }
  .aw-rationale {
    background: #f3f9f4;
    border-left: 3px solid #1f5e3a;
    padding: 0.75rem 1rem;
    margin: 0 0 0.75rem;
    color: #1f5e3a;
    font-size: 0.95rem;
  }
  .aw-chat {
    margin: 1rem 0 0.25rem;
    border: 1px solid #cbd5cb;
    border-radius: 10px;
    background: #fafcfa;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .aw-chat-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 0.55rem 0.9rem;
    background: #eef4ef;
    border-bottom: 1px solid #d8e2d8;
    gap: 0.75rem;
  }
  .aw-chat-header h3 {
    margin: 0;
    font-size: 0.95rem;
    color: #1f5e3a;
  }
  .aw-chat-log {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.75rem 0.9rem;
    max-height: 280px;
    overflow-y: auto;
    background: white;
  }
  .chat-msg {
    display: flex;
    align-items: flex-start;
    gap: 0.55rem;
  }
  .chat-msg.chat-user {
    flex-direction: row-reverse;
  }
  .chat-role {
    font-size: 1.05rem;
    line-height: 1.6;
    flex-shrink: 0;
  }
  .chat-bubble {
    margin: 0;
    padding: 0.5rem 0.75rem;
    border-radius: 10px;
    font-size: 0.92rem;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
    max-width: 80%;
    font-family: inherit;
  }
  .chat-msg.chat-assistant .chat-bubble {
    background: #f3f9f4;
    color: #1f3a26;
    border-top-left-radius: 4px;
  }
  .chat-msg.chat-user .chat-bubble {
    background: #1f5e3a;
    color: white;
    border-top-right-radius: 4px;
  }
  .chat-thinking {
    font-style: italic;
    color: #4a5d4a;
  }
  .chat-error {
    margin: 0.25rem 0.9rem 0;
    font-size: 0.85rem;
  }
  .aw-override-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
    padding: 0.5rem 0.75rem;
    margin: 0 0.75rem;
    background: #fff8e1;
    border: 1px solid #f1c40f;
    border-radius: 6px;
  }
  .btn-override {
    background: #fff;
    color: #5b3a00;
    border: 1px solid #f1c40f;
    font-weight: 600;
    padding: 0.4rem 0.9rem;
    border-radius: 6px;
    min-height: 40px;
    cursor: pointer;
  }
  .btn-override:hover {
    background: #fff3c4;
  }
  .override-hint {
    font-size: 0.85rem;
    flex: 1;
    min-width: 12rem;
  }
  .aw-chat-input {
    display: flex;
    gap: 0.5rem;
    padding: 0.6rem 0.75rem 0.75rem;
    background: #fafcfa;
    border-top: 1px solid #e4e9e4;
  }
  .aw-chat-input textarea {
    flex: 1;
    min-height: 44px;
    max-height: 140px;
    resize: vertical;
    padding: 0.5rem 0.6rem;
    border: 1px solid #cbd5cb;
    border-radius: 6px;
    font-size: 0.95rem;
    font-family: inherit;
    line-height: 1.4;
  }
  .aw-chat-input textarea:focus {
    outline: 2px solid #1f5e3a;
    outline-offset: 1px;
  }
  .chat-send {
    align-self: stretch;
    min-height: 44px;
    padding: 0 1rem;
  }
  .aw-banner.warn {
    background: #fff8e6;
    border-left: 3px solid #b8860b;
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.75rem;
    color: #6a4f00;
    font-size: 0.92rem;
  }
  .aw-banner.info {
    background: #eaf3fb;
    border-left: 3px solid #2e6dbf;
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.75rem;
    color: #1f4a85;
    font-size: 0.92rem;
  }
  .chip-pollination {
    background: #fbe7d8;
    color: #8a3a00;
    cursor: help;
  }
  .chip-sm {
    padding: 0.08rem 0.45rem;
    font-size: 0.78rem;
    font-weight: 500;
    line-height: 1.35;
    display: inline-block;
    margin: 0 0.25rem 0.25rem 0;
    max-width: 26rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: middle;
  }
  td.cell-fit {
    max-width: 28rem;
    min-width: 12rem;
  }
  .aw-schedule-coming-soon {
    font-style: italic;
    margin: 0.75rem 0 0;
  }
  .chip-succession {
    background: #e6efff;
    color: #1f4a85;
    margin-left: 0.3rem;
    font-weight: 600;
  }
  .ai-progress {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    background: #f3f9f4;
    border: 1px solid #cbd5cb;
    border-radius: 8px;
    padding: 0.75rem 1rem;
    color: #1f5e3a;
  }
  .ai-progress-text {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    line-height: 1.3;
  }
  .ai-progress-label {
    font-weight: 600;
    font-size: 0.95rem;
  }
  .ai-progress-elapsed {
    font-size: 0.78rem;
    color: #4a5d4a;
    font-variant-numeric: tabular-nums;
  }
  .ai-spinner {
    display: inline-block;
    width: 18px;
    height: 18px;
    border: 2px solid #cbd5cb;
    border-top-color: #1f5e3a;
    border-radius: 50%;
    animation: ai-spin 0.8s linear infinite;
    flex-shrink: 0;
  }
  @keyframes ai-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .chat-elapsed {
    display: block;
    font-size: 0.72rem;
    color: #4a5d4a;
    font-variant-numeric: tabular-nums;
    margin-top: 0.15rem;
    font-style: normal;
  }
  .aw-error {
    color: #b22222;
    font-weight: 600;
  }
  .aw-error-banner {
    background: #fdecec;
    color: #8a1f1f;
    border-left: 3px solid #b22222;
    padding: 0.6rem 0.9rem;
    margin: 0.5rem 1.25rem 0;
    font-size: 0.9rem;
    line-height: 1.4;
  }
  .aw-error-banner strong {
    color: #6a1414;
  }
  .aw-loading {
    color: #1f5e3a;
    font-size: 1rem;
  }
  .chip {
    display: inline-block;
    padding: 0.15rem 0.55rem;
    border-radius: 999px;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .chip-match {
    background: #d6efdc;
    color: #1f5e3a;
  }
  .chip-surplus {
    background: #fff1cc;
    color: #6a4f00;
  }
  .chip-deficit {
    background: #f9d6d6;
    color: #8a1f1f;
  }
  .why {
    color: #4a5d4a;
    font-size: 0.9rem;
    max-width: 22rem;
  }
  .aw-cost {
    color: #6a7d6a;
    font-size: 0.85rem;
    text-align: right;
  }
  .aw-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
    padding: 0.75rem 1.25rem;
    border-top: 1px solid #e4e9e4;
    background: #fafcfa;
  }
  .btn-primary,
  .btn-secondary {
    min-height: 44px;
    padding: 0 1rem;
    border-radius: 6px;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid #cbd5cb;
  }
  .btn-primary {
    background: #1f5e3a;
    color: white;
    border-color: #1f5e3a;
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-secondary {
    background: white;
    color: #4a5d4a;
  }
  progress {
    width: 100%;
    height: 14px;
    margin-top: 0.5rem;
  }
  .empty {
    color: #6a7d6a;
    font-style: italic;
  }
</style>
