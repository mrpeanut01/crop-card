/**
 * Shared state and actions for the garden designer. The canvas, the List
 * view, the toolbar and the sheets all read and change the design through
 * one instance, so every action has the same result whichever view ran it.
 */

import { getContext, setContext } from 'svelte';
import {
  BED_PRESETS,
  DEFAULT_SPOT_SPACING,
  FOOTPRINT_SNAP_IN,
  SNAP_FT,
  adjacentBeds,
  bedRect,
  clampFootprint,
  clampToArea,
  fitFootprint,
  footprintsOverlap,
  freeSpot,
  overlappingBeds,
  pointInBedIn,
  rotate90,
  snap,
  type SpotSpacing
} from '$lib/garden/geometry';
import {
  bedOccupancyOn,
  intervalsOverlapInTime,
  occupancyChangeDays,
  occupancyIntervals,
  plantingOccupancy,
  scrubRange,
  shortDate,
  utcDayStart
} from '$lib/garden/occupancy';
import { footprintForCount, plantCount, resolveSpacing } from '$lib/garden/plantCount';
import { bedHistory, companionHints, rotationWarnings } from '$lib/garden/rotation';
import { proposeSuccession } from '$lib/garden/succession';
import {
  applyRecipe,
  frostFreeDays,
  recipeFits,
  type BedRecipePlugin,
  type RecipeFit
} from '$lib/garden/recipes';
import type {
  BedCreateRequest,
  BedPatchRequest,
  FillResponse,
  FootprintWriteRequest,
  FootprintWriteResponse,
  GardenErrorResponse,
  PlantingCreateRequest,
  PlantingCreateResponse,
  SuccessionResponse
} from '$lib/garden/api';
import type { CompanionPlugin } from '$lib/plugins/schemas';
import type {
  AreaCanvas,
  BedHistoryEntry,
  BedLayout,
  BedOccupancyOnDate,
  BedPresetId,
  CompanionHint,
  Footprint,
  GardenCrop,
  GardenDesign,
  OccupancyInterval,
  PlacedPlanting,
  PointFt,
  ProposedPlanting,
  RectFt,
  Rotation,
  RotationWarning,
  SpacingPattern,
  SuccessionProposal
} from '$lib/garden/types';
import { feet, ft, longDate, parseYmd, plural, ymd } from './format';
import { plantingInGround } from '$lib/garden/inGround';
import { deterministicPlantingWindow } from '$lib/plan/plantingWindow';

export type CropChoice =
  | { source: 'planting'; cropId: string; label: string }
  | { source: 'catalog'; pluginId: string; label: string };

export type DesignerMode =
  | { kind: 'idle' }
  | { kind: 'place-bed'; presetId: BedPresetId; widthFt: number; lengthFt: number }
  | { kind: 'move-bed'; blockId: string }
  | { kind: 'carry-bed'; blockId: string; origin: RectFt }
  | { kind: 'place-crop'; crop: CropChoice }
  | { kind: 'move-planting'; cropId: string };

export interface RoomConflict {
  text: string;
  retryDateMs: number | null;
  crop: CropChoice;
  blockId: string;
  at: { xIn: number; yIn: number } | undefined;
}

export interface DesignerInit {
  design: GardenDesign;
  history: Record<string, BedHistoryEntry[]>;
  catalog: GardenCrop[];
  companions: Array<Partial<CompanionPlugin> & { pluginId: string }>;
  lookbackByFamily: Record<string, number>;
  canEdit: boolean;
  recipes?: BedRecipePlugin[];
  /** A greenhouse stretches the season, so frost-date planting windows
   *  only apply outdoors. */
  areaKind?: string;
  nowMs?: number;
  initialDateMs?: number | null;
  initialBedId?: string | null;
  fetch?: typeof fetch;
}

export class WriteError extends Error {
  constructor(
    message: string,
    readonly code: GardenErrorResponse['code'] | null,
    readonly offline: boolean
  ) {
    super(message);
  }
}

const OFFLINE_WRITE = "That change didn't save because you're offline.";
const DEFAULT_CROP_LENGTH_IN = 24;
const WINDOW_GRACE_MS = 7 * 86_400_000;

function errorText(body: GardenErrorResponse | null, status: number): string {
  if (body?.code === 'OVERLAP') return "Beds can't overlap";
  if (body?.code === 'OUTSIDE_AREA') return 'Beds stay inside the garden.';
  if (body?.code === 'READ_ONLY' || status === 403) {
    return 'View only. The farm owner changes the layout.';
  }
  return body?.error ?? `That didn't save (${status}).`;
}

export function nextBedName(
  beds: readonly Pick<BedLayout, 'name'>[],
  kind: 'bed' | 'container'
): string {
  const prefix = kind === 'container' ? 'Pot' : 'Bed';
  const used = new Set<number>();
  const re = new RegExp(`^${prefix} (\\d+)$`);
  for (const b of beds) {
    const m = re.exec(b.name.trim());
    if (m) used.add(Number(m[1]));
  }
  let n = 1;
  while (used.has(n)) n++;
  return `${prefix} ${n}`;
}

function sameRect(a: RectFt, b: RectFt): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.l === b.l;
}

export class DesignerState {
  design = $state() as GardenDesign;
  history: Record<string, BedHistoryEntry[]>;
  catalog: GardenCrop[];
  companions: CompanionPlugin[];
  lookbackByFamily: Record<string, number>;
  recipes: BedRecipePlugin[];
  readonly roleCanEdit: boolean;
  readonly fetcher: typeof fetch;

  selectedBedId = $state<string | null>(null);
  selectedCropId = $state<string | null>(null);
  mode = $state<DesignerMode>({ kind: 'idle' });
  dateMs = $state(0);
  wholeSeason = $state(false);
  view = $state<'canvas' | 'list'>('canvas');
  cropPanelOpen = $state(false);
  cropTargetBedId = $state<string | null>(null);
  confirmDeleteBedId = $state<string | null>(null);
  conflict = $state<RoomConflict | null>(null);
  status = $state('');
  alert = $state('');
  busy = $state(false);
  offline = $state(false);
  preview = $state<{ blockId: string; rect: RectFt } | null>(null);
  ghosts = $state<Array<{ key: string; blockId: string; footprint: Footprint; label: string }>>([]);
  recentPluginIds = $state<string[]>([]);
  /** Asks the canvas or list to focus a bed or planting after a keyboard
   *  action moved or created it. */
  focusRequest = $state<{ kind: 'bed' | 'planting'; id: string; n: number } | null>(null);
  renameRequest = $state(0);
  sizeRequest = $state(0);

  canEdit = $derived.by(() => this.roleCanEdit && !this.offline && !this.design.readOnly);
  canvas = $derived.by<AreaCanvas>(() => this.design.canvas);
  beds = $derived.by<BedLayout[]>(() => this.design.beds);
  unplaced = $derived.by(() => new Set(this.design.unplacedBedIds ?? []));
  intervals = $derived.by<OccupancyInterval[]>(() =>
    occupancyIntervals(this.design.plantings, this.design.crops, {
      firstFallFrostMs: this.design.frost.firstFallFrostMs,
      lastSpringFrostMs: this.design.frost.lastSpringFrostMs
    })
  );
  intervalById = $derived.by(() => new Map(this.intervals.map((i) => [i.cropId, i])));
  range = $derived.by(() =>
    scrubRange(this.design.seasonYear, this.intervals, this.nowMs, this.design.frost)
  );
  changeDays = $derived.by(() => occupancyChangeDays(this.intervals));
  occupancy = $derived.by(() => {
    const out = new Map<string, BedOccupancyOnDate>();
    for (const bed of this.beds) {
      out.set(bed.blockId, bedOccupancyOn(bed, this.intervals, this.dateMs, this.range));
    }
    return out;
  });
  unplacedPlantings = $derived.by(() =>
    this.design.plantings.filter((p) => !p.footprint && this.inSeasonYear(p))
  );
  selectedBed = $derived.by(() => this.beds.find((b) => b.blockId === this.selectedBedId) ?? null);
  selectedPlanting = $derived.by(
    () => this.design.plantings.find((p) => p.cropId === this.selectedCropId) ?? null
  );
  hints = $derived.by<CompanionHint[]>(() =>
    companionHints(
      this.beds,
      this.design.plantings,
      this.intervals,
      this.companions,
      adjacentBeds(this.beds)
    )
  );
  hasScheduledPlanting = $derived.by(() => this.intervals.length > 0);
  todayInRange = $derived.by(() => {
    const today = utcDayStart(this.nowMs);
    return today >= this.range.startMs && today <= this.range.endMs;
  });
  /** Where a new planting in view starts; set by `placeCrop` so the page can
   *  offer to jump there when it isn't the scrubbed date. */
  jumpTo = $state<{ dateMs: number; text: string } | null>(null);

  readonly nowMs: number;
  readonly outdoors: boolean;

  constructor(init: DesignerInit) {
    this.outdoors = init.areaKind !== 'greenhouse';
    this.design = init.design;
    this.history = init.history;
    this.catalog = init.catalog;
    this.companions = init.companions as CompanionPlugin[];
    this.lookbackByFamily = init.lookbackByFamily;
    this.recipes = init.recipes ?? [];
    this.roleCanEdit = init.canEdit;
    this.fetcher = init.fetch ?? ((...args) => fetch(...args));
    this.nowMs = init.nowMs ?? Date.now();
    const range = scrubRange(
      init.design.seasonYear,
      occupancyIntervals(init.design.plantings, init.design.crops, {
        firstFallFrostMs: init.design.frost.firstFallFrostMs,
        lastSpringFrostMs: init.design.frost.lastSpringFrostMs
      }),
      this.nowMs,
      init.design.frost
    );
    const today = utcDayStart(this.nowMs);
    const todayInRange = today >= range.startMs && today <= range.endMs;
    const wanted =
      init.initialDateMs != null
        ? utcDayStart(init.initialDateMs)
        : todayInRange
          ? today
          : init.design.frost.lastSpringFrostMs;
    this.dateMs = Math.min(range.endMs, Math.max(range.startMs, wanted));
    if (init.initialBedId && init.design.beds.some((b) => b.blockId === init.initialBedId)) {
      this.selectedBedId = init.initialBedId;
    }
  }

  say(text: string): void {
    this.status = '';
    queueMicrotask(() => (this.status = text));
  }

  warn(text: string): void {
    this.alert = '';
    queueMicrotask(() => (this.alert = text));
  }

  bed(blockId: string): BedLayout | undefined {
    return this.beds.find((b) => b.blockId === blockId);
  }

  crop(pluginId: string): GardenCrop | undefined {
    return this.design.crops[pluginId] ?? this.catalog.find((c) => c.pluginId === pluginId);
  }

  plantingsIn(blockId: string): PlacedPlanting[] {
    return this.design.plantings.filter((p) => p.blockId === blockId);
  }

  bedLabel(bed: BedLayout): string {
    const pos = `${feet(bed.rect.x)} from west, ${feet(bed.rect.y)} from north`;
    const kind = bed.kind === 'container' ? 'container' : `${bed.bedStyle ?? 'garden'} bed`;
    const occ = this.occupancy.get(bed.blockId);
    const on = occ?.occupants.length
      ? occ.occupants
          .map((o) => {
            const p = this.design.plantings.find((q) => q.cropId === o.cropId);
            if (!p) return '';
            return p.plantCount
              ? `${p.varietyDisplayName}, ${plural(p.plantCount, 'plant')}`
              : p.varietyDisplayName;
          })
          .filter(Boolean)
          .join('; ')
      : occ?.openSinceMs != null
        ? `open from ${longDate(occ.openSinceMs)}`
        : 'open';
    return `${bed.name}, ${ft(bed.widthFt)} by ${ft(bed.lengthFt)} foot ${kind}, ${pos}. On ${longDate(this.dateMs)}: ${on}.`;
  }

  stageOf(cropId: string): 'Growing' | 'Harvesting' | null {
    const i = this.intervalById.get(cropId);
    if (!i || this.dateMs < i.startMs || this.dateMs >= i.endMs) return null;
    return this.dateMs >= i.harvestStartMs ? 'Harvesting' : 'Growing';
  }

  bedSummary(bed: BedLayout): string {
    const occ = this.occupancy.get(bed.blockId);
    if (!occ || occ.occupants.length === 0) {
      return occ?.openSinceMs != null ? `open from ${longDate(occ.openSinceMs)}` : 'open';
    }
    return occ.occupants
      .map((o) => {
        const p = this.design.plantings.find((q) => q.cropId === o.cropId);
        const stage = this.stageOf(o.cropId);
        return p ? `${p.varietyDisplayName}${stage ? `, ${stage.toLowerCase()}` : ''}` : '';
      })
      .filter(Boolean)
      .join(' and ');
  }

  dateSummary(): string {
    const parts = [...this.beds]
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
      .map((b) => `${b.name}: ${this.bedSummary(b)}.`);
    return `${longDate(this.dateMs)}. ${parts.join(' ')}`.trim();
  }

  setDate(ms: number): void {
    this.dateMs = Math.min(this.range.endMs, Math.max(this.range.startMs, utcDayStart(ms)));
    if (this.jumpTo && this.jumpTo.dateMs === this.dateMs) this.jumpTo = null;
  }

  /** "May 15, 2027" or "May 15" when the date is in the season year. */
  dateText(ms: number): string {
    const y = new Date(ms).getUTCFullYear();
    return y === this.design.seasonYear ? shortDate(ms) : `${shortDate(ms)}, ${y}`;
  }

  /** Undated, or dated in the season year. Plantings from another year
   *  are shown for context but never offered for placing. */
  inSeasonYear(p: Pick<PlacedPlanting, 'plantingDateMs'>): boolean {
    return (
      p.plantingDateMs == null ||
      new Date(p.plantingDateMs).getUTCFullYear() === this.design.seasonYear
    );
  }

  private inGround(p: PlacedPlanting): boolean {
    return plantingInGround(p, this.nowMs);
  }

  /** The plugin's planting window for a crop in this season, from the
   *  farm's frost dates. */
  plantingWindowFor(pluginId: string): { startMs: number; endMs: number; note: string | null } {
    const crop = this.crop(pluginId);
    const w = deterministicPlantingWindow(
      {
        cropFamily: crop?.cropFamily ?? null,
        soilTempMinF: crop?.plantingGuide?.soilTempMinF ?? null,
        dtmMaxDays: crop?.daysToMaturity?.max ?? null
      },
      {
        lastSpring: ymd(this.design.frost.lastSpringFrostMs),
        firstFall: ymd(this.design.frost.firstFallFrostMs)
      }
    );
    return {
      startMs: parseYmd(w.earliest) ?? this.design.frost.lastSpringFrostMs,
      endMs: parseYmd(w.latest) ?? this.design.frost.firstFallFrostMs,
      note: w.note
    };
  }

  /** A warning when an outdoor planting is dated outside its crop's
   *  window by more than a week. */
  windowWarning(p: Pick<PlacedPlanting, 'cropPluginId' | 'plantingDateMs'>): string | null {
    if (p.plantingDateMs == null || !this.outdoors) return null;
    const crop = this.crop(p.cropPluginId);
    if (!crop) return null;
    const day = utcDayStart(p.plantingDateMs);
    const w = this.plantingWindowFor(p.cropPluginId);
    if (day < w.startMs - WINDOW_GRACE_MS) {
      return `Early for ${crop.displayName}. Its window opens ${this.dateText(w.startMs)}.`;
    }
    if (day > w.endMs + WINDOW_GRACE_MS) {
      return `Late for ${crop.displayName}. It needs to go in by ${this.dateText(w.endMs)} to finish before frost.`;
    }
    return null;
  }

  selectBed(blockId: string | null): void {
    this.selectedBedId = blockId;
    this.selectedCropId = null;
    this.confirmDeleteBedId = null;
    if (this.mode.kind === 'carry-bed' || this.mode.kind === 'move-bed')
      this.mode = { kind: 'idle' };
  }

  selectPlanting(cropId: string): void {
    const p = this.design.plantings.find((q) => q.cropId === cropId);
    if (!p) return;
    this.selectedBedId = p.blockId;
    this.selectedCropId = cropId;
  }

  cancelMode(): void {
    if (this.mode.kind === 'carry-bed') {
      const { blockId, origin } = this.mode;
      this.replaceBed(blockId, (b) => ({ ...b, rect: origin }));
      this.say(`${this.bed(blockId)?.name ?? 'Bed'} put back.`);
    }
    this.mode = { kind: 'idle' };
    this.conflict = null;
    this.ghosts = [];
    this.preview = null;
  }

  private replaceBed(blockId: string, fn: (b: BedLayout) => BedLayout): void {
    this.design.beds = this.design.beds.map((b) => (b.blockId === blockId ? fn(b) : b));
  }

  private markPlaced(blockId: string): void {
    if (!this.design.unplacedBedIds?.includes(blockId)) return;
    this.design.unplacedBedIds = this.design.unplacedBedIds.filter((id) => id !== blockId);
  }

  async request<T>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
    const { json, ...rest } = init;
    let res: Response;
    try {
      res = await this.fetcher(url, {
        ...rest,
        headers: json !== undefined ? { 'content-type': 'application/json' } : undefined,
        body: json !== undefined ? JSON.stringify(json) : undefined
      });
    } catch {
      this.offline = true;
      throw new WriteError(OFFLINE_WRITE, 'OFFLINE', true);
    }
    const body = (await res.json().catch(() => null)) as (T & GardenErrorResponse) | null;
    if (!res.ok) throw new WriteError(errorText(body, res.status), body?.code ?? null, false);
    return body as T;
  }

  private writeSeq = new Map<string, number>();
  private writeChain = new Map<string, Promise<unknown>>();
  private confirmedBeds = new Map<string, BedLayout>();
  private confirmedPlantings = new Map<string, PlacedPlanting>();

  /** Runs writes for one bed or planting one after another, so a slow
   *  failure can't land after a later success. `seq` says which write is
   *  the latest for that key. */
  private queueWrite<T>(key: string, run: () => Promise<T>): { seq: number; done: Promise<T> } {
    const seq = (this.writeSeq.get(key) ?? 0) + 1;
    this.writeSeq.set(key, seq);
    const done = (this.writeChain.get(key) ?? Promise.resolve()).then(run);
    this.writeChain.set(
      key,
      done.catch(() => undefined)
    );
    return { seq, done };
  }

  private isLatestWrite(key: string, seq: number): boolean {
    return this.writeSeq.get(key) === seq;
  }

  private fail(e: unknown): void {
    this.warn(e instanceof WriteError ? e.message : "That didn't save. Try again.");
  }

  private guard(): boolean {
    if (this.canEdit) return true;
    this.warn(
      this.offline
        ? "You're offline. Editing needs a connection."
        : 'View only. The farm owner changes the layout.'
    );
    return false;
  }

  // ── Beds ───────────────────────────────────────────────────────────────

  choosePreset(presetId: BedPresetId, size?: { widthFt: number; lengthFt: number }): void {
    if (!this.guard()) return;
    const preset = BED_PRESETS[presetId];
    const widthFt = size?.widthFt ?? preset.widthFt;
    const lengthFt = size?.lengthFt ?? preset.lengthFt;
    if (this.mode.kind === 'place-bed' && this.mode.presetId === presetId) {
      this.mode = { kind: 'idle' };
      const spot = freeSpot(
        widthFt,
        lengthFt,
        0,
        this.beds,
        this.canvas,
        undefined,
        this.spotSpacing(presetId)
      );
      if (!spot) {
        this.warn('The garden is full. Make it bigger or remove a bed.');
        return;
      }
      void this.createBed(presetId, spot, widthFt, lengthFt);
      return;
    }
    this.selectBed(null);
    this.mode = { kind: 'place-bed', presetId, widthFt, lengthFt };
    this.say(
      `Tap the garden where the ${preset.label}'s top-left corner goes, or choose it again to drop it in the first open spot.`
    );
  }

  /** Containers sit closer together than beds you walk between. */
  private spotSpacing(presetId: BedPresetId): SpotSpacing {
    return BED_PRESETS[presetId].kind === 'container'
      ? { aisleFt: 1, insetFt: DEFAULT_SPOT_SPACING.insetFt }
      : DEFAULT_SPOT_SPACING;
  }

  addBedAtFreeSpot(
    presetId: BedPresetId,
    size?: { widthFt: number; lengthFt: number }
  ): Promise<void> {
    if (!this.guard()) return Promise.resolve();
    const preset = BED_PRESETS[presetId];
    const widthFt = size?.widthFt ?? preset.widthFt;
    const lengthFt = size?.lengthFt ?? preset.lengthFt;
    const spot = freeSpot(
      widthFt,
      lengthFt,
      0,
      this.beds,
      this.canvas,
      undefined,
      this.spotSpacing(presetId)
    );
    if (!spot) {
      this.warn('The garden is full. Make it bigger or remove a bed.');
      return Promise.resolve();
    }
    return this.createBed(presetId, spot, widthFt, lengthFt);
  }

  placeBedAt(point: PointFt): Promise<void> {
    if (this.mode.kind !== 'place-bed') return Promise.resolve();
    const { presetId, widthFt, lengthFt } = this.mode;
    const rect = clampToArea(
      bedRect(snap(point.x), snap(point.y), widthFt, lengthFt, 0),
      this.canvas
    );
    if (!rect) {
      this.warn("That bed is bigger than the garden. Set the garden's Size in Draw your farm.");
      return Promise.resolve();
    }
    if (overlappingBeds(rect, this.beds).length) {
      this.warn("Beds can't overlap");
      return Promise.resolve();
    }
    this.mode = { kind: 'idle' };
    return this.createBed(presetId, rect, widthFt, lengthFt);
  }

  async createBed(
    presetId: BedPresetId,
    rect: RectFt,
    widthFt: number,
    lengthFt: number
  ): Promise<void> {
    const preset = BED_PRESETS[presetId];
    const name = nextBedName(this.beds, preset.kind);
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const bed: BedLayout = {
      blockId: tempId,
      name,
      kind: preset.kind,
      bedStyle: preset.bedStyle,
      widthFt,
      lengthFt,
      rotationDeg: 0,
      rect
    };
    this.design.beds = [...this.design.beds, bed];
    const body: BedCreateRequest = {
      fieldId: this.canvas.areaId,
      name,
      kind: preset.kind,
      bedStyle: preset.bedStyle,
      widthFt,
      lengthFt,
      xFt: rect.x,
      yFt: rect.y,
      rotationDeg: 0
    };
    this.busy = true;
    try {
      const res = await this.request<{ block: { id: string } }>('/api/blocks', {
        method: 'POST',
        json: body
      });
      this.replaceBed(tempId, (b) => ({ ...b, blockId: res.block.id }));
      this.history[res.block.id] = [];
      this.selectedBedId = res.block.id;
      this.selectedCropId = null;
      this.say(`${name} added at ${feet(rect.x)} from west, ${feet(rect.y)} from north.`);
    } catch (e) {
      this.design.beds = this.design.beds.filter((b) => b.blockId !== tempId);
      this.fail(e);
    } finally {
      this.busy = false;
    }
  }

  /** Commits a changed bed: optimistic, one PATCH, rolled back on failure. */
  async commitBed(next: BedLayout, prev: BedLayout, what: string): Promise<boolean> {
    if (!this.guard()) return false;
    const others = this.beds.filter((b) => b.blockId !== next.blockId);
    if (overlappingBeds(next.rect, others).length) {
      this.replaceBed(next.blockId, () => prev);
      this.warn("Beds can't overlap");
      return false;
    }
    this.replaceBed(next.blockId, () => next);
    const patch: BedPatchRequest = {};
    if (next.name !== prev.name) patch.name = next.name;
    if (next.bedStyle !== prev.bedStyle && next.bedStyle) patch.bedStyle = next.bedStyle;
    if (next.widthFt !== prev.widthFt) patch.widthFt = next.widthFt;
    if (next.lengthFt !== prev.lengthFt) patch.lengthFt = next.lengthFt;
    if (next.rotationDeg !== prev.rotationDeg) patch.rotationDeg = next.rotationDeg;
    const wasUnplaced = this.unplaced.has(next.blockId);
    if (next.rect.x !== prev.rect.x || next.rect.y !== prev.rect.y || wasUnplaced) {
      patch.xFt = next.rect.x;
      patch.yFt = next.rect.y;
    }
    if (Object.keys(patch).length === 0) return true;
    const id = next.blockId;
    const key = `bed:${id}`;
    if (!this.confirmedBeds.has(id)) this.confirmedBeds.set(id, prev);
    const { seq, done } = this.queueWrite(key, () =>
      this.request(`/api/blocks/${encodeURIComponent(id)}`, { method: 'PATCH', json: patch })
    );
    try {
      await done;
      if (this.isLatestWrite(key, seq)) this.confirmedBeds.delete(id);
      else this.confirmedBeds.set(id, next);
      this.markPlaced(id);
      this.say(what);
      return true;
    } catch (e) {
      if (this.isLatestWrite(key, seq)) {
        const back = this.confirmedBeds.get(id) ?? prev;
        this.confirmedBeds.delete(id);
        this.replaceBed(id, () => back);
      }
      this.fail(e);
      return false;
    }
  }

  moveBedTo(blockId: string, x: number, y: number): Promise<boolean> {
    const bed = this.bed(blockId);
    if (!bed) return Promise.resolve(false);
    const rect = clampToArea(
      bedRect(snap(x), snap(y), bed.widthFt, bed.lengthFt, bed.rotationDeg),
      this.canvas
    );
    if (!rect) return Promise.resolve(false);
    if (sameRect(rect, bed.rect) && !this.unplaced.has(blockId)) return Promise.resolve(true);
    return this.commitBed(
      { ...bed, rect },
      bed,
      `${bed.name} moved to ${feet(rect.x)} from west, ${feet(rect.y)} from north.`
    );
  }

  startMove(blockId: string): void {
    if (!this.guard()) return;
    this.selectedBedId = blockId;
    this.mode = { kind: 'move-bed', blockId };
    this.say(`Tap where ${this.bed(blockId)?.name ?? 'the bed'}'s top-left corner should go.`);
  }

  pickUp(blockId: string): void {
    if (!this.guard()) return;
    const bed = this.bed(blockId);
    if (!bed) return;
    this.selectedBedId = blockId;
    this.mode = { kind: 'carry-bed', blockId, origin: bed.rect };
    this.say(`${bed.name} picked up. Use arrow keys to move, Enter to drop.`);
  }

  carry(dxFt: number, dyFt: number): void {
    if (this.mode.kind !== 'carry-bed') return;
    const bed = this.bed(this.mode.blockId);
    if (!bed) return;
    const moved = clampToArea(
      bedRect(
        snap(bed.rect.x + dxFt),
        snap(bed.rect.y + dyFt),
        bed.widthFt,
        bed.lengthFt,
        bed.rotationDeg
      ),
      this.canvas
    );
    if (moved) this.replaceBed(bed.blockId, (b) => ({ ...b, rect: moved }));
  }

  async drop(): Promise<void> {
    if (this.mode.kind !== 'carry-bed') return;
    const { blockId, origin } = this.mode;
    this.mode = { kind: 'idle' };
    const bed = this.bed(blockId);
    if (!bed) return;
    const prev = { ...bed, rect: origin };
    if (sameRect(bed.rect, origin) && !this.unplaced.has(blockId)) {
      this.say(`${bed.name} dropped where it was.`);
      return;
    }
    await this.commitBed(
      bed,
      prev,
      `${bed.name} moved to ${feet(bed.rect.x)} from west, ${feet(bed.rect.y)} from north.`
    );
  }

  nudgeBed(blockId: string, dxFt: number, dyFt: number): Promise<boolean> {
    const bed = this.bed(blockId);
    if (!bed) return Promise.resolve(false);
    return this.moveBedTo(blockId, bed.rect.x + dxFt, bed.rect.y + dyFt);
  }

  turnBed(blockId: string): Promise<boolean> {
    const bed = this.bed(blockId);
    if (!bed || !this.guard()) return Promise.resolve(false);
    const turned = rotate90(bed, this.canvas);
    if (!turned) {
      this.warn(`${bed.name} won't fit turned. Make the garden bigger or the bed shorter.`);
      return Promise.resolve(false);
    }
    return this.commitBed(turned, bed, `${bed.name} turned to ${turned.rotationDeg} degrees.`);
  }

  resizeBed(blockId: string, widthFt: number, lengthFt: number): Promise<boolean> {
    const bed = this.bed(blockId);
    if (!bed || !this.guard()) return Promise.resolve(false);
    const w = Math.max(1, snap(widthFt));
    const l = Math.max(1, snap(lengthFt));
    const inTheWay = this.plantingsIn(blockId).filter(
      (p) =>
        p.footprint &&
        p.status !== 'harvested' &&
        p.status !== 'failed' &&
        p.status !== 'archived' &&
        (p.footprint.x_in + p.footprint.w_in > w * 12 + 1e-6 ||
          p.footprint.y_in + p.footprint.l_in > l * 12 + 1e-6)
    );
    if (inTheWay.length) {
      const names = [...new Set(inTheWay.map((p) => p.varietyDisplayName))].join(', ');
      this.warn(
        `${bed.name} can't get that small. ${names} would sit past the new edge. Move or shrink ${inTheWay.length === 1 ? 'it' : 'them'} first.`
      );
      return Promise.resolve(false);
    }
    const rect = clampToArea(bedRect(bed.rect.x, bed.rect.y, w, l, bed.rotationDeg), this.canvas);
    if (!rect) {
      this.warn(`${bed.name} can't be that big in this garden.`);
      return Promise.resolve(false);
    }
    return this.commitBed(
      { ...bed, widthFt: w, lengthFt: l, rect },
      bed,
      `${bed.name} is now ${ft(w)} by ${ft(l)} feet.`
    );
  }

  resizeBedRect(blockId: string, rect: RectFt): Promise<boolean> {
    const bed = this.bed(blockId);
    if (!bed) return Promise.resolve(false);
    const quarter = bed.rotationDeg === 90 || bed.rotationDeg === 270;
    const w = Math.max(1, snap(quarter ? rect.l : rect.w));
    const l = Math.max(1, snap(quarter ? rect.w : rect.l));
    return this.resizeBed(blockId, w, l);
  }

  renameBed(blockId: string, name: string): Promise<boolean> {
    const bed = this.bed(blockId);
    const clean = name.trim().slice(0, 120);
    if (!bed || !clean || clean === bed.name) return Promise.resolve(false);
    return this.commitBed({ ...bed, name: clean }, bed, `Renamed to ${clean}.`);
  }

  setBedStyle(blockId: string, style: NonNullable<BedLayout['bedStyle']>): Promise<boolean> {
    const bed = this.bed(blockId);
    if (!bed || bed.bedStyle === style) return Promise.resolve(false);
    return this.commitBed({ ...bed, bedStyle: style }, bed, `${bed.name} style saved.`);
  }

  async duplicateBed(blockId: string): Promise<void> {
    const bed = this.bed(blockId);
    if (!bed || !this.guard()) return;
    const spot = freeSpot(
      bed.widthFt,
      bed.lengthFt,
      bed.rotationDeg,
      this.beds,
      this.canvas,
      bed.rect,
      this.spotSpacing(bed.kind === 'container' ? 'container-5gal' : 'raised-4x8')
    );
    if (!spot) {
      this.warn('No room for a copy. Make the garden bigger or remove a bed.');
      return;
    }
    const name = nextBedName(this.beds, bed.kind);
    const tempId = `pending-${Date.now()}`;
    this.design.beds = [...this.design.beds, { ...bed, blockId: tempId, name, rect: spot }];
    try {
      const res = await this.request<{ block: { id: string } }>('/api/blocks', {
        method: 'POST',
        json: {
          fieldId: this.canvas.areaId,
          name,
          kind: bed.kind,
          bedStyle: bed.bedStyle ?? (bed.kind === 'container' ? 'container' : 'raised'),
          widthFt: bed.widthFt,
          lengthFt: bed.lengthFt,
          xFt: spot.x,
          yFt: spot.y,
          rotationDeg: bed.rotationDeg
        } satisfies BedCreateRequest
      });
      this.replaceBed(tempId, (b) => ({ ...b, blockId: res.block.id }));
      this.history[res.block.id] = [];
      this.selectedBedId = res.block.id;
      this.say(`${name} added next to ${bed.name}.`);
    } catch (e) {
      this.design.beds = this.design.beds.filter((b) => b.blockId !== tempId);
      this.fail(e);
    }
  }

  askDelete(blockId: string): void {
    if (!this.guard()) return;
    this.selectedBedId = blockId;
    this.confirmDeleteBedId = blockId;
  }

  async deleteBed(blockId: string): Promise<void> {
    const bed = this.bed(blockId);
    this.confirmDeleteBedId = null;
    if (!bed || !this.guard()) return;
    try {
      await this.request(`/api/blocks/${encodeURIComponent(blockId)}?ifEmpty=1`, {
        method: 'DELETE'
      });
      this.design.beds = this.design.beds.filter((b) => b.blockId !== blockId);
      this.design.plantings = this.design.plantings.filter((p) => p.blockId !== blockId);
      if (this.selectedBedId === blockId) this.selectBed(null);
      this.say(`${bed.name} deleted.`);
    } catch (e) {
      if (e instanceof WriteError && e.code === 'BED_HAS_RECORDS') {
        this.warn(
          `${bed.name} has records, so it stays. Delete it from the Plan page if you really mean it.`
        );
      } else {
        this.fail(e);
      }
    }
  }

  // ── Crops ──────────────────────────────────────────────────────────────

  openCropPanel(targetBedId: string | null = this.selectedBedId): void {
    this.cropPanelOpen = true;
    this.cropTargetBedId = targetBedId;
  }

  chooseCrop(choice: CropChoice): void {
    if (!this.guard()) return;
    if (choice.source === 'catalog') {
      this.recentPluginIds = [
        choice.pluginId,
        ...this.recentPluginIds.filter((id) => id !== choice.pluginId)
      ].slice(0, 8);
    }
    if (this.cropTargetBedId) {
      const target = this.cropTargetBedId;
      this.cropPanelOpen = false;
      void this.placeCrop(choice, target);
      return;
    }
    this.cropPanelOpen = false;
    this.mode = { kind: 'place-crop', crop: choice };
    this.say(`Tap a bed to place ${choice.label}.`);
  }

  /** Footprints on this bed that share time with `span`, other than
   *  `ignore`. Plantings not placed yet hold no spot. */
  private busyFootprints(
    blockId: string,
    span: Pick<OccupancyInterval, 'startMs' | 'endMs'>,
    ignore?: string
  ): Footprint[] {
    return this.intervals
      .filter(
        (i) => i.blockId === blockId && i.cropId !== ignore && intervalsOverlapInTime(i, span)
      )
      .map((i) => i.footprint)
      .filter((f): f is Footprint => f !== null);
  }

  private spanFor(pluginId: string, dateMs: number) {
    return plantingOccupancy(
      {
        cropId: '__new__',
        blockId: '__',
        cropPluginId: pluginId,
        status: 'planned',
        plantingDateMs: dateMs,
        harvestedAtMs: null,
        footprint: null
      },
      this.crop(pluginId),
      {
        firstFallFrostMs: this.design.frost.firstFallFrostMs,
        lastSpringFrostMs: this.design.frost.lastSpringFrostMs
      }
    )!;
  }

  /** Rotation warnings for `family` going into this bed on `dateMs`. From
   *  this season, only plantings that finished before that date count:
   *  crops sharing the bed at the same time are neighbours, not history. */
  rotationFor(
    blockId: string,
    family: string,
    ignoreCropId?: string,
    dateMs: number | null = this.dateMs
  ): RotationWarning[] {
    const bed = this.bed(blockId);
    if (!bed) return [];
    const startMs = dateMs != null ? utcDayStart(dateMs) : null;
    const past = (this.history[blockId] ?? []).filter((h) => {
      if (h.cropId === ignoreCropId) return false;
      if (h.seasonYear !== this.design.seasonYear) return true;
      if (startMs == null) return false;
      const iv = this.intervalById.get(h.cropId);
      if (iv) return iv.harvestEndMs <= startMs;
      if (h.harvestedAtMs != null) return h.harvestedAtMs <= startMs;
      return false;
    });
    return rotationWarnings(
      blockId,
      bed.name,
      past,
      family,
      this.design.seasonYear,
      this.lookbackByFamily
    );
  }

  historyFor(blockId: string): BedHistoryEntry[] {
    return bedHistory(this.history[blockId] ?? [], this.design.seasonYear);
  }

  async placeCrop(
    choice: CropChoice,
    blockId: string,
    at?: { xIn: number; yIn: number },
    forceDateMs?: number
  ): Promise<void> {
    const bed = this.bed(blockId);
    if (!bed || !this.guard()) return;
    this.conflict = null;
    const existing =
      choice.source === 'planting'
        ? this.design.plantings.find((p) => p.cropId === choice.cropId)
        : undefined;
    const pluginId = existing
      ? existing.cropPluginId
      : choice.source === 'catalog'
        ? choice.pluginId
        : '';
    const crop = this.crop(pluginId);
    if (!pluginId) return;
    if (existing && existing.blockId !== blockId && this.inGround(existing)) {
      this.warn(
        `${existing.varietyDisplayName} is already in the ground in ${this.bed(existing.blockId)?.name ?? 'its bed'}. Record a new planting instead.`
      );
      return;
    }
    let dateMs = forceDateMs ?? existing?.plantingDateMs ?? this.dateMs;
    let movedForWindow: string | null = null;
    if (!existing && forceDateMs === undefined && crop && this.outdoors) {
      const w = this.plantingWindowFor(pluginId);
      if (dateMs < w.startMs - WINDOW_GRACE_MS) {
        dateMs = w.startMs;
        movedForWindow = `${this.dateText(dateMs)}, ${
          w.startMs >= this.design.frost.lastSpringFrostMs
            ? 'after your last frost'
            : 'when its planting window opens'
        }`;
      } else if (dateMs > w.endMs + WINDOW_GRACE_MS && w.endMs >= w.startMs) {
        dateMs = w.endMs;
        movedForWindow = `${this.dateText(dateMs)}, the last date it can finish before frost`;
      }
    }
    const spacing = existing?.spacing ?? resolveSpacing(crop, 'square');
    const want =
      existing?.plantCount != null
        ? footprintForCount(existing.plantCount, spacing, bed.widthFt * 12)
        : { w_in: bed.widthFt * 12, l_in: Math.min(bed.lengthFt * 12, DEFAULT_CROP_LENGTH_IN) };
    const span = this.spanFor(pluginId, dateMs);
    const taken = this.busyFootprints(blockId, span, existing?.cropId);
    const fp = fitFootprint(bed, want, taken, at);
    const label = existing?.varietyDisplayName ?? choice.label;
    if (!fp) {
      const occ = bedOccupancyOn(bed, this.intervals, dateMs, this.range);
      const retry = occ.nextOpenMs;
      this.conflict = {
        text: `No room in ${bed.name} on ${shortDate(dateMs)}.${retry ? ` It opens ${shortDate(retry)}.` : ''}`,
        retryDateMs: retry,
        crop: choice,
        blockId,
        at
      };
      this.mode = { kind: 'idle' };
      this.warn(this.conflict.text);
      return;
    }
    this.mode = { kind: 'idle' };
    try {
      if (existing) {
        await this.writeFootprint(existing, {
          blockId,
          footprint: fp,
          spacingPattern: existing.spacing.pattern,
          plantingDateMs: existing.plantingDateMs === dateMs ? undefined : dateMs
        });
      } else {
        const created = await this.createPlantings([
          {
            blockId,
            cropPluginId: pluginId,
            varietyDisplayName: label.slice(0, 120),
            plantingDateMs: dateMs,
            footprint: fp,
            spacingPattern: 'square',
            source: 'manual'
          }
        ]);
        this.absorbCreated(created);
      }
      const placed = this.design.plantings.find(
        (p) =>
          p.blockId === blockId &&
          p.cropPluginId === pluginId &&
          p.footprint &&
          p.footprint.x_in === fp.x_in &&
          p.footprint.y_in === fp.y_in
      );
      if (placed) this.selectPlanting(placed.cropId);
      const warn = crop
        ? this.rotationFor(blockId, crop.cropFamily, placed?.cropId, dateMs)[0]
        : undefined;
      const when = movedForWindow ? ` for ${movedForWindow}` : '';
      this.say(
        `${label} placed in ${bed.name}${when}${placed?.plantCount ? `, ${plural(placed.plantCount, 'plant')}` : ''}.${warn ? ` ${warn.message}` : ''}`
      );
      if (utcDayStart(dateMs) !== this.dateMs) {
        this.jumpTo = {
          dateMs: utcDayStart(dateMs),
          text: `${label} starts ${this.dateText(dateMs)}.`
        };
      }
      if (placed) this.focusRequest = { kind: 'planting', id: placed.cropId, n: Date.now() };
    } catch (e) {
      this.fail(e);
    }
  }

  /** Creates `planned` plantings in beds as one batch: either every item
   *  saves or none does, so a retry never makes duplicates. */
  async createPlantings(items: PlantingCreateRequest['plantings']): Promise<PlacedPlanting[]> {
    const res = await this.request<PlantingCreateResponse>('/api/garden/plantings', {
      method: 'POST',
      json: { plantings: items } satisfies PlantingCreateRequest
    });
    return res.plantings;
  }

  absorbCreated(created: PlacedPlanting[]): void {
    for (const p of created) {
      const c = this.catalog.find((x) => x.pluginId === p.cropPluginId);
      if (c && !this.design.crops[p.cropPluginId]) {
        this.design.crops = { ...this.design.crops, [p.cropPluginId]: c };
      }
      (this.history[p.blockId] ??= []).push({
        cropId: p.cropId,
        cropPluginId: p.cropPluginId,
        varietyDisplayName: p.varietyDisplayName,
        cropFamily: p.cropFamily,
        archetype: c?.archetype ?? 'unknown',
        status: p.status,
        plantingDateMs: p.plantingDateMs,
        harvestedAtMs: p.harvestedAtMs,
        seasonYear:
          p.plantingDateMs != null
            ? new Date(p.plantingDateMs).getUTCFullYear()
            : this.design.seasonYear
      });
    }
    const ids = new Set(created.map((p) => p.cropId));
    this.design.plantings = [
      ...this.design.plantings.filter((p) => !ids.has(p.cropId)),
      ...created
    ];
  }

  private replacePlanting(next: PlacedPlanting): void {
    this.design.plantings = this.design.plantings.map((p) => (p.cropId === next.cropId ? next : p));
  }

  /** Optimistic footprint write; rolls back to the last saved state with
   *  the server's message. Writes for one planting run in order. */
  async writeFootprint(
    planting: PlacedPlanting,
    body: Omit<FootprintWriteRequest, 'spacingPattern'> & { spacingPattern?: SpacingPattern }
  ): Promise<FootprintWriteResponse | null> {
    if (!this.guard()) return null;
    const prev = planting;
    const pattern = body.spacingPattern ?? planting.spacing.pattern;
    const kept = planting.spacing.source === 'manual';
    const spacing = resolveSpacing(this.crop(planting.cropPluginId), pattern, {
      inRowIn:
        body.spacingIn !== undefined ? body.spacingIn : kept ? planting.spacing.inRowIn : null,
      rowIn:
        body.rowSpacingIn !== undefined ? body.rowSpacingIn : kept ? planting.spacing.rowIn : null
    });
    const fp = body.footprint === undefined ? planting.footprint : body.footprint;
    const count =
      body.plantCount != null
        ? { count: body.plantCount, provenance: 'manual' as const }
        : fp
          ? planting.plantCountProvenance === 'manual' && body.plantCount === undefined
            ? {
                count: planting.plantCount ?? plantCount(fp, spacing).count,
                provenance: 'manual' as const
              }
            : plantCount(fp, spacing)
          : null;
    this.replacePlanting({
      ...planting,
      blockId: body.blockId,
      footprint: fp,
      spacing: { ...planting.spacing, pattern },
      plantCount: count?.count ?? planting.plantCount,
      plantCountProvenance: count?.provenance ?? planting.plantCountProvenance,
      plantingDateMs: body.plantingDateMs ?? planting.plantingDateMs
    });
    const id = planting.cropId;
    const key = `crop:${id}`;
    if (!this.confirmedPlantings.has(id)) this.confirmedPlantings.set(id, prev);
    const { seq, done } = this.queueWrite(key, () =>
      this.request<FootprintWriteResponse>(`/api/crops/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        json: {
          action: 'set-placement',
          ...({ ...body, spacingPattern: pattern } satisfies FootprintWriteRequest)
        }
      })
    );
    try {
      const res = await done;
      if (this.isLatestWrite(key, seq)) {
        this.confirmedPlantings.delete(id);
        this.replacePlanting(res.planting);
      } else {
        this.confirmedPlantings.set(id, res.planting);
      }
      for (const f of res.followers ?? []) this.replacePlanting(f);
      for (const w of res.warnings ?? []) this.say(w);
      return res;
    } catch (e) {
      if (this.isLatestWrite(key, seq)) {
        const back = this.confirmedPlantings.get(id) ?? prev;
        this.confirmedPlantings.delete(id);
        this.replacePlanting(back);
      }
      this.fail(e);
      return null;
    }
  }

  setPlantingSize(cropId: string, wFt: number, lFt: number): Promise<unknown> {
    const p = this.design.plantings.find((q) => q.cropId === cropId);
    const bed = p ? this.bed(p.blockId) : undefined;
    if (!p || !bed || !p.footprint) return Promise.resolve(null);
    const fp = clampFootprint(
      { ...p.footprint, w_in: wFt * 12, l_in: lFt * 12 },
      bed,
      p.spacing.pattern === 'sfg'
    );
    return this.writeFootprint(p, {
      blockId: p.blockId,
      footprint: fp,
      spacingPattern: p.spacing.pattern
    });
  }

  setPlantingPattern(cropId: string, pattern: SpacingPattern): Promise<unknown> {
    const p = this.design.plantings.find((q) => q.cropId === cropId);
    if (!p || !p.footprint) return Promise.resolve(null);
    const bed = this.bed(p.blockId);
    const fp = bed ? clampFootprint(p.footprint, bed, pattern === 'sfg') : p.footprint;
    return this.writeFootprint(p, {
      blockId: p.blockId,
      footprint: fp,
      spacingPattern: pattern,
      plantCount: p.plantCountProvenance === 'manual' ? p.plantCount : undefined
    });
  }

  setPlantCount(cropId: string, count: number | null): Promise<unknown> {
    const p = this.design.plantings.find((q) => q.cropId === cropId);
    if (!p || !p.footprint) return Promise.resolve(null);
    return this.writeFootprint(p, {
      blockId: p.blockId,
      footprint: p.footprint,
      spacingPattern: p.spacing.pattern,
      plantCount: count
    });
  }

  /** Refuses dates outside the season's reach (a half-typed year), then
   *  saves and, when the planting now starts off the scrubbed date, offers
   *  to jump there so it doesn't seem to vanish. */
  async setPlantingDate(cropId: string, dateMs: number): Promise<unknown> {
    const p = this.design.plantings.find((q) => q.cropId === cropId);
    if (!p) return null;
    const year = new Date(dateMs).getUTCFullYear();
    if (Math.abs(year - this.design.seasonYear) > 1) {
      this.warn(`Pick a date near the ${this.design.seasonYear} season.`);
      return null;
    }
    const res = await this.writeFootprint(p, {
      blockId: p.blockId,
      footprint: p.footprint,
      spacingPattern: p.spacing.pattern,
      plantingDateMs: dateMs
    });
    if (res) {
      const iv = this.intervalById.get(cropId);
      const visible = iv ? this.dateMs >= iv.startMs && this.dateMs < iv.endMs : false;
      const text = `${p.varietyDisplayName} now starts ${this.dateText(dateMs)}.`;
      if (!visible) this.jumpTo = { dateMs: utcDayStart(dateMs), text };
      this.say(visible ? text : `${text} Slide to ${this.dateText(dateMs)} to see it.`);
    }
    return res;
  }

  removeFromBed(cropId: string): Promise<unknown> {
    const p = this.design.plantings.find((q) => q.cropId === cropId);
    if (!p) return Promise.resolve(null);
    this.selectedCropId = null;
    return this.writeFootprint(p, {
      blockId: p.blockId,
      footprint: null,
      spacingPattern: p.spacing.pattern
    });
  }

  startMovePlanting(cropId: string): void {
    if (!this.guard()) return;
    this.selectPlanting(cropId);
    this.mode = { kind: 'move-planting', cropId };
    const p = this.design.plantings.find((q) => q.cropId === cropId);
    this.say(`Tap where ${p?.varietyDisplayName ?? 'the planting'} should go.`);
  }

  async movePlantingTo(
    cropId: string,
    blockId: string,
    at: { xIn: number; yIn: number }
  ): Promise<void> {
    const p = this.design.plantings.find((q) => q.cropId === cropId);
    const bed = this.bed(blockId);
    this.mode = { kind: 'idle' };
    if (!p || !bed) return;
    if (p.blockId !== blockId && this.inGround(p)) {
      this.warn(
        `${p.varietyDisplayName} is already in the ground in ${this.bed(p.blockId)?.name ?? 'its bed'}. Record a new planting instead.`
      );
      return;
    }
    const size = p.footprint
      ? { w_in: p.footprint.w_in, l_in: p.footprint.l_in }
      : { w_in: bed.widthFt * 12, l_in: DEFAULT_CROP_LENGTH_IN };
    const fp = clampFootprint(
      {
        x_in: Math.max(0, snap(at.xIn - size.w_in / 2, FOOTPRINT_SNAP_IN)),
        y_in: Math.max(0, snap(at.yIn - size.l_in / 2, FOOTPRINT_SNAP_IN)),
        w_in: size.w_in,
        l_in: size.l_in
      },
      bed,
      p.spacing.pattern === 'sfg'
    );
    const res = await this.writeFootprint(p, {
      blockId,
      footprint: fp,
      spacingPattern: p.spacing.pattern
    });
    if (res)
      this.say(
        `${p.varietyDisplayName} moved.${this.sharesSpaceText(res.planting) ? ` ${this.sharesSpaceText(res.planting)}` : ''}`
      );
  }

  /** "Shares space with Lettuce until Jul 1." when a footprint overlaps
   *  another in both space and time. */
  sharesSpaceText(p: PlacedPlanting): string | null {
    const mine = this.intervalById.get(p.cropId);
    if (!mine || !p.footprint) return null;
    for (const other of this.design.plantings) {
      if (other.cropId === p.cropId || other.blockId !== p.blockId || !other.footprint) continue;
      const oi = this.intervalById.get(other.cropId);
      if (!oi || !intervalsOverlapInTime(mine, oi)) continue;
      if (footprintsOverlap(p.footprint, other.footprint)) {
        return `Shares space with ${other.varietyDisplayName} until ${shortDate(Math.min(mine.endMs, oi.endMs))}.`;
      }
    }
    return null;
  }

  // ── Canvas taps ────────────────────────────────────────────────────────

  async tap(point: PointFt, bedId: string | null, cropId: string | null): Promise<void> {
    const mode = this.mode;
    switch (mode.kind) {
      case 'place-bed':
        return this.placeBedAt(point);
      case 'move-bed':
        this.mode = { kind: 'idle' };
        await this.moveBedTo(mode.blockId, point.x, point.y);
        return;
      case 'place-crop': {
        if (!bedId) {
          this.say(`Tap a bed to place ${mode.crop.label}.`);
          return;
        }
        const bed = this.bed(bedId);
        const at = bed ? (pointInBedIn(point, bed) ?? undefined) : undefined;
        return this.placeCrop(mode.crop, bedId, at);
      }
      case 'move-planting': {
        if (!bedId) return;
        const bed = this.bed(bedId);
        const at = bed ? pointInBedIn(point, bed) : null;
        if (at) return this.movePlantingTo(mode.cropId, bedId, at);
        return;
      }
      case 'carry-bed':
        return this.drop();
      default:
        if (cropId) this.selectPlanting(cropId);
        else if (bedId) this.selectBed(bedId);
        else this.selectBed(null);
    }
  }

  // ── Succession and fill ────────────────────────────────────────────────

  previewSuccession(
    cropId: string,
    count: number,
    intervalDays?: number
  ): SuccessionProposal | null {
    const anchor = this.design.plantings.find((p) => p.cropId === cropId);
    const bed = anchor ? this.bed(anchor.blockId) : undefined;
    if (!anchor || !bed) return null;
    const proposal = proposeSuccession({
      anchor,
      crop: this.crop(anchor.cropPluginId),
      bed,
      count,
      intervalDays,
      intervals: this.intervals.filter((i) => i.blockId === bed.blockId),
      firstFallFrostMs: this.design.frost.firstFallFrostMs,
      lastSpringFrostMs: this.design.frost.lastSpringFrostMs,
      afterMs: this.seriesOf(anchor).reduce<number | null>(
        (m, q) =>
          q.plantingDateMs != null && (m == null || q.plantingDateMs > m) ? q.plantingDateMs : m,
        null
      )
    });
    this.ghosts = proposal.sowings
      .filter((s) => s.footprint && !s.conflict)
      .map((s) => ({
        key: `succ-${s.index}`,
        blockId: bed.blockId,
        footprint: s.footprint!,
        label: shortDate(s.plantingDateMs)
      }));
    return proposal;
  }

  /** Every sowing in a planting's succession series, first sowing first;
   *  empty when it isn't part of one. */
  seriesOf(p: Pick<PlacedPlanting, 'groupId' | 'groupSystemKind'>): PlacedPlanting[] {
    if (!p.groupId || p.groupSystemKind !== 'succession') return [];
    return this.design.plantings
      .filter((q) => q.groupId === p.groupId)
      .sort(
        (a, b) =>
          Number(b.groupRole === 'anchor') - Number(a.groupRole === 'anchor') ||
          (a.plantingDateMs ?? 0) - (b.plantingDateMs ?? 0)
      );
  }

  async commitSuccession(cropId: string, count: number, intervalDays?: number): Promise<boolean> {
    const anchor = this.design.plantings.find((p) => p.cropId === cropId);
    if (!anchor || !this.guard()) return false;
    try {
      const res = await this.request<SuccessionResponse>(
        `/api/garden/beds/${encodeURIComponent(anchor.blockId)}/succession`,
        { method: 'POST', json: { cropId, count, intervalDays, commit: true } }
      );
      this.absorbCreated(res.created);
      if (res.anchor) {
        this.replacePlanting(res.anchor);
      } else if (res.groupId) {
        this.replacePlanting({
          ...(this.design.plantings.find((p) => p.cropId === cropId) ?? anchor),
          groupId: res.groupId,
          groupSystemKind: 'succession',
          groupRole: 'anchor'
        });
      }
      this.ghosts = [];
      this.say(`${plural(res.created.length, 'sowing')} added.`);
      return true;
    } catch (e) {
      this.fail(e);
      return false;
    }
  }

  /** Recipes that fit the farm's frost-free season first, then the rest
   *  with the reason they may not. */
  recipeChoices(): Array<{ recipe: BedRecipePlugin; fit: RecipeFit }> {
    const days = frostFreeDays(
      this.design.frost.lastSpringFrostMs,
      this.design.frost.firstFallFrostMs
    );
    return this.recipes
      .map((recipe) => ({ recipe, fit: recipeFits(recipe, days) }))
      .sort(
        (a, b) =>
          Number(b.fit.fits) - Number(a.fit.fits) ||
          a.recipe.displayName.localeCompare(b.recipe.displayName)
      );
  }

  previewRecipe(blockId: string, recipePluginId: string) {
    const bed = this.bed(blockId);
    const recipe = this.recipes.find((r) => r.pluginId === recipePluginId);
    if (!bed || !recipe) return null;
    const crops: Record<string, GardenCrop> = {};
    for (const c of this.catalog) crops[c.pluginId] = c;
    const application = applyRecipe(recipe, {
      bed,
      crops,
      lastSpringFrostMs: this.design.frost.lastSpringFrostMs,
      firstFallFrostMs: this.design.frost.firstFallFrostMs,
      intervals: this.intervals.filter((i) => i.blockId === blockId),
      seasonYear: this.design.seasonYear
    });
    this.ghosts = application.plantings.map((p) => ({
      key: p.key,
      blockId,
      footprint: p.footprint,
      label: shortDate(p.plantingDateMs)
    }));
    return application;
  }

  async requestFill(blockId: string): Promise<FillResponse | null> {
    if (!this.guard()) return null;
    try {
      const res = await this.request<FillResponse>(
        `/api/garden/beds/${encodeURIComponent(blockId)}/fill`,
        {
          method: 'POST',
          json: { dateMs: this.dateMs, seasonYear: this.design.seasonYear }
        }
      );
      this.ghosts = res.proposals.map((p) => ({
        key: p.key,
        blockId: p.blockId,
        footprint: p.footprint,
        label: p.varietyDisplayName
      }));
      return res;
    } catch (e) {
      this.fail(e);
      return null;
    }
  }

  async acceptProposals(proposals: ProposedPlanting[]): Promise<boolean> {
    if (!proposals.length || !this.guard()) return false;
    try {
      const created = await this.createPlantings(
        proposals.map((p) => ({
          blockId: p.blockId,
          cropPluginId: p.cropPluginId,
          varietyDisplayName: p.varietyDisplayName.slice(0, 120),
          plantingDateMs: p.plantingDateMs,
          footprint: p.footprint,
          spacingPattern: p.spacing.pattern,
          spacingIn: p.spacing.source === 'manual' ? p.spacing.inRowIn : undefined,
          rowSpacingIn: p.spacing.source === 'manual' ? p.spacing.rowIn : undefined,
          source: p.provenance
        }))
      );
      this.absorbCreated(created);
      this.ghosts = [];
      this.say(`${plural(created.length, 'planting')} added.`);
      if (created[0]) {
        this.focusRequest = { kind: 'planting', id: created[0].cropId, n: Date.now() };
      }
      return true;
    } catch (e) {
      this.fail(e);
      return false;
    }
  }

  static readonly SNAP_FT = SNAP_FT;
}

export type { Rotation };

export const DESIGNER_KEY = Symbol('garden-designer');

export function setDesigner(state: DesignerState): DesignerState {
  return setContext(DESIGNER_KEY, state);
}

export function getDesigner(): DesignerState {
  return getContext<DesignerState>(DESIGNER_KEY);
}
