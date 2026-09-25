import { getContext, setContext, untrack } from 'svelte';
import { seedsToPlants, type SeedPluginShape } from '$lib/seed/quantity';
import type { CropPlugin } from '$lib/plugins/schemas';
import type { SeasonSetup } from '$lib/season/setup';
import type {
  InputsPlanApplication,
  InputsPlanProvisionalPlanting,
  InputsPlanScoutTask
} from '$lib/plan/inputsPlan';
import { fmtDateMs } from './format';
import { AllocateFlow } from './flows/allocateFlow';
import { AllocationChatFlow } from './flows/allocationChat';
import { ScheduleFlow } from './flows/scheduleFlow';
import { humanizeAllocationViolation as humanizeViolation } from './flows/violations';
import { PlanResetState } from './steps/planResetState.svelte';
import { SeedLinkState } from './steps/seedLinkState.svelte';
import type {
  AllocationResponse,
  BlockEntry,
  ChatMsg,
  InitialChatMessage,
  ScheduleResponse,
  ScheduledPlanting,
  SeedStockEntry,
  Step
} from './types';

/** Live (reactive) wizard props. Callers pass getters so prop updates from
 *  `onRefreshParent` (e.g. fresh seed stock after linking a plugin) flow
 *  through without re-creating the store. */
export interface WizardInputs {
  readonly seedStock: SeedStockEntry[];
  readonly blocks: BlockEntry[];
  readonly plantingGuides: Record<string, NonNullable<CropPlugin['plantingGuide']>>;
  readonly aiEnabled: boolean;
  readonly wizardPlanId: string | undefined;
  readonly onClose: () => void;
  readonly onCommitted: () => void;
  readonly onRefreshParent: (() => void | Promise<void>) | undefined;
}

/** Props read once at mount (the wizard owns them locally afterwards). */
export interface WizardInitial {
  seasonSetup: SeasonSetup | null;
  initialChatMessages: InitialChatMessage[];
  initialStep: 'season-setup' | 'allocation' | undefined;
}

// Phase 25b (#96) — derived wizard step descriptors for the Almanac
// header. Ordered: season → seeds → blocks → review → schedule →
// inputs → commit. `plan-state` is a transient gate that doesn't get
// its own header slot (the chip-row above carries it visually). State
// per step: done = past, active = current (header applies this),
// pending = future, stale = data drifted (Phase 26 follow-up).
export const STEP_ORDER: Step[] = [
  'season-setup',
  'seeds',
  'blocks',
  'review',
  'schedule',
  'inputs',
  'commit'
];
export const STEP_LABELS: Record<Step, string> = {
  'season-setup': '0. Season',
  'plan-state': 'Plan state',
  seeds: '1. Seeds',
  blocks: '2. Blocks',
  review: '3. Review',
  schedule: '4. Schedule',
  inputs: '5. Inputs',
  commit: '6. Commit'
};

const VALID_STEPS: Step[] = [
  'season-setup',
  'plan-state',
  'seeds',
  'blocks',
  'review',
  'schedule',
  'inputs',
  'commit'
];

/**
 * Cross-step state + flows for the allocation wizard (#96 per-step split).
 * Every step component reads and mutates this one instance via context so
 * Back/Next and header jumps keep selections, the allocation, the schedule
 * and both chat transcripts exactly as the pre-split monolith did.
 */
export class AllocationWizardState {
  readonly props: WizardInputs;

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
  activeSetup = $state<SeasonSetup | null>(null);
  readonly hasExistingPlan: boolean;
  step = $state<Step>('seeds');

  readonly planReset: PlanResetState;
  readonly seedLink: SeedLinkState;
  readonly #allocate = new AllocateFlow(this);
  readonly #chat = new AllocationChatFlow(this, this.#allocate);
  readonly #schedule = new ScheduleFlow(this);

  seedSearch = $state('');

  selectedSeeds = $state<Map<string, number>>(new Map());
  selectedBlockIds = $state<Set<string>>(new Set());

  response = $state<AllocationResponse | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);

  /** Phase 21b follow-up — the AI's last rejected proposal, captured from
   *  refine fallback responses so we can offer "Apply anyway." Cleared on
   *  successful refine or step transitions. */
  lastRejectedAssignments = $state<AllocationResponse['assignments'] | null>(null);
  lastRejectedRationale = $state<string>('');
  lastRejectedViolations = $state<string[]>([]);

  // Two separate transcripts — allocation chat lives with step 3 (Review),
  // schedule chat lives with step 4. Switching steps preserves each
  // transcript so the user can refine either independently, but the
  // schedule chat doesn't carry over allocation-level pollination notes
  // (those are already shown on the Review step).
  allocationChatMessages = $state<ChatMsg[]>([]);
  scheduleChatMessages = $state<ChatMsg[]>([]);
  chatDraft = $state('');
  chatBusy = $state(false);
  chatError = $state<string | null>(null);
  chatLogEl = $state<HTMLDivElement | null>(null);

  commitProgress = $state<{ done: number; total: number; failed: string[] }>({
    done: 0,
    total: 0,
    failed: []
  });

  scheduleResponse = $state<ScheduleResponse | null>(null);

  // Phase 21b / B-28 — inputs plan state held across the inputs →
  // commit transition. `acceptedInputs` is populated by
  // InputsPlanStep.onCommit and consumed by `commit()` so the
  // planting persistence + task materialization happen as one
  // operator-visible action.
  acceptedInputs = $state<{
    applications: InputsPlanApplication[];
    scoutTasks: InputsPlanScoutTask[];
    aiRefined: boolean;
  } | null>(null);
  inputsCommitError = $state<string | null>(null);
  scheduleLoading = $state(false);
  scheduleError = $state<string | null>(null);

  // AI progress heartbeat — see format.ts#aiProgressLabel. The wizard
  // root ticks `nowMs` every 500ms while any start time is set.
  nowMs = $state(Date.now());
  allocateStartMs = $state<number | null>(null);
  scheduleStartMs = $state<number | null>(null);
  chatStartMs = $state<number | null>(null);

  // #173 — Save & resume later. Plumbing for the wizard's third exit
  // gesture. `saveAndResumeLater` snapshots the in-progress step + form
  // state and exits. On re-open, `hydrateDraft` looks up the saved row and
  // restores selectedSeeds + selectedBlockIds + chatDraft so the user
  // lands exactly where they left off.
  draftSaving = $state(false);
  draftSaveError = $state<string | null>(null);
  draftHydrated = $state(false);

  constructor(props: WizardInputs, initial: WizardInitial) {
    this.props = props;
    this.planReset = new PlanResetState(this);
    this.seedLink = new SeedLinkState(this);
    this.activeSetup = initial.seasonSetup;
    this.hasExistingPlan = untrack(() =>
      props.blocks.some((b) => b.plantings && b.plantings.length > 0)
    );
    this.step = (() => {
      if (!this.activeSetup || initial.initialStep === 'season-setup') return 'season-setup';
      if (this.hasExistingPlan) return 'plan-state';
      return 'seeds';
    })();
    // Phase 25d (#89) — hydrate from server-loaded history when present.
    // `system` rows are dropped from the rendered transcripts since the
    // UI only renders user/assistant bubbles; they may be reintroduced
    // later if we add tool-call traces.
    this.allocationChatMessages = initial.initialChatMessages
      .filter((m) => m.step === 'allocation' && (m.role === 'user' || m.role === 'assistant'))
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    this.scheduleChatMessages = initial.initialChatMessages
      .filter((m) => m.step === 'schedule' && (m.role === 'user' || m.role === 'assistant'))
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  }

  readonly chatMessages = $derived(
    this.step === 'schedule' ? this.scheduleChatMessages : this.allocationChatMessages
  );

  readonly eligibleStock = $derived.by(() =>
    this.props.seedStock.filter((s) => !!s.cropPluginId && s.onHand > 0)
  );

  // #252 / CT-W-007 — surface seeds the operator added without a crop
  // plugin (Manual entry path; or Search/Barcode/Label where the
  // confidence threshold rejected the auto-link). They have on-hand
  // quantity but no plugin link, so the eligibleStock filter rejects
  // them. We don't drop them — we render them in a "Needs crop plugin"
  // section with an inline picker that hits /api/plugins/search-by-name
  // and PATCHes /api/stock/[id] with the chosen pluginId. The seed
  // then migrates to eligibleStock on the next render.
  readonly noPluginStock = $derived.by(() =>
    this.props.seedStock.filter((s) => !s.cropPluginId && s.onHand > 0)
  );

  readonly totalPlantsSelected = $derived(
    [...this.selectedSeeds.entries()]
      .filter(([, qty]) => qty > 0)
      .reduce((sum, [stockItemId, quantity]) => {
        return sum + (this.plantsFor(stockItemId, quantity) ?? 0);
      }, 0)
  );

  /** Allow the user to click a prior (done) step to jump back. Future steps
   *  stay locked — the wizard's forward gates haven't been satisfied yet. */
  canJumpToStep(stepId: string) {
    const currentIdx = STEP_ORDER.indexOf(this.step === 'plan-state' ? 'seeds' : this.step);
    const targetIdx = STEP_ORDER.indexOf(stepId as Step);
    if (targetIdx < 0 || targetIdx >= currentIdx) return;
    this.step = stepId as Step;
  }

  handleSeasonSetupSaved(saved: SeasonSetup) {
    this.activeSetup = saved;
    this.step = this.hasExistingPlan ? 'plan-state' : 'seeds';
  }

  /** Translate a raw validator violation string into operator-friendly
   *  text. Replaces UUIDs with block/variety names from props and
   *  rewrites the known "family density" pattern into plain English.
   *  Anything we don't recognize falls through to UUID-replacement only —
   *  the operator still gets readable names even when the rule wording
   *  stays technical. */
  humanizeAllocationViolation(v: string): string {
    return humanizeViolation(v, this.props.blocks, this.props.seedStock);
  }

  /** Phase 25d (#89) — fire-and-forget append to /api/wizard/chat. The
   *  in-memory transcript stays authoritative for rendering; this just
   *  mirrors writes so reload restores them. Failures are logged but
   *  never break the chat UX. `wizardPlanId` not set → disabled. */
  async persistChatMessage(
    chatStep: 'allocation' | 'schedule' | 'inputs',
    role: 'user' | 'assistant',
    content: string
  ): Promise<void> {
    const wizardPlanId = this.props.wizardPlanId;
    if (!wizardPlanId) return;
    try {
      await fetch('/api/wizard/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planId: wizardPlanId, step: chatStep, role, content })
      });
    } catch (err) {
      console.warn('[wizard-chat] persist failed', err);
    }
  }

  seedChatFromAdvisories(r: AllocationResponse) {
    this.#allocate.seedChatFromAdvisories(r);
  }

  pluginShapeFor(stockItemId: string): SeedPluginShape | undefined {
    const entry = this.props.seedStock.find((s) => s.stockItemId === stockItemId);
    if (!entry?.cropPluginId) return undefined;
    return {
      cropFamily: entry.cropFamily ?? undefined,
      plantingGuide: this.props.plantingGuides[entry.cropPluginId]
    };
  }

  plantsFor(stockItemId: string, quantity: number): number | null {
    const entry = this.props.seedStock.find((s) => s.stockItemId === stockItemId);
    if (!entry) return null;
    const result = seedsToPlants({
      unit: entry.defaultUnit,
      quantity,
      plugin: this.pluginShapeFor(stockItemId)
    });
    return result?.plants ?? null;
  }

  selectAllInFamily(items: ReadonlyArray<SeedStockEntry>) {
    for (const s of items) {
      if (!this.selectedSeeds.has(s.stockItemId)) this.selectedSeeds.set(s.stockItemId, s.onHand);
    }
    this.selectedSeeds = new Map(this.selectedSeeds);
  }

  clearFamily(items: ReadonlyArray<SeedStockEntry>) {
    for (const s of items) this.selectedSeeds.delete(s.stockItemId);
    this.selectedSeeds = new Map(this.selectedSeeds);
  }

  familySelectedCount(items: ReadonlyArray<SeedStockEntry>): number {
    let n = 0;
    for (const s of items) if (this.selectedSeeds.has(s.stockItemId)) n++;
    return n;
  }

  toggleSeed(s: SeedStockEntry) {
    if (this.selectedSeeds.has(s.stockItemId)) {
      this.selectedSeeds.delete(s.stockItemId);
    } else {
      this.selectedSeeds.set(s.stockItemId, s.onHand);
    }
    this.selectedSeeds = new Map(this.selectedSeeds);
  }

  setSeedQuantity(stockItemId: string, quantity: number) {
    const entry = this.props.seedStock.find((s) => s.stockItemId === stockItemId);
    if (!entry) return;
    const clamped = Math.max(0, Math.min(entry.onHand, quantity));
    this.selectedSeeds.set(stockItemId, clamped);
    this.selectedSeeds = new Map(this.selectedSeeds);
  }

  toggleBlock(id: string) {
    if (this.selectedBlockIds.has(id)) this.selectedBlockIds.delete(id);
    else this.selectedBlockIds.add(id);
    this.selectedBlockIds = new Set(this.selectedBlockIds);
  }

  selectAllBlocks() {
    this.selectedBlockIds = new Set(this.props.blocks.map((b) => b.id));
  }

  generatePlan() {
    return this.#allocate.generatePlan();
  }

  sendChat() {
    return this.#chat.sendChat();
  }

  sendAllocationChat(text: string) {
    return this.#chat.sendAllocationChat(text);
  }

  applyRejectedAnyway() {
    this.#chat.applyRejectedAnyway();
  }

  sendScheduleChat(text: string) {
    return this.#schedule.sendScheduleChat(text);
  }

  queueScrollChat() {
    requestAnimationFrame(() => {
      if (this.chatLogEl) this.chatLogEl.scrollTop = this.chatLogEl.scrollHeight;
    });
  }

  advanceToSchedule() {
    return this.#schedule.advanceToSchedule();
  }

  advanceToInputs() {
    this.#schedule.advanceToInputs();
  }

  provisionalPlantings(): InputsPlanProvisionalPlanting[] {
    return this.#schedule.provisionalPlantings();
  }

  async handleInputsAccepted(accepted: {
    applications: InputsPlanApplication[];
    scoutTasks: InputsPlanScoutTask[];
    aiRefined: boolean;
  }) {
    this.acceptedInputs = accepted;
    await this.commit();
  }

  async commit() {
    const response = this.response;
    if (!response) return;
    this.step = 'commit';
    this.error = null;

    // Phase B5 — if the scheduler ran, commit one dated row per scheduled
    // planting (successions are already split). Otherwise (no scheduler) fall
    // back to the pre-B5 path that commits one undated row per assignment.
    if (this.scheduleResponse && this.scheduleResponse.scheduled.length > 0) {
      await this.commitScheduled(this.scheduleResponse.scheduled);
      return;
    }

    this.commitProgress = {
      done: 0,
      total: response.assignments.length,
      failed: []
    };
    const quantities = this.buildCommitQuantities(response.assignments);
    // #212 — every wizard-committed planting carries a provenance flag so
    // PlantingCard's footer reads "AI plan" / "Fallback" instead of the
    // catch-all "Manual entry". Driven by the allocate response's
    // meta.fallback (set by aiTry on no-key / over-cap / quota-exceeded /
    // engine-only AI validation failures).
    const planProvenance: 'ai' | 'fallback' = response.meta.fallback ? 'fallback' : 'ai';
    for (const a of response.assignments) {
      const seedEntry = this.props.seedStock.find((s) => s.stockItemId === a.stockItemId);
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
            stockItemId: a.stockItemId,
            sourceProvenance: planProvenance
          })
        });
        if (!res.ok) {
          this.commitProgress.failed.push(
            `${a.varietyDisplayName} → ${this.blockNameFor(a.blockId)}`
          );
        }
      } catch {
        this.commitProgress.failed.push(
          `${a.varietyDisplayName} → ${this.blockNameFor(a.blockId)}`
        );
      }
      this.commitProgress = { ...this.commitProgress, done: this.commitProgress.done + 1 };
    }
    if (this.commitProgress.failed.length === 0) {
      await this.commitAcceptedInputs();
      await this.discardDraft();
      this.props.onCommitted();
    }
  }

  /** Phase B5 — dated commit. Walks the scheduler's `scheduled[]` and posts
   *  one planting per dated row, including succession entries. Seed quantity
   *  per row = (plants_i / total_plants_per_stock) × operator's original
   *  selectedSeeds quantity so stock decrement matches what was actually
   *  consumed. */
  async commitScheduled(plantings: ScheduledPlanting[]) {
    this.commitProgress = {
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
      const seedEntry = this.props.seedStock.find((s) => s.stockItemId === p.stockItemId);
      const unit = seedEntry?.defaultUnit ?? 'seeds';
      const selectedQty = this.selectedSeeds.get(p.stockItemId) ?? 0;
      const totalPlants = totalPlantsByStock.get(p.stockItemId) ?? 0;
      const seedQty = totalPlants > 0 ? (p.plants / totalPlants) * selectedQty : 0;
      const isInteger = unit === 'seeds' || unit === 'count' || unit === 'packets';
      const quantityForCommit = isInteger
        ? Math.max(0, Math.round(seedQty))
        : Number(seedQty.toFixed(3));
      // #212 — provenance flag derived from BOTH the allocator AND the
      // scheduler: if either fell back to deterministic, the planting
      // carries 'fallback'; otherwise 'ai'. Mirrors the per-row chip on
      // the review + schedule steps.
      const planProvenance: 'ai' | 'fallback' =
        this.response?.meta.fallback || this.scheduleResponse?.meta.fallback ? 'fallback' : 'ai';
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
            plantingDate: p.plantingDateMs,
            sourceProvenance: planProvenance
          })
        });
        if (!res.ok) {
          this.commitProgress.failed.push(
            `${p.varietyDisplayName} → ${this.blockNameFor(p.blockId)} (${fmtDateMs(p.plantingDateMs)})`
          );
        }
      } catch {
        this.commitProgress.failed.push(
          `${p.varietyDisplayName} → ${this.blockNameFor(p.blockId)} (${fmtDateMs(p.plantingDateMs)})`
        );
      }
      this.commitProgress = { ...this.commitProgress, done: this.commitProgress.done + 1 };
    }
    if (this.commitProgress.failed.length === 0) {
      await this.commitAcceptedInputs();
      await this.discardDraft();
      this.props.onCommitted();
    }
  }

  /** POST the operator-accepted Inputs Plan rows as tasks (Phase 21 /
   *  B-28). Runs after plantings persist so the commit endpoint can
   *  resolve cropId via the (blockId, cropPluginId) lookup. A failure
   *  here doesn't block the planting commit — the operator can rerun
   *  the wizard or build tasks manually. */
  async commitAcceptedInputs(): Promise<void> {
    const acceptedInputs = this.acceptedInputs;
    if (!acceptedInputs) return;
    if (acceptedInputs.applications.length === 0 && acceptedInputs.scoutTasks.length === 0) {
      return;
    }
    try {
      const res = await fetch('/api/plan/inputs/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          applications: acceptedInputs.applications,
          scoutTasks: acceptedInputs.scoutTasks,
          aiRefined: acceptedInputs.aiRefined
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        this.inputsCommitError = body.error ?? `HTTP ${res.status}`;
      }
    } catch (e) {
      this.inputsCommitError = e instanceof Error ? e.message : String(e);
    }
  }

  /** Apportion the user's original seed quantity (selectedSeeds) across the
   *  AI's per-block plant assignments. Stock decrement runs against this
   *  number, so the seed quantity actually planted is what gets debited —
   *  not the post-germination plant count. Integer-required units (`seeds`,
   *  `count`, `packets`) use largest-remainder rounding so the per-assignment
   *  values sum back to the user's original quantity. */
  buildCommitQuantities(assignments: AllocationResponse['assignments']): Map<string, number> {
    const out = new Map<string, number>();
    const byStock = new Map<string, AllocationResponse['assignments']>();
    for (const a of assignments) {
      const list = byStock.get(a.stockItemId) ?? [];
      list.push(a);
      byStock.set(a.stockItemId, list);
    }
    for (const [stockItemId, items] of byStock) {
      const entry = this.props.seedStock.find((s) => s.stockItemId === stockItemId);
      if (!entry) continue;
      const selectedQty = this.selectedSeeds.get(stockItemId) ?? 0;
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
      const used = rounded.reduce((s, x) => s + x.floor, 0);
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

  blockNameFor(blockId: string): string {
    return this.props.blocks.find((b) => b.id === blockId)?.name ?? blockId;
  }

  varietyDisplayFor(stockItemId: string): string {
    const entry = this.props.seedStock.find((s) => s.stockItemId === stockItemId);
    return entry?.shortName ?? entry?.displayName ?? stockItemId;
  }

  async saveAndResumeLater(): Promise<void> {
    this.draftSaving = true;
    this.draftSaveError = null;
    try {
      const res = await fetch('/api/plan/wizard/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          step: this.step,
          payload: {
            step: this.step,
            selectedSeeds: [...this.selectedSeeds.entries()],
            selectedBlockIds: [...this.selectedBlockIds],
            chatDraft: this.chatDraft
          }
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        this.draftSaveError = body.error ?? `HTTP ${res.status}`;
        return;
      }
      this.props.onClose();
    } catch (e) {
      this.draftSaveError = e instanceof Error ? e.message : String(e);
    } finally {
      this.draftSaving = false;
    }
  }

  async discardDraft(): Promise<void> {
    try {
      await fetch('/api/plan/wizard/draft', { method: 'DELETE' });
    } catch {
      // non-fatal — the row will get overwritten on the next save or
      // cleared when the wizard commits.
    }
  }

  hydrateDraft(): void {
    if (this.draftHydrated) return;
    this.draftHydrated = true;
    (async () => {
      try {
        const res = await fetch('/api/plan/wizard/draft');
        if (!res.ok) return;
        const body = (await res.json()) as {
          draft: {
            step: string;
            payload: {
              selectedSeeds: Array<[string, number]>;
              selectedBlockIds: string[];
              chatDraft: string;
            };
          } | null;
        };
        if (!body.draft) return;
        if (body.draft.payload.selectedSeeds.length > 0) {
          this.selectedSeeds = new Map(body.draft.payload.selectedSeeds);
        }
        if (body.draft.payload.selectedBlockIds.length > 0) {
          this.selectedBlockIds = new Set(body.draft.payload.selectedBlockIds);
        }
        if (body.draft.payload.chatDraft) {
          this.chatDraft = body.draft.payload.chatDraft;
        }
        if ((VALID_STEPS as string[]).includes(body.draft.step)) {
          this.step = body.draft.step as Step;
        }
      } catch {
        // Resume is best-effort — keep the wizard usable even if the
        // draft fetch fails.
      }
    })();
  }
}

const CONTEXT_KEY = Symbol('allocation-wizard');

export function setWizardContext(w: AllocationWizardState): AllocationWizardState {
  return setContext(CONTEXT_KEY, w);
}

export function getWizardContext(): AllocationWizardState {
  const w = getContext<AllocationWizardState | undefined>(CONTEXT_KEY);
  if (!w) throw new Error('AllocationWizard step rendered outside the wizard');
  return w;
}
