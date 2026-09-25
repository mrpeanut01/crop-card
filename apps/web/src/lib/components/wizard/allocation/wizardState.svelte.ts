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
    const blockNames = new Map<string, string>();
    for (const b of this.props.blocks) blockNames.set(b.id, b.name);
    const seedNames = new Map<string, string>();
    for (const s of this.props.seedStock) {
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

    // Seed message is NOT persisted — it's deterministic from the
    // current advisories. On resume from a server-hydrated transcript,
    // we skip re-seeding entirely so the prior conversation renders
    // intact. Persisting the seed would double-seed on the second
    // wizard open; replacing the transcript with the seed would erase
    // the resumed chat. Keeping in-memory only is the right balance.
    if (this.allocationChatMessages.length === 0) {
      this.allocationChatMessages = [
        { role: 'assistant', content: lines.join('\n'), kind: 'seed' }
      ];
    }
    this.chatDraft = '';
    this.chatError = null;
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

  async generatePlan() {
    this.loading = true;
    this.error = null;
    this.response = null;
    this.allocateStartMs = Date.now();
    this.nowMs = Date.now();
    // Advance to the Review step immediately so the operator sees the
    // staged AI-progress indicator (label + spinner + elapsed time) from
    // second 0, instead of staring at "Generating…" on the Blocks-step
    // button for a minute.
    this.step = 'review';
    try {
      const seedSelections = [...this.selectedSeeds.entries()]
        .filter(([, qty]) => qty > 0)
        .map(([stockItemId, quantity]) => {
          const entry = this.props.seedStock.find((s) => s.stockItemId === stockItemId)!;
          const plants = this.plantsFor(stockItemId, quantity);
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
          blockIds: [...this.selectedBlockIds]
        })
      });
      const body = (await res.json()) as AllocationResponse | { error: string };
      if (!res.ok) {
        this.error = 'error' in body ? body.error : `HTTP ${res.status}`;
        return;
      }
      this.response = body as AllocationResponse;
      this.seedChatFromAdvisories(this.response);
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'request failed';
    } finally {
      this.loading = false;
      this.allocateStartMs = null;
    }
  }

  async sendChat() {
    const text = this.chatDraft.trim();
    if (!text || this.chatBusy || !this.response) return;
    this.chatError = null;
    const userTurn: ChatMsg = { role: 'user', content: text };
    // Append to the active step's transcript optimistically.
    const chatStepKey: 'allocation' | 'schedule' =
      this.step === 'schedule' ? 'schedule' : 'allocation';
    if (chatStepKey === 'schedule') {
      this.scheduleChatMessages = [...this.scheduleChatMessages, userTurn];
    } else {
      this.allocationChatMessages = [...this.allocationChatMessages, userTurn];
    }
    // Phase 25d (#89) — fire-and-forget server persist; doesn't block UI.
    void this.persistChatMessage(chatStepKey, 'user', text);
    this.chatDraft = '';
    this.chatBusy = true;
    this.chatStartMs = Date.now();
    this.nowMs = Date.now();
    this.queueScrollChat();
    try {
      // Chat routes through schedule-refinement when in step 4, otherwise
      // allocator-refinement. Each path mutates its own transcript.
      if (this.step === 'schedule' && this.scheduleResponse) {
        await this.sendScheduleChat(text);
      } else {
        await this.sendAllocationChat(text);
      }
      this.queueScrollChat();
    } catch (err) {
      this.chatError = err instanceof Error ? err.message : 'chat request failed';
      // Roll back the optimistic user message on hard error.
      if (this.step === 'schedule') {
        this.scheduleChatMessages = this.scheduleChatMessages.slice(0, -1);
      } else {
        this.allocationChatMessages = this.allocationChatMessages.slice(0, -1);
      }
      this.chatDraft = text;
    } finally {
      this.chatBusy = false;
      this.chatStartMs = null;
    }
  }

  async sendAllocationChat(text: string) {
    const response = this.response;
    if (!response) return;
    const seedSelections = [...this.selectedSeeds.entries()]
      .filter(([, qty]) => qty > 0)
      .map(([stockItemId, quantity]) => {
        const entry = this.props.seedStock.find((s) => s.stockItemId === stockItemId)!;
        const plants = this.plantsFor(stockItemId, quantity);
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
        rationale: response.perRowRationale[`${a.stockItemId}:${a.blockId}`] ?? ''
      })),
      rationale: response.rationale,
      advisories: response.advisories
    };
    const sendable = this.allocationChatMessages
      .filter((m) => m.kind !== 'seed')
      .map((m) => ({ role: m.role, content: m.content }));
    const res = await fetch('/api/plan/allocate/refine', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        seedSelections,
        blockIds: [...this.selectedBlockIds],
        previousPlan,
        transcript: sendable
      })
    });
    const body = await res.json();
    if (!res.ok) {
      this.chatError = body?.error ?? `HTTP ${res.status}`;
      this.allocationChatMessages = this.allocationChatMessages.slice(0, -1);
      this.chatDraft = text;
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
    const violations = rawViolations.map((v) => this.humanizeAllocationViolation(v));
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
        this.lastRejectedAssignments = body.meta.rejectedAssignments;
        this.lastRejectedRationale =
          typeof body.meta.rejectedRationale === 'string' ? body.meta.rejectedRationale : '';
        this.lastRejectedViolations = violations;
      } else {
        this.lastRejectedAssignments = null;
        this.lastRejectedRationale = '';
        this.lastRejectedViolations = [];
      }
    } else {
      // Successful refine — clear any stale rejected proposal.
      this.lastRejectedAssignments = null;
      this.lastRejectedRationale = '';
      this.lastRejectedViolations = [];
    }
    this.allocationChatMessages = [
      ...this.allocationChatMessages,
      { role: 'assistant', content: reply }
    ];
    void this.persistChatMessage('allocation', 'assistant', reply);
    this.response = {
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
  applyRejectedAnyway() {
    if (!this.response || !this.lastRejectedAssignments) return;
    const overridden = [...this.lastRejectedAssignments];
    this.response = {
      ...this.response,
      assignments: overridden,
      rationale: this.lastRejectedRationale || this.response.rationale,
      // Per-row rationale is cleared — the detailed per-pair text lived
      // only in the rejected proposal before validation stripped it.
      perRowRationale: {},
      // Unplaced + sufficiency are recomputed by the next refine; until
      // then, clear them so the operator doesn't read stale numbers.
      unplaced: [],
      sufficiency: {}
    };
    this.allocationChatMessages = [
      ...this.allocationChatMessages,
      {
        role: 'assistant',
        content:
          '✅ Applied the AI plan over the validator. The grid above shows the new layout. ' +
          'Density / capacity checks were overridden — review the plant counts before committing.'
      }
    ];
    this.lastRejectedAssignments = null;
    this.lastRejectedRationale = '';
    this.lastRejectedViolations = [];
  }

  async sendScheduleChat(text: string) {
    const response = this.response;
    const scheduleResponse = this.scheduleResponse;
    if (!response || !scheduleResponse) return;
    const sendable = this.scheduleChatMessages
      .filter((m) => m.kind !== 'seed')
      .map((m) => ({ role: m.role, content: m.content }));
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
      this.chatError = body?.error ?? `HTTP ${res.status}`;
      this.scheduleChatMessages = this.scheduleChatMessages.slice(0, -1);
      this.chatDraft = text;
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
          : fallback === 'ai-unavailable'
            ? '⚠ Claude is unavailable — the schedule above is unchanged.'
            : '⚠ Could not apply the change — it would break a planting window, stagger, or companion offset. The schedule above is unchanged.';
      const violationLine =
        violations.length > 0 ? `\n\nValidator violations:\n• ${violations.join('\n• ')}` : '';
      reply = `${header}${violationLine}\n\n${aiReply}`;
    }
    this.scheduleChatMessages = [
      ...this.scheduleChatMessages,
      { role: 'assistant', content: reply }
    ];
    void this.persistChatMessage('schedule', 'assistant', reply);
    this.scheduleResponse = {
      scheduled: Array.isArray(body.scheduled) ? body.scheduled : scheduleResponse.scheduled,
      rationale: typeof body.rationale === 'string' ? body.rationale : scheduleResponse.rationale,
      advisories: Array.isArray(body.advisories) ? body.advisories : scheduleResponse.advisories,
      meta: body.meta ?? scheduleResponse.meta
    };
  }

  queueScrollChat() {
    requestAnimationFrame(() => {
      if (this.chatLogEl) this.chatLogEl.scrollTop = this.chatLogEl.scrollHeight;
    });
  }

  /** Phase B1 — "Accept all" no longer commits. It locks the spatial
   *  allocation in place and advances to the Schedule step, where the
   *  scheduler proposes planting dates (Phase B3+) before the operator
   *  commits crops to the DB. The same chat panel continues in step 4. */
  async advanceToSchedule() {
    const response = this.response;
    if (!response) return;
    this.step = 'schedule';
    this.scheduleResponse = null;
    this.scheduleError = null;
    this.scheduleLoading = true;
    this.scheduleStartMs = Date.now();
    this.nowMs = Date.now();
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
        this.scheduleError = 'error' in body ? body.error : `HTTP ${res.status}`;
        return;
      }
      const scheduleResponse = body as ScheduleResponse;
      this.scheduleResponse = scheduleResponse;
      const lines: string[] = [];
      const fb = scheduleResponse.meta.fallback;
      if (fb === 'no-api-key' || fb === 'ai-unavailable') {
        lines.push(
          fb === 'no-api-key'
            ? '🛟 I picked dates with the deterministic scheduler (no Anthropic API key configured). Staggers and companion offsets are honored.'
            : '🛟 I picked dates with the deterministic scheduler (Claude is unavailable right now). Staggers and companion offsets are honored.'
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
      // Phase 25d (#89) — preserve resumed turns; only insert the seed
      // when starting fresh.
      if (this.scheduleChatMessages.length === 0) {
        this.scheduleChatMessages = [
          { role: 'assistant', content: lines.join('\n'), kind: 'seed' }
        ];
      }
      this.queueScrollChat();
    } catch (e) {
      this.scheduleError = e instanceof Error ? e.message : 'schedule request failed';
    } finally {
      this.scheduleLoading = false;
      this.scheduleStartMs = null;
    }
  }

  /** Phase 21b / B-28 — between Schedule and Commit. Advances to the
   *  Inputs Plan step where the deterministic planner proposes per-
   *  planting product applications + IPM scout cadences against the
   *  current season setup. The accept handler stashes the operator's
   *  chosen subset and then calls `commit()` so plantings + tasks
   *  persist as one action. */
  advanceToInputs() {
    if (!this.response || !this.scheduleResponse) return;
    this.step = 'inputs';
    this.acceptedInputs = null;
    this.inputsCommitError = null;
  }

  /** Provisional plantings (in-memory shape) handed to the Inputs Plan
   *  step. The planner uses these as the basis for per-block work; the
   *  underlying `crops` rows don't exist yet — they get persisted when
   *  the operator clicks "Accept and commit" inside the step. */
  provisionalPlantings(): InputsPlanProvisionalPlanting[] {
    if (!this.scheduleResponse) return [];
    return this.scheduleResponse.scheduled.map((s, i) => ({
      id: `${s.stockItemId}:${s.blockId}:${i}`,
      blockId: s.blockId,
      cropPluginId: s.cropPluginId,
      varietyDisplayName: s.varietyDisplayName,
      plantingDate: s.plantingDateMs
    }));
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
