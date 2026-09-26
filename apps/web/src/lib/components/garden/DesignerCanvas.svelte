<script lang="ts">
  import { onMount } from 'svelte';
  import { footprintBounds, pointFt, rectFt, snap } from '$lib/garden/geometry';
  import { shortDate } from '$lib/garden/occupancy';
  import type { BedLayout, PlacedPlanting, PointFt, RectFt } from '$lib/garden/types';
  import { getDesigner } from './designerState.svelte';
  import {
    clampView,
    fitText,
    fitView,
    padRect,
    plantDots,
    textWidthFt,
    zoomView,
    type View
  } from './canvasMath';
  import { familyTone, ft, sizeLabel } from './format';

  const d = getDesigner();

  const DRAG_THRESHOLD_PX = 6;
  const HIT_PX = 48;
  const MIN_CHIP_PX = 8.5;

  let svg = $state<SVGSVGElement | null>(null);
  let viewportPx = $state(360);
  let viewportH = $state(0);
  let view = $state<View>(fitView(d.canvas.widthFt, d.canvas.lengthFt));
  const fit = $derived(fitView(d.canvas.widthFt, d.canvas.lengthFt));
  const pxPerFt = $derived(
    Math.min(viewportPx / view.w, viewportH > 0 ? viewportH / view.h : Infinity)
  );
  const fontFt = $derived(Math.max(0.25, 12 / pxPerFt));
  const hitFt = $derived(HIT_PX / pxPerFt);

  const orderedBeds = $derived(
    [...d.beds].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
  );

  type Drag =
    | { kind: 'pan'; startView: View; sx: number; sy: number }
    | { kind: 'bed'; blockId: string; origin: RectFt; start: PointFt }
    | { kind: 'bed-resize'; blockId: string; origin: RectFt; start: PointFt }
    | { kind: 'planting'; cropId: string; blockId: string; start: PointFt; origin: RectFt }
    | { kind: 'planting-resize'; cropId: string; start: PointFt; origin: RectFt };

  const pointers = new Map<number, { x: number; y: number }>();
  let down: {
    id: number;
    x: number;
    y: number;
    point: PointFt;
    bedId: string | null;
    cropId: string | null;
    handle: 'bed' | 'planting' | null;
  } | null = null;
  let drag: Drag | null = null;
  let pinch: { dist: number; view: View; mid: PointFt } | null = null;
  let plantingPreview = $state<{ cropId: string; rect: RectFt } | null>(null);

  export function zoomIn(): void {
    view = zoomView(view, 1.5, view.x + view.w / 2, view.y + view.h / 2, fit, viewportPx);
  }
  export function zoomOut(): void {
    view = zoomView(view, 1 / 1.5, view.x + view.w / 2, view.y + view.h / 2, fit, viewportPx);
  }
  export function fitAll(): void {
    view = fitView(d.canvas.widthFt, d.canvas.lengthFt);
  }

  onMount(() => {
    if (!svg) return;
    viewportPx = Math.max(1, svg.clientWidth || 360);
    viewportH = svg.clientHeight;
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (!svg) return;
      viewportPx = Math.max(1, svg.clientWidth || viewportPx);
      viewportH = svg.clientHeight;
    });
    ro.observe(svg);
    return () => ro.disconnect();
  });

  function toFt(clientX: number, clientY: number): PointFt {
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return pointFt(0, 0);
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return pointFt(p.x, p.y);
  }

  function targetOf(el: EventTarget | null): {
    bedId: string | null;
    cropId: string | null;
    handle: 'bed' | 'planting' | null;
  } {
    const node = el instanceof Element ? el : null;
    const handle = node?.closest('[data-handle]')?.getAttribute('data-handle') as
      'bed' | 'planting' | null;
    return {
      bedId: node?.closest('[data-bed-id]')?.getAttribute('data-bed-id') ?? null,
      cropId: node?.closest('[data-crop-id]')?.getAttribute('data-crop-id') ?? null,
      handle: handle ?? null
    };
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    svg?.setPointerCapture?.(e.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        view,
        mid: toFt((a.x + b.x) / 2, (a.y + b.y) / 2)
      };
      down = null;
      drag = null;
      return;
    }
    const t = targetOf(e.target);
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, point: toFt(e.clientX, e.clientY), ...t };
  }

  function startDrag(): Drag | null {
    if (!down) return null;
    const editable = d.canEdit && d.mode.kind === 'idle';
    if (editable && down.handle === 'bed' && down.bedId) {
      const bed = d.bed(down.bedId);
      if (bed)
        return { kind: 'bed-resize', blockId: bed.blockId, origin: bed.rect, start: down.point };
    }
    if (editable && down.handle === 'planting' && down.cropId) {
      const p = d.design.plantings.find((q) => q.cropId === down!.cropId);
      const bed = p ? d.bed(p.blockId) : undefined;
      if (p?.footprint && bed) {
        return {
          kind: 'planting-resize',
          cropId: p.cropId,
          start: down.point,
          origin: footprintBounds(p.footprint, bed)
        };
      }
    }
    if (editable && down.cropId && d.selectedCropId === down.cropId) {
      const p = d.design.plantings.find((q) => q.cropId === down!.cropId);
      const bed = p ? d.bed(p.blockId) : undefined;
      if (p?.footprint && bed) {
        return {
          kind: 'planting',
          cropId: p.cropId,
          blockId: bed.blockId,
          start: down.point,
          origin: footprintBounds(p.footprint, bed)
        };
      }
    }
    if (editable && down.bedId) {
      const bed = d.bed(down.bedId);
      if (bed) return { kind: 'bed', blockId: bed.blockId, origin: bed.rect, start: down.point };
    }
    return { kind: 'pan', startView: view, sx: down.x, sy: down.y };
  }

  function onPointerMove(e: PointerEvent): void {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.dist > 0) {
        view = zoomView(pinch.view, dist / pinch.dist, pinch.mid.x, pinch.mid.y, fit, viewportPx);
      }
      return;
    }
    if (!down || down.id !== e.pointerId) return;
    if (!drag) {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < DRAG_THRESHOLD_PX) return;
      drag = startDrag();
    }
    if (!drag) return;
    if (drag.kind === 'pan') {
      const k = 1 / pxPerFt;
      view = clampView(
        {
          ...drag.startView,
          x: drag.startView.x - (e.clientX - drag.sx) * k,
          y: drag.startView.y - (e.clientY - drag.sy) * k
        },
        fit
      );
      return;
    }
    const p = toFt(e.clientX, e.clientY);
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    if (drag.kind === 'bed') {
      const o = drag.origin;
      const x = Math.min(d.canvas.widthFt - o.w, Math.max(0, snap(o.x + dx)));
      const y = Math.min(d.canvas.lengthFt - o.l, Math.max(0, snap(o.y + dy)));
      d.preview = { blockId: drag.blockId, rect: rectFt(x, y, o.w, o.l) };
    } else if (drag.kind === 'bed-resize') {
      const o = drag.origin;
      const w = Math.max(1, Math.min(d.canvas.widthFt - o.x, snap(o.w + dx)));
      const l = Math.max(1, Math.min(d.canvas.lengthFt - o.y, snap(o.l + dy)));
      d.preview = { blockId: drag.blockId, rect: rectFt(o.x, o.y, w, l) };
    } else if (drag.kind === 'planting') {
      const o = drag.origin;
      plantingPreview = {
        cropId: drag.cropId,
        rect: rectFt(snap(o.x + dx), snap(o.y + dy), o.w, o.l)
      };
    } else if (drag.kind === 'planting-resize') {
      const o = drag.origin;
      plantingPreview = {
        cropId: drag.cropId,
        rect: rectFt(o.x, o.y, Math.max(0.5, snap(o.w + dx)), Math.max(0.5, snap(o.l + dy)))
      };
    }
  }

  async function onPointerUp(e: PointerEvent): Promise<void> {
    pointers.delete(e.pointerId);
    if (pinch) {
      if (pointers.size < 2) pinch = null;
      return;
    }
    if (!down || down.id !== e.pointerId) return;
    const was = down;
    const finished = drag;
    down = null;
    drag = null;
    if (!finished) {
      await d.tap(was.point, was.bedId, was.cropId);
      return;
    }
    if (finished.kind === 'bed' && d.preview) {
      const r = d.preview.rect;
      d.preview = null;
      await d.moveBedTo(finished.blockId, r.x, r.y);
    } else if (finished.kind === 'bed-resize' && d.preview) {
      const r = d.preview.rect;
      d.preview = null;
      await d.resizeBedRect(finished.blockId, r);
    } else if (finished.kind === 'planting' && plantingPreview) {
      const r = plantingPreview.rect;
      plantingPreview = null;
      const center = pointFt(r.x + r.w / 2, r.y + r.l / 2);
      const targetBed = [...d.beds]
        .reverse()
        .find(
          (b) =>
            center.x >= b.rect.x &&
            center.x <= b.rect.x + b.rect.w &&
            center.y >= b.rect.y &&
            center.y <= b.rect.y + b.rect.l
        );
      if (targetBed) {
        d.mode = { kind: 'move-planting', cropId: finished.cropId };
        await d.tap(center, targetBed.blockId, null);
      }
    } else if (finished.kind === 'planting-resize' && plantingPreview) {
      const r = plantingPreview.rect;
      plantingPreview = null;
      const p = d.design.plantings.find((q) => q.cropId === finished.cropId);
      const bed = p ? d.bed(p.blockId) : undefined;
      if (p && bed) {
        const quarter = bed.rotationDeg === 90 || bed.rotationDeg === 270;
        await d.setPlantingSize(p.cropId, quarter ? r.l : r.w, quarter ? r.w : r.l);
      }
    }
    d.preview = null;
  }

  function onPointerCancel(e: PointerEvent): void {
    pointers.delete(e.pointerId);
    pinch = null;
    down = null;
    drag = null;
    d.preview = null;
    plantingPreview = null;
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const p = toFt(e.clientX, e.clientY);
      view = zoomView(view, Math.exp(-e.deltaY / 300), p.x, p.y, fit, viewportPx);
      return;
    }
    const k = 1 / pxPerFt;
    view = clampView({ ...view, x: view.x + e.deltaX * k, y: view.y + e.deltaY * k }, fit);
  }

  function onBedKey(e: KeyboardEvent, bed: BedLayout): void {
    const carrying = d.mode.kind === 'carry-bed' && d.mode.blockId === bed.blockId;
    const step = e.shiftKey ? 5 : 0.5;
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step]
    };
    if (carrying) {
      if (e.key in arrows) {
        e.preventDefault();
        const [dx, dy] = arrows[e.key];
        d.carry(dx, dy);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        void d.drop();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        d.cancelMode();
      }
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (d.mode.kind !== 'idle' && d.mode.kind !== 'carry-bed') {
        const center = pointFt(bed.rect.x + bed.rect.w / 2, bed.rect.y + bed.rect.l / 2);
        void d.tap(center, bed.blockId, null);
      } else if (d.selectedBedId === bed.blockId && d.canEdit) {
        d.pickUp(bed.blockId);
      } else {
        d.selectBed(bed.blockId);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (d.mode.kind !== 'idle') d.cancelMode();
      else d.selectBed(null);
      return;
    }
    if (!d.canEdit) return;
    if (e.altKey && e.key in arrows) {
      e.preventDefault();
      const quarter = bed.rotationDeg === 90 || bed.rotationDeg === 270;
      const [dx, dy] = arrows[e.key].map((v) => Math.sign(v) * 0.5);
      const dw = quarter ? dy : dx;
      const dl = quarter ? dx : dy;
      void d.resizeBed(bed.blockId, bed.widthFt + dw, bed.lengthFt + dl);
      return;
    }
    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      void d.turnBed(bed.blockId);
    } else if (e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      void d.duplicateBed(bed.blockId);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      d.askDelete(bed.blockId);
    } else if (e.key === 'F2') {
      e.preventDefault();
      d.selectBed(bed.blockId);
      d.renameRequest++;
    }
  }

  function onPlantingKey(e: KeyboardEvent, p: PlacedPlanting): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      d.selectPlanting(p.cropId);
    }
  }

  function bedRectShown(bed: BedLayout): RectFt {
    return d.preview?.blockId === bed.blockId ? d.preview.rect : bed.rect;
  }

  function shown(p: PlacedPlanting): 'now' | 'later' | null {
    if (!p.footprint) return null;
    const i = d.intervalById.get(p.cropId);
    if (i && d.dateMs >= i.startMs && d.dateMs < i.endMs) return 'now';
    return d.wholeSeason ? 'later' : null;
  }

  function openChip(bed: BedLayout): string {
    const occ = d.occupancy.get(bed.blockId);
    if (!occ) return '';
    if (occ.occupants.length === 0) {
      return occ.openSinceMs != null ? `Open from ${shortDate(occ.openSinceMs)}` : 'Open';
    }
    return occ.nextOpenMs != null ? `Open from ${shortDate(occ.nextOpenMs)}` : 'Full';
  }

  /** Bed name bottom-left and its open chip bottom-right, or the chip on its
   *  own line above when both don't fit; each cut to the bed's width. */
  function bedLabels(bed: BedLayout, r: RectFt, unplaced: boolean) {
    const room = r.w - 0.3;
    const full = `${bed.name}${unplaced ? ' · Not placed yet' : ''}`;
    const long = openChip(bed);
    const short = long.replace('Open from ', 'Open ');
    const fits = (t: string) => textWidthFt(t, fontFt * 0.8) <= room;
    const sameLine = textWidthFt(full, fontFt) + textWidthFt(long, fontFt * 0.8) + 0.3 <= room;
    const ownLine = !sameLine && r.l > fontFt * 2.6;
    const chip = sameLine || fits(long) ? long : short;
    const minFont = MIN_CHIP_PX / pxPerFt;
    const chipFont = sameLine
      ? fontFt * 0.8
      : Math.max(minFont, Math.min(fontFt * 0.8, room / Math.max(1, textWidthFt(chip, 1))));
    return {
      name: fitText(full, room, fontFt),
      chip: sameLine || ownLine ? fitText(chip, room, chipFont) : '',
      chipFont,
      chipOwnLine: ownLine
    };
  }

  const gridLines = $derived.by(() => {
    const out: Array<{ x1: number; y1: number; x2: number; y2: number; major: boolean }> = [];
    const W = d.canvas.widthFt;
    const L = d.canvas.lengthFt;
    const minor = pxPerFt >= 8;
    for (let x = 0; x <= W + 1e-9; x += 1) {
      const major = Math.abs(x % 5) < 1e-9;
      if (major || minor) out.push({ x1: x, y1: 0, x2: x, y2: L, major });
    }
    for (let y = 0; y <= L + 1e-9; y += 1) {
      const major = Math.abs(y % 5) < 1e-9;
      if (major || minor) out.push({ x1: 0, y1: y, x2: W, y2: y, major });
    }
    return out;
  });
  const rulerStep = $derived(pxPerFt >= 24 ? 5 : pxPerFt >= 6 ? 10 : 20);
  const rulerX = $derived(
    Array.from({ length: Math.floor(d.canvas.widthFt / rulerStep) + 1 }, (_, i) => i * rulerStep)
  );
  const rulerY = $derived(
    Array.from({ length: Math.floor(d.canvas.lengthFt / rulerStep) + 1 }, (_, i) => i * rulerStep)
  );
  const placing = $derived(d.mode.kind !== 'idle');
</script>

<div class="canvas-wrap" class:placing>
  <svg
    bind:this={svg}
    class="designer-svg"
    data-testid="designer-canvas"
    viewBox="{view.x} {view.y} {view.w} {view.h}"
    preserveAspectRatio="xMidYMid meet"
    style:aspect-ratio="{fit.w} / {fit.h}"
    role="group"
    aria-label="{d.canvas.name} layout, {ft(d.canvas.widthFt)} by {ft(d.canvas.lengthFt)} feet"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerCancel}
    onwheel={onWheel}
  >
    <defs>
      <pattern
        id="free-hatch"
        patternUnits="userSpaceOnUse"
        width="0.5"
        height="0.5"
        patternTransform="rotate(45)"
      >
        <line x1="0" y1="0" x2="0" y2="0.5" class="hatch-line" />
      </pattern>
      {#each [0, 1, 2, 3, 4, 5] as t (t)}
        <pattern id="fam-{t}" patternUnits="userSpaceOnUse" width="1" height="1">
          <rect width="1" height="1" class="fam-bg fam-{t}" />
          {#if t % 3 === 1}
            <line x1="0" y1="0" x2="1" y2="1" class="fam-mark" />
          {:else if t % 3 === 2}
            <circle cx="0.5" cy="0.5" r="0.12" class="fam-mark-fill" />
          {/if}
        </pattern>
      {/each}
    </defs>

    <rect
      class="ground"
      data-testid="designer-ground"
      x="0"
      y="0"
      width={d.canvas.widthFt}
      height={d.canvas.lengthFt}
    />
    <g class="grid" aria-hidden="true">
      {#each gridLines as g, i (i)}
        <line
          x1={g.x1}
          y1={g.y1}
          x2={g.x2}
          y2={g.y2}
          class:major={g.major}
          vector-effect="non-scaling-stroke"
        />
      {/each}
    </g>
    <g class="rulers" aria-hidden="true" font-size={fontFt * 0.85}>
      {#each rulerX as x (x)}
        <text {x} y={-fontFt * 0.4} text-anchor="middle">{x}</text>
      {/each}
      {#each rulerY as y (y)}
        <text x={-fontFt * 0.3} y={y + fontFt * 0.3} text-anchor="end">{y}</text>
      {/each}
    </g>

    {#each d.design.landmarks ?? [] as m (m.id)}
      {#if m.rect}
        <g class="landmark" aria-label="{m.name}, landmark">
          <rect
            x={m.rect.x}
            y={m.rect.y}
            width={m.rect.w}
            height={m.rect.l}
            vector-effect="non-scaling-stroke"
          />
          <text x={m.rect.x + 0.2} y={m.rect.y + fontFt} font-size={fontFt}>{m.name}</text>
        </g>
      {/if}
    {/each}

    {#each orderedBeds as bed (bed.blockId)}
      {@const r = bedRectShown(bed)}
      {@const selected = d.selectedBedId === bed.blockId}
      {@const hit = padRect(r, hitFt)}
      {@const unplaced = d.unplaced.has(bed.blockId)}
      {@const carrying = d.mode.kind === 'carry-bed' && d.mode.blockId === bed.blockId}
      {@const labels = bedLabels(bed, r, unplaced)}
      <g
        class="bed"
        class:selected
        class:unplaced
        class:carrying
        class:container={bed.kind === 'container'}
        data-bed-id={bed.blockId}
        data-bed-name={bed.name}
        data-testid="bed"
        role="button"
        tabindex="0"
        aria-pressed={selected}
        aria-label={d.bedLabel(bed)}
        onkeydown={(e) => onBedKey(e, bed)}
        ondblclick={() => {
          d.selectBed(bed.blockId);
          d.renameRequest++;
        }}
      >
        <rect class="hit" x={hit.x} y={hit.y} width={hit.w} height={hit.h} />
        <rect
          class="bed-body"
          x={r.x}
          y={r.y}
          width={r.w}
          height={r.l}
          rx={bed.kind === 'container' ? Math.min(r.w, r.l) / 2 : 0.1}
          vector-effect="non-scaling-stroke"
        />
        {#if !d.preview || d.preview.blockId !== bed.blockId}
          {#each d.plantingsIn(bed.blockId) as p (p.cropId)}
            {@const when = shown(p)}
            {#if when && p.footprint}
              {@const pr =
                plantingPreview?.cropId === p.cropId
                  ? plantingPreview.rect
                  : footprintBounds(p.footprint, bed)}
              {@const stage = d.stageOf(p.cropId)}
              {@const psel = d.selectedCropId === p.cropId}
              <g
                class="planting {when}"
                class:psel
                data-crop-id={p.cropId}
                data-testid="footprint"
                role="button"
                tabindex={selected || psel ? 0 : -1}
                aria-label="{p.varietyDisplayName}{p.plantCount
                  ? `, ${p.plantCount} plants`
                  : ''}{stage ? `, ${stage.toLowerCase()}` : ''}"
                onkeydown={(e) => onPlantingKey(e, p)}
              >
                <rect
                  class="fp"
                  x={pr.x}
                  y={pr.y}
                  width={pr.w}
                  height={pr.l}
                  fill={when === 'now' ? `url(#fam-${familyTone(p.cropFamily)})` : 'none'}
                  vector-effect="non-scaling-stroke"
                />
                {#if when === 'now' && p.spacing}
                  {#each plantDots(p.footprint, bed, p.spacing) as [cx, cy], i (i)}
                    <circle class="dot" {cx} {cy} r={Math.min(0.18, pr.w / 6, pr.l / 6)} />
                  {/each}
                {/if}
                {#if pr.w * pxPerFt > 40 && pr.l * pxPerFt > 18}
                  <text class="fp-label" x={pr.x + 0.15} y={pr.y + fontFt} font-size={fontFt * 0.9}>
                    {fitText(
                      `${p.varietyDisplayName.split(/[—(]/)[0].trim()}${p.plantCount ? ` · ${p.plantCount}` : ''}`,
                      pr.w - 0.3,
                      fontFt * 0.9
                    )}
                  </text>
                  {#if stage && pr.l * pxPerFt > 34}
                    <text
                      class="stage"
                      x={pr.x + 0.15}
                      y={pr.y + fontFt * 2}
                      font-size={fontFt * 0.8}>{stage}</text
                    >
                  {/if}
                {/if}
                {#if psel && d.canEdit}
                  <rect
                    class="handle"
                    data-handle="planting"
                    x={pr.x + pr.w - hitFt / 4}
                    y={pr.y + pr.l - hitFt / 4}
                    width={hitFt / 2}
                    height={hitFt / 2}
                  />
                {/if}
              </g>
            {/if}
          {/each}
        {/if}
        {#each d.ghosts.filter((g) => g.blockId === bed.blockId) as g (g.key)}
          {@const gr = footprintBounds(g.footprint, bed)}
          <g class="ghost" aria-hidden="true">
            <rect x={gr.x} y={gr.y} width={gr.w} height={gr.l} vector-effect="non-scaling-stroke" />
            <text x={gr.x + 0.1} y={gr.y + fontFt} font-size={fontFt * 0.8}>{g.label}</text>
          </g>
        {/each}
        <text class="bed-name" x={r.x + 0.15} y={r.y + r.l - 0.2} font-size={fontFt}>
          {labels.name}
        </text>
        {#if labels.chip}
          <text
            class="open-chip"
            x={labels.chipOwnLine ? r.x + 0.15 : r.x + r.w - 0.15}
            y={labels.chipOwnLine ? r.y + r.l - 0.3 - fontFt : r.y + r.l - 0.2}
            text-anchor={labels.chipOwnLine ? 'start' : 'end'}
            font-size={labels.chipFont}>{labels.chip}</text
          >
        {/if}
        {#if selected && d.canEdit && d.mode.kind === 'idle'}
          <rect
            class="handle bed-handle"
            data-handle="bed"
            x={r.x + r.w - hitFt / 4}
            y={r.y + r.l - hitFt / 4}
            width={hitFt / 2}
            height={hitFt / 2}
          />
        {/if}
      </g>
    {/each}

    {#if d.canvas.hasNorth}
      <g
        class="north"
        aria-label="North is up"
        transform="translate({d.canvas.widthFt - fontFt}, {fontFt * 0.2})"
      >
        <path
          d="M0 {fontFt * 2} L{fontFt * 0.5} 0 L{fontFt} {fontFt * 2} Z"
          transform="translate({-fontFt * 0.5}, 0)"
        />
        <text y={fontFt * 3} text-anchor="middle" font-size={fontFt}>N</text>
      </g>
    {/if}
  </svg>
  {#if d.preview}
    <p class="drag-readout" aria-hidden="true">
      {ft(d.preview.rect.x)} ft from west · {ft(d.preview.rect.y)} ft from north · {sizeLabel(
        d.preview.rect.w,
        d.preview.rect.l
      )}
    </p>
  {/if}
</div>

<style>
  .canvas-wrap {
    position: relative;
    width: 100%;
    min-width: 0;
  }
  .designer-svg {
    display: block;
    width: 100%;
    max-height: 70vh;
    background: var(--color-cream);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .placing .designer-svg {
    cursor: crosshair;
  }
  .ground {
    fill: var(--color-paper);
  }
  .grid line {
    stroke: var(--color-divider-soft);
    stroke-width: 1;
  }
  .grid line.major {
    stroke: var(--color-divider);
  }
  .rulers text {
    fill: var(--color-ink-soft);
  }
  .landmark rect {
    fill: var(--color-wheat-soft);
    stroke: var(--color-ink-muted);
    stroke-dasharray: 4 3;
    opacity: 0.7;
  }
  .landmark text {
    fill: var(--color-ink-soft);
  }
  .hatch-line {
    stroke: var(--color-divider);
    stroke-width: 0.06;
  }
  .hit {
    fill: transparent;
  }
  .bed {
    cursor: pointer;
    outline: none;
  }
  .bed-body {
    fill: url(#free-hatch);
    stroke: var(--color-forest-deep);
    stroke-width: 2;
  }
  .bed.unplaced .bed-body {
    stroke-dasharray: 6 4;
  }
  .bed.selected .bed-body {
    stroke: var(--color-rust);
    stroke-width: 3;
  }
  .bed.carrying .bed-body {
    stroke-dasharray: 3 3;
  }
  .bed:focus-visible .bed-body {
    stroke: var(--color-sky);
    stroke-width: 4;
  }
  .bed-name {
    fill: var(--color-ink);
    font-weight: 700;
    pointer-events: none;
  }
  .open-chip {
    fill: var(--color-forest-deep);
    font-weight: 600;
    pointer-events: none;
  }
  .fam-bg.fam-0 {
    fill: #cfe3c4;
  }
  .fam-bg.fam-1 {
    fill: #f2d8b8;
  }
  .fam-bg.fam-2 {
    fill: #cfdff0;
  }
  .fam-bg.fam-3 {
    fill: #efd0d0;
  }
  .fam-bg.fam-4 {
    fill: #e6dcf2;
  }
  .fam-bg.fam-5 {
    fill: #efe8bf;
  }
  .fam-mark {
    stroke: rgba(0, 0, 0, 0.25);
    stroke-width: 0.05;
  }
  .fam-mark-fill {
    fill: rgba(0, 0, 0, 0.2);
  }
  .fp {
    stroke: var(--color-ink);
    stroke-width: 1.5;
  }
  .planting.later .fp {
    stroke: var(--color-ink-muted);
    stroke-dasharray: 3 3;
    opacity: 0.8;
  }
  .planting.psel .fp {
    stroke: var(--color-rust);
    stroke-width: 3;
  }
  .planting:focus-visible .fp {
    stroke: var(--color-sky);
    stroke-width: 4;
  }
  .planting {
    outline: none;
  }
  .dot {
    fill: var(--color-forest-deep);
    pointer-events: none;
  }
  .fp-label,
  .stage {
    fill: var(--color-ink);
    font-weight: 600;
    pointer-events: none;
  }
  .ghost rect {
    fill: none;
    stroke: var(--color-forest);
    stroke-width: 2;
    stroke-dasharray: 5 4;
  }
  .ghost text {
    fill: var(--color-forest-deep);
  }
  .handle {
    fill: var(--color-paper);
    stroke: var(--color-rust);
    stroke-width: 0.08;
    cursor: nwse-resize;
    display: none;
  }
  .north path {
    fill: var(--color-ink);
  }
  .north text {
    fill: var(--color-ink);
    font-weight: 700;
  }
  .drag-readout {
    position: absolute;
    left: var(--space-2);
    bottom: var(--space-2);
    margin: 0;
    padding: 2px var(--space-2);
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    font-size: var(--font-size-caption);
  }
  @media (min-width: 640px) and (pointer: fine), (min-width: 640px) and (hover: hover) {
    .handle {
      display: block;
    }
  }
  @media (prefers-reduced-motion: no-preference) {
    .bed-body,
    .fp {
      transition: stroke 0.12s;
    }
  }
</style>
