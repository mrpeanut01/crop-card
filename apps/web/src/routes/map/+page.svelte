<script lang="ts">
  let { data } = $props();

  type Pt = [number, number];
  type Ring = Pt[];

  function ringsFromGeojson(raw: string): Ring[] {
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const out: Ring[] = [];
      const collect = (geom: unknown) => {
        if (!geom || typeof geom !== 'object') return;
        const g = geom as { type?: string; coordinates?: unknown };
        if (g.type === 'Polygon' && Array.isArray(g.coordinates)) {
          for (const ring of g.coordinates as unknown[]) {
            if (Array.isArray(ring)) out.push(ring as Ring);
          }
        } else if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
          for (const poly of g.coordinates as unknown[][]) {
            for (const ring of poly) {
              if (Array.isArray(ring)) out.push(ring as Ring);
            }
          }
        }
      };
      if (typeof obj.type === 'string') {
        if (obj.type === 'Feature') collect((obj as { geometry?: unknown }).geometry);
        else if (obj.type === 'FeatureCollection' && Array.isArray(obj.features)) {
          for (const f of obj.features) collect((f as { geometry?: unknown }).geometry);
        } else collect(obj);
      }
      return out;
    } catch {
      return [];
    }
  }

  // Build a single SVG viewport spanning all polygons.
  const polygons = data.blocks
    .map((b) => ({ block: b, rings: b.geometryGeojson ? ringsFromGeojson(b.geometryGeojson) : [] }))
    .filter((p) => p.rings.length > 0);

  const allPts = polygons.flatMap((p) => p.rings.flat());
  const xs = allPts.map((pt) => pt[0]);
  const ys = allPts.map((pt) => pt[1]);
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = xs.length ? Math.max(...xs) : 1;
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxY = ys.length ? Math.max(...ys) : 1;
  const w = Math.max(maxX - minX, 1e-6);
  const h = Math.max(maxY - minY, 1e-6);
  const VIEW_W = 800;
  const VIEW_H = 600;
  // Lon → x, Lat → y (flip y).
  const sx = (x: number) => ((x - minX) / w) * VIEW_W;
  const sy = (y: number) => VIEW_H - ((y - minY) / h) * VIEW_H;

  function pathOf(rings: Ring[]): string {
    return rings
      .map((ring) => {
        const pts = ring.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(' L ');
        return `M ${pts} Z`;
      })
      .join(' ');
  }

  let pasteBlockId = $state(data.blocks[0]?.id ?? '');
  let pasteText = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let message = $state<string | null>(null);

  async function savePaste(e: Event) {
    e.preventDefault();
    busy = true;
    error = null;
    message = null;
    try {
      const parsed = JSON.parse(pasteText);
      const res = await fetch(`/api/blocks/${encodeURIComponent(pasteBlockId)}/geometry`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed)
      });
      const out = await res.json();
      if (!res.ok) {
        error = out.error ?? 'failed';
        return;
      }
      message = 'Geometry saved. Refreshing…';
      setTimeout(() => window.location.reload(), 600);
    } catch (e2) {
      error = e2 instanceof Error ? e2.message : String(e2);
    } finally {
      busy = false;
    }
  }
</script>

<h1>Map</h1>
<p class="lede">
  Field-mapping stub. Paste a GeoJSON polygon below to attach it to a block, or skip — the rest of
  CropCard works without geometry. The renderer below uses raw SVG (no PostGIS, no tile providers)
  so it works fully offline.
</p>

{#if polygons.length === 0}
  <section class="card empty">
    <p>No block geometry yet. Paste GeoJSON below to map your first field.</p>
  </section>
{:else}
  <section class="card">
    <h2>Field overview</h2>
    <svg
      viewBox="0 0 {VIEW_W} {VIEW_H}"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Field map"
    >
      {#each polygons as p (p.block.id)}
        <path d={pathOf(p.rings)} fill="rgba(31, 94, 58, 0.18)" stroke="#1f5e3a" stroke-width="2" />
        {#if p.rings[0]?.length}
          <text
            x={sx(p.rings[0].reduce((acc, pt) => acc + pt[0], 0) / p.rings[0].length)}
            y={sy(p.rings[0].reduce((acc, pt) => acc + pt[1], 0) / p.rings[0].length)}
            font-size="14"
            text-anchor="middle"
            fill="#1f5e3a"
          >
            {p.block.name}
          </text>
        {/if}
      {/each}
    </svg>
  </section>
{/if}

<section class="card">
  <h2>Attach geometry to a block</h2>
  <form on:submit={savePaste}>
    <label>
      Block
      <select bind:value={pasteBlockId}>
        {#each data.blocks as b (b.id)}
          <option value={b.id}>
            {b.name}{b.geometryGeojson ? ' (has geometry)' : ''}
          </option>
        {/each}
      </select>
    </label>
    <label>
      GeoJSON
      <textarea
        bind:value={pasteText}
        rows="8"
        placeholder={'{"type":"Polygon","coordinates":[[[-77.6,39.1],[-77.6,39.11],[-77.59,39.11],[-77.59,39.1],[-77.6,39.1]]]}'}
      ></textarea>
    </label>
    <button type="submit" class="primary" disabled={busy || !pasteText.trim()}>
      {busy ? 'Saving…' : 'Save geometry'}
    </button>
  </form>
  {#if message}<p class="success">{message}</p>{/if}
  {#if error}<p class="error">{error}</p>{/if}
</section>

<section class="card">
  <h2>Block list</h2>
  <ul>
    {#each data.blocks as b (b.id)}
      <li>
        <strong>{b.name}</strong>
        {#if b.acres !== null}
          — {b.acres} acres{/if}
        — {b.plantingsCount} planting{b.plantingsCount === 1 ? '' : 's'}
        {b.geometryGeojson ? '· geometry ✓' : '· no geometry'}
      </li>
    {/each}
  </ul>
</section>

<style>
  .card {
    background: white;
    padding: 1.25rem;
    border-radius: 8px;
    margin-bottom: 1rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .card.empty {
    background: #fff8e1;
    border-left: 4px solid #b35900;
  }
  .lede {
    color: #555;
  }
  svg {
    width: 100%;
    height: auto;
    background: #f5f7f4;
    border: 1px solid #d0d7d0;
    border-radius: 4px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.9rem;
    margin-bottom: 0.75rem;
  }
  textarea,
  select {
    padding: 0.55rem;
    border: 2px solid #d0d7d0;
    border-radius: 4px;
    font-size: 0.95rem;
    font-family: ui-monospace, Menlo, Monaco, monospace;
    min-height: 48px;
  }
  .primary {
    background: #1f5e3a;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.7rem 1.2rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 48px;
  }
  .primary:disabled {
    background: #999;
  }
  .success {
    background: #e7f1ea;
    color: #1f5e3a;
    padding: 0.6rem;
    border-radius: 4px;
  }
  .error {
    background: #fce4e4;
    color: #b00020;
    padding: 0.6rem;
    border-radius: 4px;
  }
</style>
