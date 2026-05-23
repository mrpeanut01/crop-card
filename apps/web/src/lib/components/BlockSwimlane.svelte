<!--
  BlockSwimlane.svelte (Phase 14)
  ─────────────────────────────────
  Vertical swim-lane: one column per block (sticky header), time flowing
  down. Bars start at plantingDate and extend for DTM(max) + PHI buffer.
  Shade markers overlay neighbor columns. Conflict outlines wrap bars.

  Drag state is managed in the parent — passed in via `dragPayload`.
  We just render and emit drop intents up via `onDrop`.

  Year selector filters by intersection — bars that cross year boundaries
  render continuously with the off-year half rendered at lower opacity.
-->
<script lang="ts">
  import type { ShadeImpactEvent } from '$lib/calendar/engine';
  import type { RotationConflict, SameTimeOverlap } from '$lib/calendar/rotation';
  import {
    applyBlockOrder,
    loadBlockOrder,
    reorderOnDrop,
    saveBlockOrder
  } from '$lib/client/blockOrder';

  export interface SwimBlock {
    id: string;
    name: string;
    blockLabel?: string | null;
    acres?: number | null;
    eastWestIndex: number | null;
    northSouthIndex: number | null;
    sunExposure: 'full' | 'partial' | 'shade' | null;
  }

  export interface SwimPlanting {
    cropId: string;
    blockId: string;
    cropPluginId: string;
    varietyDisplayName: string;
    /** Phase 15d — Haiku-generated short label; falls back to varietyDisplayName. */
    shortName?: string;
    cropFamily: string;
    plantingDateMs: number;
    endMs: number;
    shadeCasting: boolean;
    matureHeightFt?: number;
    /** Phase 15 — group membership (optional). */
    groupId?: string;
    groupRole?: 'anchor' | 'companion';
    groupSystemKind?: 'three-sisters' | 'succession' | 'manual';
    /** v1.3 — growth-stage projection (Phase 14 §growth-stages). */
    stageSystem?: 'vr-corn' | 'r-soybean' | 'zadoks' | 'bbch' | 'simple' | 'perennial-calendar';
    currentStage?: {
      code: string;
      name: string;
      bodyKind?: 'vegetative' | 'reproductive' | 'ripening' | 'dormant' | 'transition';
      inspect?: string;
      daysIntoStage: number;
    };
    nextStage?: { code: string; name: string; daysToStart: number };
    harvestTargets?: Array<{
      stageCode: string;
      label: string;
      useCase?: string;
      startMs: number;
      endMs: number;
    }>;
    cornType?: 'sweet' | 'popcorn' | 'dent' | 'flour' | 'flint' | 'dual-purpose';
  }

  /** Phase 15 — materialized task pip drawn alongside its source crop bar. */
  export interface SwimTaskPip {
    cropId: string;
    scheduledForMs: number;
    /** Render glyph + color by category. */
    category: 'plant' | 'till' | 'fertilize' | 'spray' | 'scout' | 'companion-check' | 'other';
    title: string;
    /** Used for staleAnchor/userOverridden visual hints. */
    stale?: boolean;
  }

  export type DropPayload =
    | { kind: 'palette'; pluginId: string; cropFamily: string }
    | { kind: 'move'; cropId: string; sourceBlockId: string };

  interface Props {
    blocks: SwimBlock[];
    plantings: SwimPlanting[];
    shadeMarkers: ShadeImpactEvent[];
    overlaps: SameTimeOverlap[];
    rotations: RotationConflict[];
    year: number;
    /** Parent-managed drag state. Null = nothing being dragged. */
    dragPayload: DropPayload | null;
    /** Parent-managed keyboard carry. Null when no card is held. */
    kbCarry: DropPayload | null;
    /** Phase 15 — task pips to overlay on bars (till, fert, spray, etc.). */
    taskPips?: SwimTaskPip[];
    /** Called with the day cell's ms (UTC midnight) and the dragged payload. */
    onDrop: (blockId: string, dayMs: number, payload: DropPayload) => void;
    /** Called when keyboard carry commits to a (block, day) cell. */
    onKbCommit: (blockId: string, dayMs: number, payload: DropPayload) => void;
    /** Called when keyboard carry is cancelled (Esc). */
    onKbCancel: () => void;
    /** Phase 15 — invoked when a group bracket is clicked (opens inspector). */
    onGroupOpen?: (groupId: string) => void;
    /** Phase 15c — bar started a drag (for moving an existing planting). */
    onBarDragStart?: (cropId: string, sourceBlockId: string) => void;
    /** Phase 15c — bar drag ended (drop or abandoned). Parent clears state. */
    onBarDragEnd?: () => void;
    /** Phase 15d — selection state is parent-owned so the schedule header
     *  card can render the action row inline. Swim-lane reads the set to
     *  paint `selected` on bars and emits toggle events. */
    selectedCropIds?: Set<string>;
    onToggleSelect?: (cropId: string, additive: boolean) => void;
    /** Optional snap helper. When provided, the swim-lane runs the
     *  drag-over candidate day through this fn before drawing the
     *  drop-preview line so the line reflects the date the drop will
     *  actually persist (e.g. clamped forward past the last-spring-frost
     *  boundary). Without it the line shows the raw cursor day. */
    snapDate?: (dayMs: number, payload: DropPayload) => number;
  }

  const props: Props = $props();

  const DAY_MS = 86_400_000;
  const ROW_H = 6; // px per day at default zoom
  /** Minimum width of one sub-lane within a block column. Block columns
   *  split into N sub-lanes when N plantings overlap on the same block in
   *  time. The actual rendered width is computed via flex-grow so columns
   *  expand to fill the swim-lane's horizontal space; this floor ensures
   *  bars stay readable when many lanes compete and triggers horizontal
   *  scroll when the swim-lane is narrower than the cumulative minimum. */
  const MIN_LANE_W = 110;
  const LANE_GAP_PX = 4;

  const yearStart = $derived(new Date(props.year, 0, 1).getTime());
  const yearEnd = $derived(new Date(props.year + 1, 0, 1).getTime());
  const visibleStart = $derived.by(() => {
    const candidates = props.plantings
      .filter((p) => p.endMs >= yearStart)
      .map((p) => p.plantingDateMs);
    return candidates.length === 0 ? yearStart : Math.min(yearStart, ...candidates);
  });
  const visibleEnd = $derived.by(() => {
    const candidates: number[] = [];
    for (const p of props.plantings) {
      if (p.plantingDateMs > yearEnd) continue;
      candidates.push(p.endMs);
      // v1.3 — harvest target windows can extend past the bar's endMs (e.g.,
      // dual-purpose corn whose R6 target lands ~30d past DTM-derived end).
      if (p.harvestTargets) {
        for (const t of p.harvestTargets) candidates.push(t.endMs);
      }
    }
    return candidates.length === 0 ? yearEnd : Math.max(yearEnd, ...candidates);
  });
  const totalDays = $derived(Math.max(60, Math.ceil((visibleEnd - visibleStart) / DAY_MS)));

  /** Days from `visibleStart` back to the Monday at-or-before it. Used as a
   *  CSS offset so the week-banded background aligns to Monday boundaries
   *  even when the visible range starts mid-week. 0..6. */
  const firstMondayOffsetDays = $derived.by(() => {
    const d = new Date(visibleStart);
    const dow = d.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    return (dow + 6) % 7;
  });

  function dayOffset(ms: number): number {
    return Math.max(0, (ms - visibleStart) / DAY_MS);
  }

  // ─── Column reorder (Phase 14b) ─────────────────────────────────────────
  // Persistence is shared with the Crops page via $lib/client/blockOrder so
  // top-to-bottom on Crops always matches left-to-right here.
  let customOrder = $state<string[] | null>(null);
  let reorderDragId = $state<string | null>(null);
  let reorderOverId = $state<string | null>(null);

  $effect(() => {
    customOrder = loadBlockOrder();
  });

  const orderedBlocks = $derived(applyBlockOrder(props.blocks, customOrder));

  /** Phase 15c — interval-graph coloring per block: assign each planting to
   *  the lowest-numbered sub-lane whose last bar already ended. Same-block
   *  plantings that overlap in time get different lanes so they sit side-by-
   *  side instead of stacking on top of each other. */
  const laneAssignments = $derived.by(() => {
    const cropLane = new Map<string, number>();
    const lanesPerBlock = new Map<string, number>();
    for (const block of orderedBlocks) {
      const onBlock = props.plantings
        .filter((p) => p.blockId === block.id)
        .slice()
        .sort((a, b) => a.plantingDateMs - b.plantingDateMs);
      const laneEnds: number[] = [];
      for (const p of onBlock) {
        let lane = laneEnds.findIndex((end) => end <= p.plantingDateMs);
        if (lane === -1) {
          lane = laneEnds.length;
          laneEnds.push(p.endMs);
        } else {
          laneEnds[lane] = p.endMs;
        }
        cropLane.set(p.cropId, lane);
      }
      lanesPerBlock.set(block.id, Math.max(1, laneEnds.length));
    }
    return { cropLane, lanesPerBlock };
  });

  /** Inline flex spec for a block's header + column. `flex-grow = lanes`
   *  so a 2-lane block grows twice as fast as a 1-lane block. `flex-basis`
   *  is the per-block minimum so bars stay readable. */
  function colFlexFor(blockId: string): string {
    const lanes = laneAssignments.lanesPerBlock.get(blockId) ?? 1;
    return `${lanes} 1 ${lanes * MIN_LANE_W}px`;
  }
  function laneIndexFor(cropId: string): number {
    return laneAssignments.cropLane.get(cropId) ?? 0;
  }

  function onHeaderDragStart(ev: DragEvent, blockId: string) {
    reorderDragId = blockId;
    if (ev.dataTransfer) {
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('application/x-cropcard-block-id', blockId);
      ev.dataTransfer.setData('text/plain', blockId);
    }
  }
  function onHeaderDragOver(ev: DragEvent, blockId: string) {
    if (!reorderDragId) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    reorderOverId = blockId;
  }
  function onHeaderDragLeave(blockId: string) {
    if (reorderOverId === blockId) reorderOverId = null;
  }
  function onHeaderDrop(ev: DragEvent, targetId: string) {
    if (!reorderDragId) return;
    ev.preventDefault();
    const sourceId = reorderDragId;
    reorderDragId = null;
    reorderOverId = null;
    const next = reorderOnDrop(
      orderedBlocks.map((b) => b.id),
      sourceId,
      targetId
    );
    if (!next) return;
    customOrder = next;
    saveBlockOrder(next);
  }
  function onHeaderDragEnd() {
    reorderDragId = null;
    reorderOverId = null;
  }

  function familyColor(family: string): string {
    const palette: Record<string, string> = {
      corn: '#facc15',
      brassica: '#22c55e',
      cucurbit: '#fb923c',
      legume: '#84cc16',
      allium: '#a855f7',
      solanaceae: '#ef4444',
      'leafy-green': '#4ade80',
      'small-grain': '#fde047',
      cover: '#a3a3a3',
      hay: '#10b981'
    };
    return palette[family] ?? '#60a5fa';
  }

  type StageBodyKind = 'vegetative' | 'reproductive' | 'ripening' | 'dormant' | 'transition';

  /** Body-kind palette for stage badges. Green = vegetative, yellow =
   *  reproductive (flowering), amber = ripening, gray = dormant, teal = transition. */
  function stageBadgeColors(bodyKind: StageBodyKind | undefined): { bg: string; fg: string } {
    switch (bodyKind) {
      case 'vegetative':
        return { bg: '#16a34a', fg: '#fff' };
      case 'reproductive':
        return { bg: '#eab308', fg: '#1f2937' };
      case 'ripening':
        return { bg: '#d97706', fg: '#fff' };
      case 'dormant':
        return { bg: '#6b7280', fg: '#fff' };
      case 'transition':
        return { bg: '#0891b2', fg: '#fff' };
      default:
        return { bg: '#374151', fg: '#fff' };
    }
  }

  function fmtDateRange(startMs: number, endMs: number): string {
    const fmt = (ms: number) =>
      new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `${fmt(startMs)} – ${fmt(endMs)}`;
  }

  /** Compose the bar's hover tooltip with stage + harvest-target detail. */
  function barTooltip(p: SwimPlanting, lanesCount: number, laneIdx: number): string {
    const head = `${p.varietyDisplayName} • ${new Date(p.plantingDateMs).toLocaleDateString()} → ${new Date(p.endMs).toLocaleDateString()}`;
    const grp = p.groupId ? ` • ${systemLabel(p.groupSystemKind ?? 'manual')}` : '';
    const lane = lanesCount > 1 ? ` • lane ${laneIdx + 1}/${lanesCount}` : '';
    const lines: string[] = [head + grp + lane];
    if (p.cornType) lines.push(`Type: ${p.cornType}`);
    if (p.currentStage) {
      const days = p.currentStage.daysIntoStage;
      lines.push(`Stage: ${p.currentStage.code} — ${p.currentStage.name} (day ${days})`);
      if (p.currentStage.inspect) lines.push(`Inspect: ${p.currentStage.inspect}`);
    }
    if (p.nextStage) {
      lines.push(`Next: ${p.nextStage.code} ${p.nextStage.name} in ${p.nextStage.daysToStart}d`);
    }
    if (p.harvestTargets?.length) {
      for (const t of p.harvestTargets) {
        lines.push(`Harvest target — ${t.label}: ${fmtDateRange(t.startMs, t.endMs)}`);
      }
    }
    lines.push('drag to move, click to select');
    return lines.join('\n');
  }

  function intersectsYear(p: SwimPlanting): boolean {
    return p.endMs >= yearStart && p.plantingDateMs <= yearEnd;
  }

  /** Collapse shade-window events into one band per (target block × source crop ×
   *  time window). The engine emits separate AM and PM events even when both
   *  cover the same target with the same time-range — the operator sees those
   *  as duplicate "extras." Drag-reorder of swim-lane columns also breaks the
   *  AM/PM directional gradient semantics, so the new representation is a
   *  uniform in-column hatch with explicit attribution. */
  interface ShadeBand {
    key: string;
    blockId: string;
    startMs: number;
    endMs: number;
    intensity: number;
    sourceLabel: string;
    /** Time-of-day buckets observed: union of slots across collapsed events.
     *  Rendered as "AM·12·PM" alongside the source name. */
    slotsLabel: string;
    tooltip: string;
  }

  function formatSlots(slots: ReadonlyArray<'am' | 'mid' | 'pm'>): string {
    if (!slots || slots.length === 0) return '';
    const seen = new Set<string>();
    const order: Array<'am' | 'mid' | 'pm'> = ['am', 'mid', 'pm'];
    const labels: string[] = [];
    for (const s of order) {
      if (slots.includes(s) && !seen.has(s)) {
        seen.add(s);
        labels.push(s === 'am' ? 'AM' : s === 'mid' ? '12' : 'PM');
      }
    }
    return labels.join('·');
  }
  /** Crop-id → shortName lookup so shade bands display the same compact label
   *  (e.g., "BB Corn") that the planting bar uses, falling back to full variety. */
  const sourceLabelByCropId = $derived.by(() => {
    const m = new Map<string, string>();
    for (const p of props.plantings) {
      m.set(p.cropId, p.shortName ?? p.varietyDisplayName);
    }
    return m;
  });
  function shadeBandsForBlock(blockId: string): ShadeBand[] {
    const events = props.shadeMarkers.filter((s) => s.blockId === blockId);
    const byKey = new Map<string, ShadeBand>();
    // Per-band accumulator so we can union slot lists across collapsed events.
    const slotAcc = new Map<string, Set<'am' | 'mid' | 'pm'>>();
    for (const e of events) {
      // Sources can be either crops (have shadingCropId) or external shade
      // sources like tree rows (have shadingSourceId). Either is enough to
      // key the bucket and label the band.
      const sourceId = e.detail.shadingCropId ?? e.detail.shadingSourceId ?? 'unknown';
      const cropShortName = e.detail.shadingCropId
        ? sourceLabelByCropId.get(e.detail.shadingCropId)
        : undefined;
      const sourceLabel = cropShortName ?? e.detail.shadingVariety;
      // Bucket by source × time-window so AM+PM from the same source on the
      // same neighbor collapse into a single band.
      const k = `${sourceId}:${e.startMs}:${e.endMs}`;
      const eventSlots: ReadonlyArray<'am' | 'mid' | 'pm'> = e.detail.slots ?? [e.detail.slot];
      let slots = slotAcc.get(k);
      if (!slots) {
        slots = new Set();
        slotAcc.set(k, slots);
      }
      for (const s of eventSlots) slots.add(s);
      const existing = byKey.get(k);
      if (existing) {
        existing.intensity = Math.max(existing.intensity, e.detail.intensity);
      } else {
        byKey.set(k, {
          key: k,
          blockId,
          startMs: e.startMs,
          endMs: e.endMs,
          intensity: e.detail.intensity,
          sourceLabel,
          slotsLabel: '',
          tooltip: `Shaded by ${e.detail.shadingVariety} from ${new Date(e.startMs).toLocaleDateString()} – ${new Date(e.endMs).toLocaleDateString()}`
        });
      }
    }
    // Finalize slotsLabel from accumulated slot sets.
    for (const [k, band] of byKey) {
      const slots = Array.from(slotAcc.get(k) ?? []);
      band.slotsLabel = formatSlots(slots);
      if (band.slotsLabel) {
        band.tooltip = `${band.tooltip} · sun ${band.slotsLabel}`;
      }
    }
    return Array.from(byKey.values()).sort((a, b) => a.startMs - b.startMs);
  }

  function inActiveYear(p: SwimPlanting): boolean {
    return p.plantingDateMs >= yearStart && p.endMs <= yearEnd;
  }

  /** `dayMs` is the date the bar would actually land on (post-snap).
   *  `tooEarly` fires when the cursor is aimed at a day BEFORE that
   *  — meaning the parent's snap helper clamped the date forward
   *  (typically past last-spring-frost or the crop's soil-temp
   *  minimum). The renderer uses it to paint the line red + tack on
   *  a "Too early" label so the operator understands why the line
   *  isn't tracking their cursor. */
  let dropPreview: { blockId: string; dayMs: number; tooEarly: boolean } | null = $state(null);

  // Phase 15d — on first mount, scroll the swim-lane so the first of the
  // current month sits right below the sticky header. Most planting work
  // happens around "now"; defaulting to Jan 1 makes the operator scroll
  // every time. One-shot per mount via `didInitialScroll` guard.
  let swimRoot = $state<HTMLDivElement | null>(null);
  let didInitialScroll = $state(false);
  $effect(() => {
    if (!swimRoot || didInitialScroll) return;
    const now = new Date();
    const monthStartUtc = Date.UTC(now.getFullYear(), now.getMonth(), 1);
    const monthStartDayIdx = Math.max(0, Math.floor((monthStartUtc - visibleStart) / DAY_MS));
    swimRoot.scrollTop = monthStartDayIdx * ROW_H;
    didInitialScroll = true;
  });

  // Local cursor for keyboard carry — the parent owns kbCarry; we just track
  // where the cursor is positioned within the swim-lane.
  let kbCellBlockId: string | null = $state(null);
  let kbCellDayIdx: number = $state(0);

  $effect(() => {
    if (props.kbCarry && !kbCellBlockId && props.blocks.length > 0) {
      kbCellBlockId = props.blocks[0].id;
      kbCellDayIdx = Math.max(0, Math.floor((Date.now() - visibleStart) / DAY_MS));
    } else if (!props.kbCarry) {
      kbCellBlockId = null;
    }
  });

  function dayMsForCell(dayIdx: number): number {
    return visibleStart + dayIdx * DAY_MS;
  }

  /** Compute Y relative to the column itself, regardless of whether the
   *  drag event bubbled up from a bar or a task pip nested inside it.
   *  `ev.offsetY` is target-relative — when the cursor sits over a bar the
   *  number reflects the bar's local origin, not the column's, which made
   *  the drop preview snap to the wrong day (or vanish). currentTarget +
   *  getBoundingClientRect gives column-relative Y consistently.
   *
   *  When dragging an existing bar (barGrabOffsetY set), subtract the
   *  grab offset so the returned Y reflects where the TOP of the bar
   *  would land. This makes the snap line + final drop point consistent
   *  with the planting-date edge of the bar instead of the cursor. */
  function columnRelativeY(ev: DragEvent): number {
    const col = ev.currentTarget as HTMLElement | null;
    if (!col) return 0;
    const rect = col.getBoundingClientRect();
    const raw = ev.clientY - rect.top;
    return barGrabOffsetY != null ? raw - barGrabOffsetY : raw;
  }

  function onColumnDragOver(ev: DragEvent, blockId: string) {
    if (!props.dragPayload) return;
    ev.preventDefault();
    const dayIdx = Math.max(0, Math.min(totalDays - 1, Math.floor(columnRelativeY(ev) / ROW_H)));
    const rawMs = dayMsForCell(dayIdx);
    // Run through the parent's snap helper (when provided) so the
    // drop-preview line tracks the post-snap date — otherwise the
    // line shows where the cursor is but the drop persists a different
    // date (e.g. clamped forward past last-spring-frost), and the
    // operator sees the bar land "a week after" where they aimed.
    const snappedMs = props.snapDate ? props.snapDate(rawMs, props.dragPayload) : rawMs;
    // tooEarly: cursor aimed at a date before the snap floor. Triggers
    // the red line + "Too early" label so the operator understands why
    // the line doesn't track their cursor — the soil-temp / frost
    // boundary won't let them plant any earlier.
    const tooEarly = snappedMs > rawMs;
    dropPreview = { blockId, dayMs: snappedMs, tooEarly };
  }

  function onColumnDragLeave() {
    dropPreview = null;
  }

  function onColumnDrop(ev: DragEvent, blockId: string) {
    ev.preventDefault();
    if (!props.dragPayload) return;
    const dayIdx = Math.max(0, Math.min(totalDays - 1, Math.floor(columnRelativeY(ev) / ROW_H)));
    const payload = props.dragPayload;
    dropPreview = null;
    // Don't snap here — the parent's drop handler runs its own
    // snapPlantingDate() and is the source of truth for the persisted
    // value. The preview was snapped above only so the operator could
    // SEE where the date would land.
    props.onDrop(blockId, dayMsForCell(dayIdx), payload);
  }

  function onSwimlaneKey(ev: KeyboardEvent) {
    if (!props.kbCarry) return;
    if (ev.key === 'Escape') {
      props.onKbCancel();
      ev.preventDefault();
      return;
    }
    const orderedBlocks = props.blocks;
    const idx = orderedBlocks.findIndex((b) => b.id === kbCellBlockId);
    if (ev.key === 'ArrowLeft' && idx > 0) {
      kbCellBlockId = orderedBlocks[idx - 1].id;
      ev.preventDefault();
    } else if (ev.key === 'ArrowRight' && idx < orderedBlocks.length - 1) {
      kbCellBlockId = orderedBlocks[idx + 1].id;
      ev.preventDefault();
    } else if (ev.key === 'ArrowUp') {
      kbCellDayIdx = Math.max(0, kbCellDayIdx - 1);
      ev.preventDefault();
    } else if (ev.key === 'ArrowDown') {
      kbCellDayIdx = Math.min(totalDays - 1, kbCellDayIdx + 1);
      ev.preventDefault();
    } else if (ev.key === 'PageUp') {
      kbCellDayIdx = Math.max(0, kbCellDayIdx - 7);
      ev.preventDefault();
    } else if (ev.key === 'PageDown') {
      kbCellDayIdx = Math.min(totalDays - 1, kbCellDayIdx + 7);
      ev.preventDefault();
    } else if (ev.key === 'Enter' && kbCellBlockId) {
      const blockId = kbCellBlockId;
      const dayMs = dayMsForCell(kbCellDayIdx);
      const payload = props.kbCarry;
      props.onKbCommit(blockId, dayMs, payload);
      ev.preventDefault();
    }
  }

  const monthTicks = $derived.by(() => {
    const out: { dayIdx: number; label: string }[] = [];
    let cur = new Date(visibleStart);
    cur.setUTCDate(1);
    cur.setUTCHours(0, 0, 0, 0);
    while (cur.getTime() <= visibleEnd) {
      const dayIdx = Math.floor((cur.getTime() - visibleStart) / DAY_MS);
      if (dayIdx >= 0)
        out.push({
          dayIdx,
          label: cur.toLocaleDateString('en', { month: 'short', year: '2-digit' })
        });
      cur = new Date(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1);
    }
    return out;
  });

  // ─── Phase 15: multi-select + group brackets ────────────────────────────
  // Selection state is parent-owned (Phase 15d). The swim-lane only reads
  // the set for visual feedback and emits a toggle event on click.
  const selectedCropIds = $derived(props.selectedCropIds ?? new Set<string>());

  function toggleSelect(ev: MouseEvent, cropId: string) {
    ev.stopPropagation();
    const additive = ev.shiftKey || ev.metaKey || ev.ctrlKey;
    props.onToggleSelect?.(cropId, additive);
  }

  /** Existing groups derived from planting rows. */
  interface GroupRender {
    groupId: string;
    blockId: string;
    systemKind: 'three-sisters' | 'succession' | 'manual';
    earliestMs: number;
    latestEndMs: number;
    memberCount: number;
  }
  const renderedGroups = $derived.by((): GroupRender[] => {
    const byGroup = new Map<string, GroupRender>();
    for (const p of props.plantings) {
      if (!p.groupId) continue;
      const existing = byGroup.get(p.groupId);
      if (existing) {
        existing.earliestMs = Math.min(existing.earliestMs, p.plantingDateMs);
        existing.latestEndMs = Math.max(existing.latestEndMs, p.endMs);
        existing.memberCount += 1;
      } else {
        byGroup.set(p.groupId, {
          groupId: p.groupId,
          blockId: p.blockId,
          systemKind: p.groupSystemKind ?? 'manual',
          earliestMs: p.plantingDateMs,
          latestEndMs: p.endMs,
          memberCount: 1
        });
      }
    }
    return [...byGroup.values()];
  });

  function systemLabel(kind: 'three-sisters' | 'succession' | 'manual'): string {
    if (kind === 'three-sisters') return 'Three Sisters';
    if (kind === 'succession') return 'Succession';
    return 'Group';
  }

  /** Picture-emoji glyphs make the task type identifiable at a
   *  glance on the swim-lane instead of the previous abstract
   *  Unicode dots / diamonds. Sized 18×18 via .task-pip to keep
   *  the rendered glyph legible without overwhelming the bar. */
  function pipGlyph(category: SwimTaskPip['category']): string {
    switch (category) {
      case 'plant':
        return '🌱';
      case 'till':
        return '🚜';
      case 'fertilize':
        return '💩';
      case 'spray':
        return '💧';
      case 'scout':
        return '🔍';
      case 'companion-check':
        return '🤝';
      default:
        return '·';
    }
  }
  /** Human-readable label paired with each glyph in the bar tooltip
   *  so operators learn the icon → task mapping over time. */
  function pipLabel(category: SwimTaskPip['category']): string {
    switch (category) {
      case 'plant':
        return 'Plant';
      case 'till':
        return 'Till';
      case 'fertilize':
        return 'Fertilize';
      case 'spray':
        return 'Spray';
      case 'scout':
        return 'Scout';
      case 'companion-check':
        return 'Companion check';
      default:
        return 'Task';
    }
  }
  // pipColor() removed when pips switched to emoji rendering — the
  // glyphs carry their own color now. Kept here as a marker so any
  // future "fallback to typography" path knows where the palette
  // lived (preserved in git history).

  // ─── Bar drag (move existing planting) ──────────────────────────────────
  /**
   * Where on the bar the user grabbed it (px from the bar's top). Used by
   * `columnRelativeY` to subtract the grab offset so the drop preview
   * line indicates where the bar's PLANTING-DATE edge (top) will land
   * — not where the cursor literally is. Without this, grabbing a bar
   * mid-way and dragging put the snap line under the cursor while the
   * bar would actually anchor at the cursor's day too, leaving the
   * impression that the line was an arbitrary cursor follower.
   *
   * Null when dragging a new bar from the rail (no source bar geometry),
   * in which case the snap line falls back to the cursor's day.
   */
  let barGrabOffsetY: number | null = null;

  function onBarDragStart(ev: DragEvent, cropId: string, sourceBlockId: string) {
    ev.stopPropagation();
    if (ev.dataTransfer) {
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('application/x-cropcard-crop-id', cropId);
      ev.dataTransfer.setData('text/plain', cropId);
    }
    const bar = ev.currentTarget as HTMLElement | null;
    if (bar) {
      const rect = bar.getBoundingClientRect();
      barGrabOffsetY = ev.clientY - rect.top;
    } else {
      barGrabOffsetY = null;
    }
    props.onBarDragStart?.(cropId, sourceBlockId);
  }
  function onBarDragEnd() {
    barGrabOffsetY = null;
    props.onBarDragEnd?.();
  }

  /** One entry per week — the Monday row index and date-of-month label. */
  const weekTicks = $derived.by(() => {
    const out: { monDayIdx: number; monLabel: string }[] = [];
    // Snap visibleStart back to the Monday of its week (UTC).
    const start = new Date(visibleStart);
    const dow = start.getUTCDay(); // 0=Sun … 6=Sat
    const offsetToMon = (dow + 6) % 7; // days back to Monday
    start.setUTCDate(start.getUTCDate() - offsetToMon);
    start.setUTCHours(0, 0, 0, 0);
    let cur = start.getTime();
    while (cur <= visibleEnd) {
      const monIdx = Math.floor((cur - visibleStart) / DAY_MS);
      const monDate = new Date(cur);
      out.push({ monDayIdx: monIdx, monLabel: String(monDate.getUTCDate()) });
      cur += 7 * DAY_MS;
    }
    return out;
  });
</script>

<svelte:window onkeydown={onSwimlaneKey} />

<div class="swimlane" aria-label="Block schedule swim lane" bind:this={swimRoot}>
  <div class="header-row">
    <div class="time-axis-cell"><span aria-hidden="true">🗓️</span></div>
    {#each orderedBlocks as b (b.id)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="block-header"
        class:dragging={reorderDragId === b.id}
        class:drop-target={reorderOverId === b.id &&
          reorderDragId !== null &&
          reorderDragId !== b.id}
        style="flex: {colFlexFor(b.id)};"
        draggable="true"
        ondragstart={(e) => onHeaderDragStart(e, b.id)}
        ondragover={(e) => onHeaderDragOver(e, b.id)}
        ondragleave={() => onHeaderDragLeave(b.id)}
        ondrop={(e) => onHeaderDrop(e, b.id)}
        ondragend={onHeaderDragEnd}
        title="Drag to reorder columns"
      >
        <div class="block-name">{b.blockLabel ?? b.name}</div>
        <div class="block-meta">
          {#if b.acres != null}<span>{b.acres.toFixed(2)} ac</span>{/if}
          <span class="sun sun-{b.sunExposure ?? 'full'}">{b.sunExposure ?? 'full'}</span>
          {#if b.eastWestIndex != null}<span class="axis">E{b.eastWestIndex}</span>{/if}
        </div>
      </div>
    {/each}
  </div>

  <div
    class="body"
    style="--row-h: {ROW_H}px; --total-h: {totalDays *
      ROW_H}px; --mon-offset-days: {firstMondayOffsetDays};"
  >
    <div class="time-axis">
      {#each weekTicks.filter((w) => w.monDayIdx >= 0) as wt (wt.monDayIdx)}
        <div class="week-tick mon" style="top: {wt.monDayIdx * ROW_H}px">M {wt.monLabel}</div>
      {/each}
      {#each monthTicks as t (t.dayIdx)}
        <div class="month-tick" style="top: {t.dayIdx * ROW_H}px">{t.label}</div>
      {/each}
    </div>

    <div class="columns">
      {#each orderedBlocks as b (b.id)}
        {@const lanes = laneAssignments.lanesPerBlock.get(b.id) ?? 1}
        <div
          class="column"
          role="region"
          aria-label="Block {b.name} drop zone"
          style="flex: {colFlexFor(b.id)};"
          ondragover={(e) => onColumnDragOver(e, b.id)}
          ondragleave={onColumnDragLeave}
          ondrop={(e) => onColumnDrop(e, b.id)}
        >
          {#each shadeBandsForBlock(b.id) as band (band.key)}
            {@const top = dayOffset(band.startMs) * ROW_H}
            {@const height = ((band.endMs - band.startMs) / DAY_MS) * ROW_H}
            {@const bandBg = 0.04 + 0.06 * band.intensity}
            {@const bandStripe = 0.06 + 0.1 * band.intensity}
            {@const bandBorder = 0.12 + 0.18 * band.intensity}
            <div
              class="shade-band"
              style="top: {top}px; height: {height}px; background-color: rgba(51, 65, 85, {bandBg}); background-image: repeating-linear-gradient(135deg, rgba(15, 23, 42, {bandStripe}) 0, rgba(15, 23, 42, {bandStripe}) 3px, transparent 3px, transparent 9px); border-left-color: rgba(15, 23, 42, {bandBorder});"
              title={band.tooltip}
              aria-label={band.tooltip}
            >
              {#if height >= 22}
                <span class="shade-band-label">
                  🌑 {band.sourceLabel}{#if band.slotsLabel}
                    · {band.slotsLabel}{/if}
                </span>
              {/if}
            </div>
          {/each}

          {#each renderedGroups.filter((g) => g.blockId === b.id) as g (g.groupId)}
            {@const top = dayOffset(g.earliestMs) * ROW_H}
            {@const height = ((g.latestEndMs - g.earliestMs) / DAY_MS) * ROW_H}
            <button
              type="button"
              class="group-bracket group-bracket-{g.systemKind}"
              style="top: {top}px; height: {height}px"
              onclick={() => props.onGroupOpen?.(g.groupId)}
              aria-label="{systemLabel(g.systemKind)} group, {g.memberCount} plantings"
            >
              <span class="group-bracket-label">{systemLabel(g.systemKind)}</span>
            </button>
          {/each}

          {#each props.plantings.filter((p) => p.blockId === b.id && intersectsYear(p)) as p (p.cropId)}
            {@const top = dayOffset(p.plantingDateMs) * ROW_H}
            {@const height = ((p.endMs - p.plantingDateMs) / DAY_MS) * ROW_H}
            {@const overlap = props.overlaps.some(
              (o) => o.blockId === b.id && (o.cropIdA === p.cropId || o.cropIdB === p.cropId)
            )}
            {@const rotation = props.rotations.some(
              (r) => r.blockId === b.id && r.candidateCropId === p.cropId
            )}
            {@const selected = selectedCropIds.has(p.cropId)}
            {@const laneIdx = laneIndexFor(p.cropId)}
            {@const laneLeftPct = (laneIdx / lanes) * 100}
            {@const laneWidthPct = (1 / lanes) * 100}
            {@const stageColor = stageBadgeColors(p.currentStage?.bodyKind)}
            {@const tailEndMs =
              p.harvestTargets && p.harvestTargets.length > 0
                ? Math.max(p.endMs, ...p.harvestTargets.map((t) => t.endMs))
                : p.endMs}
            {@const hasTail = tailEndMs > p.endMs}
            {#if hasTail}
              {@const tailTop = dayOffset(p.endMs) * ROW_H}
              {@const tailHeight = ((tailEndMs - p.endMs) / DAY_MS) * ROW_H}
              <div
                class="bar-tail"
                class:ghost={!inActiveYear(p)}
                style="top: {tailTop}px; height: {tailHeight}px; left: calc({laneLeftPct}% + {LANE_GAP_PX}px); width: calc({laneWidthPct}% - {LANE_GAP_PX *
                  2}px); background: {familyColor(p.cropFamily)};"
                aria-hidden="true"
              ></div>
            {/if}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="bar"
              class:overlap
              class:rotation
              class:ghost={!inActiveYear(p)}
              class:selected
              draggable={!!props.onBarDragStart}
              ondragstart={(ev) => onBarDragStart(ev, p.cropId, p.blockId)}
              ondragend={onBarDragEnd}
              style="top: {top}px; height: {height}px; left: calc({laneLeftPct}% + {LANE_GAP_PX}px); width: calc({laneWidthPct}% - {LANE_GAP_PX *
                2}px); background: {familyColor(p.cropFamily)};"
              title={barTooltip(p, lanes, laneIdx)}
              onclick={(ev) => toggleSelect(ev, p.cropId)}
            >
              <span class="bar-label">
                <!-- Phase 21b follow-up — anchor/companion role tags + the
                     grouped-bar dotted left border were removed. The
                     Primary/Secondary distinction wasn't legible to
                     operators (no inline explanation, just visual flair).
                     groupId stays on the data — group inspector + companion
                     check flows continue to use it — only the per-bar
                     visual indicator is gone. -->

                {#if p.currentStage}
                  <span
                    class="stage-badge"
                    style="background: {stageColor.bg}; color: {stageColor.fg};"
                    aria-label="Current stage: {p.currentStage.code} {p.currentStage.name}"
                    >{p.currentStage.code}</span
                  >
                {/if}
                {#if p.cornType}
                  <span class="corn-type-chip" aria-label="Corn type: {p.cornType}"
                    >{p.cornType}</span
                  >
                {/if}
                {p.shortName ?? p.varietyDisplayName}
              </span>
              {#if height >= 24}
                {@const plantDate = new Date(p.plantingDateMs).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric'
                })}
                <span class="plant-line" aria-label="Planted {plantDate}">
                  <span class="ht-leader">Plant</span>
                  <span class="ht-date">{plantDate}</span>
                </span>
              {/if}
            </div>

            {#if p.harvestTargets}
              {#each p.harvestTargets as t, ti (p.cropId + ':' + t.stageCode + ':' + ti)}
                {@const htTop = dayOffset(t.startMs) * ROW_H}
                {@const htHeight = Math.max(28, ((t.endMs - t.startMs) / DAY_MS) * ROW_H)}
                {@const htStart = new Date(t.startMs).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric'
                })}
                {@const htEnd = new Date(t.endMs).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric'
                })}
                <div
                  class="harvest-target-box"
                  style="top: {htTop}px; height: {htHeight}px; left: calc({laneLeftPct}% + {LANE_GAP_PX}px); width: calc({laneWidthPct}% - {LANE_GAP_PX *
                    2}px);"
                  title="Harvest — {t.label} ({t.stageCode}): {htStart} – {htEnd}"
                  aria-label="Harvest window {t.label} from {htStart} to {htEnd}"
                >
                  <span class="ht-line ht-leader">Harvest</span>
                  <span class="ht-line ht-tag">{t.label}</span>
                  <span class="ht-line ht-date">{htStart}</span>
                  <span class="ht-line ht-date">{htEnd}</span>
                </div>
              {/each}
            {/if}

            {#if props.taskPips}
              {#each props.taskPips.filter((t) => t.cropId === p.cropId) as pip, pi (pip.cropId + ':' + pip.scheduledForMs + ':' + pi)}
                {@const pipTop = dayOffset(pip.scheduledForMs) * ROW_H}
                {@const pipLeftPct = ((laneIdx + 1) / lanes) * 100}
                <div
                  class="task-pip"
                  class:stale={pip.stale}
                  style="top: {pipTop}px; left: calc({pipLeftPct}% - 16px);"
                  title={`${pipLabel(pip.category)} — ${pip.title}`}
                  aria-label={`${pipLabel(pip.category)}: ${pip.title}`}
                >
                  {pipGlyph(pip.category)}
                </div>
              {/each}
            {/if}
          {/each}

          {#if dropPreview && dropPreview.blockId === b.id}
            {@const top = dayOffset(dropPreview.dayMs) * ROW_H}
            <div
              class="drop-preview"
              class:too-early={dropPreview.tooEarly}
              style="top: {top}px"
            ></div>
            {#if dropPreview.tooEarly}
              <div class="drop-preview-label too-early-label" style="top: {top}px">
                ⚠ Too early — snapped to soil-temp / frost floor
              </div>
            {/if}
          {/if}

          {#if props.kbCarry && kbCellBlockId === b.id}
            <div class="kb-cursor" style="top: {kbCellDayIdx * ROW_H}px"></div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .swimlane {
    display: flex;
    flex-direction: column;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    background: #fff;
    overflow: auto;
    max-height: 75vh;
  }
  .header-row {
    display: flex;
    background: #f9fafb;
    border-bottom: 1px solid #e5e7eb;
    position: sticky;
    top: 0;
    z-index: 5;
    width: 100%;
  }
  .header-row .time-axis-cell {
    position: sticky;
    left: 0;
    z-index: 6;
    background: #f9fafb;
  }
  .time-axis-cell {
    width: 64px;
    flex-shrink: 0;
    border-right: 1px solid #e5e7eb;
    text-align: center;
    padding: 0.5rem 0;
    font-size: 0.85rem;
  }
  .block-header {
    /* flex set inline per block: `<lanes> 1 <lanes × MIN_LANE_W>px` */
    min-width: 0;
    padding: 0.5rem;
    border-right: 1px solid #e5e7eb;
    font-size: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    cursor: grab;
    user-select: none;
  }
  .block-header:active {
    cursor: grabbing;
  }
  .block-header.dragging {
    opacity: 0.4;
  }
  .block-header.drop-target {
    background: #dbeafe;
    box-shadow: inset 3px 0 0 #2563eb;
  }
  .block-name {
    font-weight: 600;
  }
  .block-meta {
    display: flex;
    gap: 0.4rem;
    font-size: 0.7rem;
    color: #6b7280;
    flex-wrap: wrap;
  }
  .sun {
    padding: 0 0.3rem;
    border-radius: 0.25rem;
    background: #fef3c7;
  }
  .sun-partial {
    background: #fde68a;
  }
  .sun-shade {
    background: #d1d5db;
  }
  .axis {
    background: #ddd6fe;
    padding: 0 0.3rem;
    border-radius: 0.25rem;
  }
  .body {
    display: flex;
    position: relative;
    width: 100%;
  }
  .time-axis {
    width: 64px;
    flex-shrink: 0;
    position: sticky;
    left: 0;
    z-index: 3;
    height: var(--total-h);
    border-right: 1px solid #e5e7eb;
    background-color: #fff;
    background-image: linear-gradient(
      to bottom,
      transparent 0,
      transparent 50%,
      rgba(15, 23, 42, 0.045) 50%,
      rgba(15, 23, 42, 0.045) 100%
    );
    background-size: 100% calc(var(--row-h) * 14);
    background-repeat: repeat;
    background-position-y: calc(-1 * var(--mon-offset-days, 0) * var(--row-h));
    background: linear-gradient(to bottom, #fff 0, #fff 50%, #fafafa 50%, #fafafa 100%);
    background-size: 100% calc(var(--row-h) * 14);
  }
  .month-tick {
    position: absolute;
    left: 0;
    right: 0;
    padding: 2px 4px;
    font-size: 0.72rem;
    font-weight: 600;
    color: #1f5e3a;
    background: #ecfdf5;
    border-top: 1px solid #6ee7b7;
    border-bottom: 1px solid #d1fae5;
    z-index: 2;
  }
  .week-tick {
    position: absolute;
    left: 0;
    right: 0;
    font-size: 0.6rem;
    line-height: 1;
    padding: 1px 4px;
    color: #9ca3af;
    pointer-events: none;
    z-index: 1;
  }
  .week-tick.mon {
    border-top: 1px solid #e5e7eb;
    color: #475569;
    font-weight: 500;
  }
  .columns {
    display: flex;
    flex: 1 1 auto;
    height: var(--total-h);
    min-width: 0;
  }
  .column {
    /* flex set inline per block: `<lanes> 1 <lanes × MIN_LANE_W>px` */
    position: relative;
    min-width: 0;
    border-right: 1px solid #f3f4f6;
    /* Two-week tile (14 rows): one transparent week + one tinted week.
       Shifted up by the Monday offset so banding aligns to week boundaries. */
    background-image: linear-gradient(
      to bottom,
      transparent 0,
      transparent 50%,
      rgba(15, 23, 42, 0.045) 50%,
      rgba(15, 23, 42, 0.045) 100%
    );
    background-size: 100% calc(var(--row-h) * 14);
    background-repeat: repeat;
    background-position-y: calc(-1 * var(--mon-offset-days, 0) * var(--row-h));
  }
  /* Shade-band overlay (Phase 14 redesign): in-column diagonal hatch with
   *  explicit attribution. Replaces the old left/right gradient projection
   *  which presumed swim-lane visual order matches physical E-W layout —
   *  no longer a safe assumption since drag-reorder is supported. */
  .shade-band {
    position: absolute;
    left: 4px;
    right: 4px;
    pointer-events: none;
    z-index: 1;
    border-radius: 0.2rem;
    border-left: 2px solid transparent;
    /* background-color, background-image, border-left-color set inline so
     * intensity controls per-band transparency without using `opacity` (which
     * would cascade to the label and wash its text out). */
  }
  .shade-band-label {
    position: absolute;
    top: 2px;
    left: 4px;
    right: 4px;
    font-size: 0.6rem;
    line-height: 1.1;
    color: #f8fafc;
    text-shadow: 0 1px 1px rgba(15, 23, 42, 0.9);
    background: rgba(15, 23, 42, 0.85);
    padding: 2px 4px;
    border-radius: 2px;
    white-space: normal;
    word-break: break-word;
    overflow: hidden;
  }
  .bar {
    position: absolute;
    /* left + width set inline per-bar based on lane assignment */
    border-radius: 0.25rem;
    color: #1f2937;
    padding: 0.2rem 0.4rem;
    font-size: 0.75rem;
    overflow: hidden;
    border: 1px solid rgba(0, 0, 0, 0.15);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }
  .bar-label {
    display: block;
    line-height: 1.1;
    word-break: break-word;
  }
  .bar.overlap {
    background-image: repeating-linear-gradient(
      45deg,
      transparent 0,
      transparent 6px,
      rgba(220, 38, 38, 0.4) 6px,
      rgba(220, 38, 38, 0.4) 9px
    );
    border-color: #dc2626;
  }
  .bar.rotation {
    border: 2px dashed #f59e0b;
  }
  .bar.ghost {
    opacity: 0.4;
  }
  .drop-preview {
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: #4338ca;
    pointer-events: none;
  }
  /** Snap-forward state — the cursor aimed at a date earlier than the
   *  soil-temp / last-spring-frost floor, and the parent's snap helper
   *  pushed the proposed planting date forward. The red line +
   *  "Too early" label make the auto-correction visible so the
   *  operator doesn't think the snap line is broken. */
  .drop-preview.too-early {
    background: #b91c1c;
    height: 3px;
    box-shadow: 0 0 0 1px rgba(185, 28, 28, 0.25);
  }
  .drop-preview-label {
    position: absolute;
    left: 6px;
    transform: translateY(-100%);
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    font-size: 0.72rem;
    font-weight: 600;
    pointer-events: none;
    white-space: nowrap;
    z-index: 5;
  }
  .too-early-label {
    background: #b91c1c;
    color: #fff;
  }
  .kb-cursor {
    position: absolute;
    left: 0;
    right: 0;
    height: 3px;
    background: #16a34a;
    pointer-events: none;
  }

  .bar.selected {
    outline: 3px solid #4338ca;
    outline-offset: 1px;
  }
  /* Phase 21b follow-up — .bar.grouped, .bar.anchor, .role-tag CSS
   * removed when the anchor/companion visual indicator was retired.
   * groupId data + the GroupInspector flows are unaffected; only the
   * per-bar visual cue is gone. */
  .stage-badge {
    display: inline-block;
    font-size: 0.65rem;
    font-weight: 600;
    line-height: 1;
    padding: 0.1rem 0.3rem;
    margin-right: 0.2rem;
    border-radius: 0.2rem;
    vertical-align: baseline;
  }
  .corn-type-chip {
    display: inline-block;
    font-size: 0.6rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    padding: 0.05rem 0.25rem;
    margin-right: 0.2rem;
    border-radius: 0.2rem;
    background: rgba(31, 41, 55, 0.12);
    color: #1f2937;
    vertical-align: baseline;
  }
  .bar-tail {
    position: absolute;
    border-left: 1px solid rgba(0, 0, 0, 0.15);
    border-right: 1px solid rgba(0, 0, 0, 0.15);
    border-bottom: 1px solid rgba(0, 0, 0, 0.15);
    border-radius: 0 0 0.25rem 0.25rem;
    mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.85) 0%, rgba(0, 0, 0, 0.08) 100%);
    -webkit-mask-image: linear-gradient(
      to bottom,
      rgba(0, 0, 0, 0.85) 0%,
      rgba(0, 0, 0, 0.08) 100%
    );
    pointer-events: none;
    z-index: 0;
  }
  .bar-tail.ghost {
    opacity: 0.4;
  }
  .harvest-target-box {
    position: absolute;
    border: 2px dashed #16a34a;
    background: rgba(22, 163, 74, 0.15);
    border-radius: 0.25rem;
    padding: 0.2rem 0.3rem;
    box-sizing: border-box;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 0.05rem;
    pointer-events: none;
    z-index: 2;
  }
  .ht-line {
    display: block;
    line-height: 1.05;
    font-size: 0.65rem;
    color: #14532d;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ht-leader {
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 0.6rem;
  }
  .ht-tag {
    font-size: 0.6rem;
    font-style: italic;
    color: #166534;
  }
  .ht-date {
    font-variant-numeric: tabular-nums;
  }
  .plant-line {
    display: block;
    margin-top: 0.2rem;
    font-size: 0.65rem;
    line-height: 1.05;
    color: rgba(31, 41, 55, 0.85);
  }
  .plant-line .ht-leader {
    margin-right: 0.3rem;
  }

  .group-bracket {
    position: absolute;
    left: -2px;
    width: 6px;
    border: none;
    background: transparent;
    cursor: pointer;
    z-index: 1;
    padding: 0;
  }
  .group-bracket::before {
    content: '';
    position: absolute;
    inset: 0;
    border-left: 3px solid #312e81;
    border-top: 3px solid #312e81;
    border-bottom: 3px solid #312e81;
    border-radius: 4px 0 0 4px;
  }
  .group-bracket-three-sisters::before {
    border-color: #b45309;
  }
  .group-bracket-succession::before {
    border-color: #0891b2;
  }
  .group-bracket:focus-visible {
    outline: 2px solid #4338ca;
    outline-offset: 2px;
  }
  .group-bracket-label {
    position: absolute;
    left: 8px;
    top: 0;
    font-size: 0.6rem;
    color: #312e81;
    background: rgba(255, 255, 255, 0.85);
    padding: 0 0.2rem;
    border-radius: 2px;
    white-space: nowrap;
    pointer-events: none;
  }
  .group-bracket-three-sisters .group-bracket-label {
    color: #b45309;
  }
  .group-bracket-succession .group-bracket-label {
    color: #0891b2;
  }

  /** Phase 21b follow-up — task pips now use picture emojis (🌱 plant,
   *  🚜 till, 💩 fertilize, 💧 spray, 🔍 scout, 🤝 companion). Bumped
   *  size + light background ring so the glyphs are legible against
   *  the colored bar behind them. */
  .task-pip {
    position: absolute;
    /* left set inline per-pip based on owning bar's lane */
    width: 18px;
    height: 18px;
    line-height: 18px;
    text-align: center;
    font-size: 14px;
    pointer-events: none;
    background: rgba(255, 255, 255, 0.85);
    border-radius: 50%;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.15);
    /* Pull the icon up so its center sits on the scheduled day row
     * (top-aligned by default since the pip is positioned at the
     * row's top edge). */
    margin-top: -3px;
  }
  .task-pip.stale {
    opacity: 0.45;
    filter: grayscale(0.7);
  }
</style>
