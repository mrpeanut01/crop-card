<script lang="ts">
  /**
   * Phase 25b (#81) — Plan v2 map overlay.
   *
   * 1:1 port of the `{showMap && (…)}` block in
   * [`direction-almanac-plan-v2.jsx`](../../../../docs/design/almanac/direction-almanac-plan-v2.jsx)
   * (lines 334–384). A lightweight pictorial spatial view inside the
   * shared Modal primitive — block rectangles laid out by their
   * geometry centroid (or row/col ordering), each clickable to jump
   * the parent Plan v2 page to that block.
   *
   * Intentionally NOT wrapping the full `BlockMap` editor — that's the
   * dedicated /plan?tab=layout surface (linked in the footer hint).
   * This overlay is a quick "where am I?" view, not a geometry editor.
   *
   * URL-driven: parent toggles `open` from `?map=open` so the overlay
   * survives a refresh and can be deep-linked.
   */
  import { ArrowRight, Info, Compass, MapPin } from 'lucide-svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import type { BlockWithPlantings } from '$lib/db/blocks';

  /** Inline geometry centroid (mirrors `geometryCentroid` in lib/db/blocks.ts).
   *  Lives here because `$lib/db/blocks` pulls in drizzle + better-sqlite3 +
   *  node:crypto, which would crash the browser bundle. */
  function centroidFromGeoJson(geojson: string | undefined): { lat: number; lon: number } | null {
    if (!geojson) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(geojson);
    } catch {
      return null;
    }
    const coords = extractOuterRing(parsed);
    if (!coords || coords.length === 0) return null;
    let sumLon = 0;
    let sumLat = 0;
    for (const [lon, lat] of coords) {
      sumLon += lon;
      sumLat += lat;
    }
    return { lon: sumLon / coords.length, lat: sumLat / coords.length };
  }
  function extractOuterRing(parsed: unknown): Array<[number, number]> | null {
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as { type?: string; coordinates?: unknown };
    if (obj.type === 'Polygon' && Array.isArray(obj.coordinates) && obj.coordinates[0]) {
      return obj.coordinates[0] as Array<[number, number]>;
    }
    if (obj.type === 'MultiPolygon' && Array.isArray(obj.coordinates) && obj.coordinates[0]?.[0]) {
      return obj.coordinates[0][0] as Array<[number, number]>;
    }
    return null;
  }

  interface Props {
    open: boolean;
    onClose: () => void;
    blocks: BlockWithPlantings[];
    /** Currently-selected block; renders highlighted on the map and in the
     *  title. */
    selectedBlockId?: string;
    /** Farm name; shows in the modal title. */
    farmLabel?: string;
    /** Optional handler — when the user taps a block on the map, the
     *  parent updates `?block=…` and closes the overlay. */
    onSelect?: (blockId: string) => void;
  }
  const { open, onClose, blocks, selectedBlockId, farmLabel, onSelect }: Props = $props();

  const selected = $derived(blocks.find((b) => b.id === selectedBlockId));
  const titleText = $derived(
    `${farmLabel ?? 'Field map'}${selected ? ` · ${selected.name} highlighted` : ''}`
  );

  // Compute pictorial positions: try geometry centroids first (normalise
  // to 0..1 across the farm), fall back to a grid layout for blocks
  // without geometry. The output is `{id, leftPct, topPct, wPct, hPct}`.
  type Pos = {
    id: string;
    leftPct: number;
    topPct: number;
    wPct: number;
    hPct: number;
    color: string;
    label: string;
    plantingCount: number;
  };
  const positions = $derived.by<Pos[]>(() => {
    const withGeom: Array<{ b: BlockWithPlantings; c: { lat: number; lon: number } }> = [];
    const noGeom: BlockWithPlantings[] = [];
    for (const b of blocks) {
      const c = centroidFromGeoJson(b.geometryGeojson);
      if (c) withGeom.push({ b, c });
      else noGeom.push(b);
    }

    let minLon = Infinity,
      maxLon = -Infinity,
      minLat = Infinity,
      maxLat = -Infinity;
    for (const { c } of withGeom) {
      minLon = Math.min(minLon, c.lon);
      maxLon = Math.max(maxLon, c.lon);
      minLat = Math.min(minLat, c.lat);
      maxLat = Math.max(maxLat, c.lat);
    }
    const lonRange = maxLon - minLon || 1;
    const latRange = maxLat - minLat || 1;

    const out: Pos[] = [];
    for (const { b, c } of withGeom) {
      // Normalise into 0..100% with 10% margin so blocks don't hit the edge.
      const x = ((c.lon - minLon) / lonRange) * 80 + 10;
      const y = (1 - (c.lat - minLat) / latRange) * 80 + 10; // invert: high lat = top
      // Block-area-scaled box (capped between 6% and 18% on each axis).
      const acres = b.acres ?? 0.5;
      const size = Math.min(18, Math.max(6, Math.sqrt(acres) * 8));
      out.push({
        id: b.id,
        leftPct: x - size / 2,
        topPct: y - size / 2,
        wPct: size,
        hPct: size,
        color: colorForBlock(b),
        label: b.name,
        plantingCount: b.plantings.length
      });
    }
    // Lay out the no-geometry blocks in a row at the bottom-right.
    const cols = Math.max(1, Math.ceil(Math.sqrt(noGeom.length)));
    noGeom.forEach((b, i) => {
      const r = Math.floor(i / cols);
      const col = i % cols;
      out.push({
        id: b.id,
        leftPct: 5 + col * 14,
        topPct: 85 - r * 14,
        wPct: 11,
        hPct: 11,
        color: colorForBlock(b),
        label: b.name,
        plantingCount: b.plantings.length
      });
    });
    return out;
  });

  function colorForBlock(b: BlockWithPlantings): string {
    // Hash block id → stable accent palette pulled from the Almanac tokens
    // (forest / wheat / sky / rust / olive / grape).
    const PALETTE = ['#7a8f5a', '#c9961f', '#6f8fa8', '#a85a1f', '#4a8b54', '#a23a3a'];
    let h = 0;
    for (let i = 0; i < b.id.length; i++) h = (h * 31 + b.id.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }
</script>

<Modal {open} {onClose} title={titleText}>
  <div class="map-shell">
    {#if blocks.length === 0}
      <div class="empty">
        <MapPin size={20} />
        <p>No blocks yet. Add one in the workflow strip or via the layout editor.</p>
      </div>
    {:else}
      <div class="map-canvas" role="img" aria-label="Block layout overview">
        <div class="compass" title="North">
          <Compass size={11} />
          <span class="mono">N</span>
        </div>
        {#each positions as p (p.id)}
          {@const isSel = p.id === selectedBlockId}
          <button
            class="map-block"
            class:selected={isSel}
            style:left="{p.leftPct}%"
            style:top="{p.topPct}%"
            style:width="{p.wPct}%"
            style:height="{p.hPct}%"
            style:background={p.color}
            onclick={() => {
              onSelect?.(p.id);
              onClose();
            }}
            title="{p.label} · {p.plantingCount} planting{p.plantingCount === 1 ? '' : 's'}"
          >
            <span class="mb-label">{p.label}</span>
            <span class="mb-meta mono">{p.plantingCount}× planting</span>
          </button>
        {/each}
      </div>
      <div class="footer-hint">
        <Info size={13} />
        <p>
          Click any block to jump there in Plan. The dedicated
          <a href="/settings/farm/map">fields & blocks editor</a> in Settings has soil zones, irrigation,
          and pesticide-buffer overlays.
        </p>
      </div>
    {/if}
  </div>
  {#snippet footer()}
    <a class="ghost" href="/settings/farm/map" onclick={onClose}>
      Open fields & blocks editor <ArrowRight size={13} />
    </a>
  {/snippet}
</Modal>

<style>
  .map-shell {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 24px;
    color: var(--color-ink-muted);
    text-align: center;
  }
  .empty p {
    margin: 0;
    font-size: 13px;
  }
  .map-canvas {
    position: relative;
    aspect-ratio: 2.4 / 1;
    width: 100%;
    background: linear-gradient(180deg, #e6e1cb 0%, #dad3b5 100%);
    border: 1px solid var(--color-divider);
    border-radius: 8px;
    overflow: hidden;
  }
  .compass {
    position: absolute;
    top: 10px;
    left: 10px;
    z-index: 2;
    background: var(--color-paper);
    padding: 4px 9px;
    border-radius: 4px;
    font-size: 10px;
    color: var(--color-ink-soft);
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 4px;
    border: 1px solid var(--color-divider);
  }
  .map-block {
    position: absolute;
    border-radius: 4px;
    border: 1px solid rgba(0, 0, 0, 0.15);
    color: white;
    padding: 6px 8px;
    cursor: pointer;
    font-family: inherit;
    font-weight: 700;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-start;
    opacity: 0.6;
    transition:
      opacity 80ms ease,
      transform 80ms ease;
    min-width: 60px;
    min-height: 40px;
    text-align: left;
    overflow: hidden;
  }
  .map-block:hover {
    opacity: 0.9;
  }
  .map-block.selected {
    opacity: 1;
    border: 3px solid var(--color-ink);
    z-index: 3;
  }
  .mb-label {
    font-size: 12px;
    line-height: 1.1;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  }
  .mb-meta {
    font-size: 9.5px;
    font-weight: 500;
    opacity: 0.9;
    margin-top: 1px;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  }
  .footer-hint {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    border-top: 1px dashed var(--color-divider-soft, var(--color-divider));
    padding-top: 10px;
    font-size: 12.5px;
    color: var(--color-ink-muted);
  }
  .footer-hint :global(svg) {
    margin-top: 2px;
    flex-shrink: 0;
  }
  .footer-hint p {
    margin: 0;
    line-height: 1.45;
  }
  .footer-hint a {
    color: var(--color-forest);
    text-decoration: none;
    font-weight: 600;
  }
  .footer-hint a:hover {
    text-decoration: underline;
  }
  .ghost {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: transparent;
    color: var(--color-forest-deep);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    text-decoration: none;
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
  }
  .ghost:hover {
    border-color: var(--color-forest-deep);
  }
</style>
