<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { page } from '$app/state';
  import Hint from '$lib/components/ui/Hint.svelte';
  import DesignerCanvas from '$lib/components/garden/DesignerCanvas.svelte';
  import DesignerToolbar from '$lib/components/garden/DesignerToolbar.svelte';
  import DesignerListView from '$lib/components/garden/DesignerListView.svelte';
  import CropPanel from '$lib/components/garden/CropPanel.svelte';
  import BedInspector from '$lib/components/garden/BedInspector.svelte';
  import TimeScrubber from '$lib/components/garden/TimeScrubber.svelte';
  import { DesignerState, setDesigner } from '$lib/components/garden/designerState.svelte';
  import { ft, longDate, parseYmd, plural, ymd } from '$lib/components/garden/format';
  import { loadSnapshot } from '$lib/client/cardStore';
  import { designFromSnapshot } from '$lib/garden/design';
  import { shortDate } from '$lib/garden/occupancy';
  import { AREA_KIND_LABELS } from '$lib/farm/areaKinds';
  import { cardHref, cardKey } from '$lib/cards/model';
  import { DEFAULT_PREFS, formatInstant } from '$lib/prefs';

  const { data } = $props();

  const VIEW_KEY = 'cropcard.designer.view';

  const d = setDesigner(
    untrack(
      () =>
        new DesignerState({
          design: data.design,
          history: data.history,
          catalog: data.catalog,
          companions: data.companions,
          lookbackByFamily: data.lookbackByFamily,
          recipes: data.recipes,
          areaKind: data.areaKind,
          canEdit: data.canEdit,
          initialDateMs: parseYmd(page.url.searchParams.get('on')),
          initialBedId: page.url.searchParams.get('bed')
        })
    )
  );

  let canvasRef = $state<{ zoomIn(): void; zoomOut(): void; fitAll(): void } | null>(null);
  let customOpen = $state(false);
  let customW = $state(4);
  let customL = $state(4);

  const areaName = $derived(d.canvas.name);
  const areaCardHref = $derived(cardHref('area', cardKey('area', d.canvas.areaId)));
  const sizeText = $derived(`${ft(d.canvas.widthFt)}×${ft(d.canvas.lengthFt)} ft`);
  const printDate = $derived(`${longDate(d.dateMs)}, ${new Date(d.dateMs).getUTCFullYear()}`);
  const legend = $derived(
    [...d.beds]
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
      .map((bed) => {
        const occ = d.occupancy.get(bed.blockId);
        const rows = (occ?.occupants ?? []).map((o) => {
          const p = d.design.plantings.find((q) => q.cropId === o.cropId);
          const count = p?.plantCount ? `, ${plural(p.plantCount, 'plant')}` : '';
          return `${p?.varietyDisplayName ?? 'Planting'}${count}, ${shortDate(o.startMs)} to ${shortDate(o.harvestEndMs)}`;
        });
        return { id: bed.blockId, name: bed.name, rows };
      })
  );

  function seasonHref(year: number): string {
    const url = new URL(page.url);
    url.searchParams.set('season', String(year));
    url.searchParams.delete('on');
    return `${url.pathname}${url.search}`;
  }
  const asOfText = $derived(formatInstant(d.design.asOf, DEFAULT_PREFS, 'datetime'));

  onMount(() => {
    const fromUrl = page.url.searchParams.get('view');
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(VIEW_KEY);
    } catch {
      stored = null;
    }
    if (fromUrl === 'list' || fromUrl === 'canvas') d.view = fromUrl;
    else if (stored === 'list' || stored === 'canvas') d.view = stored;
    else if (window.innerWidth < 320) d.view = 'list';

    const goOffline = () => {
      d.offline = true;
      void useSnapshotIfNewer();
    };
    const goOnline = () => (d.offline = false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    if (!navigator.onLine) goOffline();
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  });

  async function useSnapshotIfNewer(): Promise<void> {
    try {
      const row = await loadSnapshot();
      if (!row || row.bundle.generatedAt <= d.design.asOf) return;
      const fromSnapshot = designFromSnapshot(row.bundle, d.canvas.areaId, {
        seasonYear: d.design.seasonYear,
        readOnlyReason: 'offline'
      });
      if (fromSnapshot) d.design = { ...fromSnapshot, landmarks: d.design.landmarks };
    } catch {
      /* no snapshot store in this browser: keep the page's own copy */
    }
  }

  function setView(v: 'canvas' | 'list'): void {
    d.view = v;
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* private mode: the toggle still works for this visit */
    }
  }

  let summaryTimer: ReturnType<typeof setTimeout> | null = null;
  function onScrub(ms: number): void {
    d.setDate(ms);
    if (summaryTimer) clearTimeout(summaryTimer);
    summaryTimer = setTimeout(() => d.say(d.dateSummary()), 500);
  }

  function onGlobalKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (d.mode.kind !== 'idle') d.cancelMode();
    else if (d.cropPanelOpen) d.cropPanelOpen = false;
  }

  async function print(): Promise<void> {
    const on = ymd(d.dateMs);
    const url = new URL(page.url);
    url.searchParams.set('on', on);
    history.replaceState(history.state, '', url);
    if (d.view === 'canvas') canvasRef?.fitAll();
    await tick();
    window.print();
  }

  $effect(() => {
    const req = d.focusRequest;
    if (!req) return;
    void tick().then(() => {
      const selectors =
        req.kind === 'planting'
          ? [
              `[data-testid="footprint"][data-crop-id="${CSS.escape(req.id)}"]`,
              `[data-planting-row-id="${CSS.escape(req.id)}"]`
            ]
          : [
              `[data-testid="bed"][data-bed-id="${CSS.escape(req.id)}"]`,
              `[data-testid="list-bed"] [aria-controls="list-${CSS.escape(req.id)}"]`
            ];
      for (const sel of selectors) {
        const el = document.querySelector<HTMLElement | SVGElement>(sel);
        if (el && el.getClientRects().length) {
          el.focus({ preventScroll: false });
          return;
        }
      }
    });
  });
</script>

<svelte:head><title>{areaName} designer · CropCard</title></svelte:head>
<svelte:window onkeydown={onGlobalKey} />

<div class="designer" data-testid="garden-designer" data-season-year={d.design.seasonYear}>
  <header class="top">
    <div class="title">
      <p class="kicker">
        {AREA_KIND_LABELS[data.areaKind]} · {sizeText} · {d.design.seasonYear} season
      </p>
      <h1 class="serif">{areaName}</h1>
      <p class="print-only print-head">On {printDate}</p>
    </div>
    <div class="head-actions">
      <div class="seg" role="group" aria-label="View">
        <button type="button" aria-pressed={d.view === 'canvas'} onclick={() => setView('canvas')}
          >Canvas</button
        >
        <button type="button" aria-pressed={d.view === 'list'} onclick={() => setView('list')}
          >List</button
        >
      </div>
      {#if data.seasons.length > 1}
        <nav class="seg" aria-label="Season">
          {#each data.seasons as y (y)}
            <a
              class="seg-link"
              href={seasonHref(y)}
              data-sveltekit-reload
              aria-current={y === d.design.seasonYear ? 'page' : undefined}>{y}</a
            >
          {/each}
        </nav>
      {/if}
      <a class="hbtn" href={areaCardHref}>Area Card</a>
      <button type="button" class="hbtn" onclick={print}>Print</button>
    </div>
  </header>

  {#if d.offline}
    <div class="banner warn" data-testid="offline-banner">
      You're offline. This layout is from {asOfText}. Editing needs a connection.
    </div>
  {:else if !data.canEdit}
    <div class="banner" data-testid="readonly-banner">
      View only. The farm owner changes the layout.
    </div>
  {/if}
  {#if d.canvas.source === 'default'}
    <div class="banner">
      This garden has no Size yet, so beds are drawn on a {ft(d.canvas.widthFt)} by {ft(
        d.canvas.lengthFt
      )} foot grid.
      <a class="hbtn" href="/plan/farm">Set its Size in Draw your farm</a>
    </div>
  {/if}

  <div class="sticky">
    <TimeScrubber
      range={d.range}
      value={d.dateMs}
      changeDays={d.changeDays}
      lastSpringFrostMs={d.design.frost.lastSpringFrostMs}
      firstFallFrostMs={d.design.frost.firstFallFrostMs}
      wholeSeason={d.wholeSeason}
      seasonYear={d.design.seasonYear}
      todayInRange={d.todayInRange}
      onchange={onScrub}
      onwholeseason={(on) => (d.wholeSeason = on)}
    />
  </div>

  {#if d.jumpTo}
    {@const j = d.jumpTo}
    <div class="banner" data-testid="jump-to">
      <span>{j.text}</span>
      <button type="button" class="hbtn" onclick={() => onScrub(j.dateMs)}
        >Go to {shortDate(j.dateMs)}</button
      >
      <button type="button" class="hbtn" onclick={() => (d.jumpTo = null)}>Dismiss</button>
    </div>
  {/if}

  {#if d.conflict}
    {@const c = d.conflict}
    <div class="banner warn" data-testid="room-conflict">
      <span>{c.text}</span>
      {#if c.retryDateMs != null}
        <button
          type="button"
          class="hbtn"
          onclick={() => {
            d.setDate(c.retryDateMs!);
            void d.placeCrop(c.crop, c.blockId, c.at, c.retryDateMs!);
          }}
          >Place on {new Date(c.retryDateMs).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            timeZone: 'UTC'
          })}</button
        >
      {/if}
      <button type="button" class="hbtn" onclick={() => (d.conflict = null)}>Cancel</button>
    </div>
  {/if}

  {#if data.canEdit}
    <Hint
      key="garden_designer"
      anchor="[data-hint-anchor=garden_designer]"
      text="Pick a bed size, then tap the garden to put it there. Tap a bed to move, turn or size it."
      suppressed={d.view !== 'canvas' ||
        d.cropPanelOpen ||
        !!d.selectedBed ||
        d.mode.kind !== 'idle'}
    />
  {/if}
  <Hint
    key="designer_scrubber"
    anchor="[data-hint-anchor=designer_scrubber]"
    text="Slide through the season to see what's growing in each bed and when it opens up."
    suppressed={!d.hasScheduledPlanting ||
      d.cropPanelOpen ||
      !!d.selectedBed ||
      d.mode.kind !== 'idle'}
  />

  {#if customOpen && d.canEdit}
    <form
      class="custom"
      aria-label="Custom bed size"
      onsubmit={(e) => {
        e.preventDefault();
        customOpen = false;
        if (d.view === 'list')
          void d.addBedAtFreeSpot('custom', { widthFt: customW, lengthFt: customL });
        else d.choosePreset('custom', { widthFt: customW, lengthFt: customL });
      }}
    >
      <label>Width (ft) <input type="number" min="1" step="0.5" bind:value={customW} /></label>
      <label>Length (ft) <input type="number" min="1" step="0.5" bind:value={customL} /></label>
      <button type="submit" class="hbtn">{d.view === 'list' ? 'Add bed' : 'Place it'}</button>
      {#if d.view === 'canvas'}
        <button
          type="button"
          class="hbtn"
          onclick={() => {
            customOpen = false;
            void d.addBedAtFreeSpot('custom', { widthFt: customW, lengthFt: customL });
          }}>First open spot</button
        >
      {/if}
      <button type="button" class="hbtn" onclick={() => (customOpen = false)}>Cancel</button>
    </form>
  {/if}

  {#if d.view === 'canvas'}
    <div class="layout">
      <div class="main">
        <div class="no-print">
          <DesignerToolbar oncustom={() => (customOpen = true)} />
        </div>
        <DesignerCanvas bind:this={canvasRef} />
        <ul class="print-only legend" aria-label="What is in each bed on {printDate}">
          {#each legend as l (l.id)}
            <li><strong>{l.name}:</strong> {l.rows.length ? l.rows.join('; ') : 'Open'}</li>
          {/each}
        </ul>
        <div class="zoom" role="group" aria-label="Zoom">
          <button type="button" class="hbtn" onclick={() => canvasRef?.zoomIn()}>Zoom in</button>
          <button type="button" class="hbtn" onclick={() => canvasRef?.zoomOut()}>Zoom out</button>
          <button type="button" class="hbtn" onclick={() => canvasRef?.fitAll()}>Fit</button>
        </div>
      </div>
      <aside class="side">
        <CropPanel />
        {#if d.selectedBed}
          <BedInspector bed={d.selectedBed} />
        {:else}
          <p class="side-empty">Tap a bed to see what's in it, its size and its history.</p>
        {/if}
      </aside>
    </div>
  {:else}
    <div class="layout list">
      <div class="main">
        <DesignerListView oncustom={() => (customOpen = true)} />
      </div>
      <aside class="side">
        <CropPanel />
      </aside>
    </div>
  {/if}

  <div class="sr-only" role="status" aria-live="polite" data-testid="designer-status">
    {d.status}
  </div>
  <div class="sr-only" role="alert" aria-live="assertive" data-testid="designer-alert">
    {d.alert}
  </div>
  {#if d.alert}
    <p class="toast" aria-hidden="true">{d.alert}</p>
  {/if}
</div>

<style>
  .designer {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--page-padding, var(--space-4));
    max-width: 1400px;
    margin: 0 auto;
    min-width: 0;
    box-sizing: border-box;
    width: 100%;
  }
  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .kicker {
    margin: 0;
    font-size: var(--font-size-kicker);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--color-ink-soft);
  }
  h1 {
    margin: 0;
    font-size: var(--font-size-screen-title);
    color: var(--color-forest-deep);
    overflow-wrap: anywhere;
  }
  .head-actions,
  .zoom {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    overflow: hidden;
  }
  .seg button {
    min-height: 48px;
    min-width: 48px;
    padding: 0 var(--space-3);
    border: 0;
    background: var(--color-paper);
    color: var(--color-ink);
    font-weight: 600;
  }
  .seg button[aria-pressed='true'] {
    background: var(--color-forest);
    color: #fff;
  }
  .hbtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    min-width: 48px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-input);
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-ink);
    font-weight: 600;
    text-decoration: none;
    font-size: var(--font-size-body);
  }
  .seg-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    min-width: 56px;
    padding: 0 var(--space-3);
    background: var(--color-paper);
    color: var(--color-ink);
    font-weight: 600;
    text-decoration: none;
  }
  .seg-link[aria-current='page'] {
    background: var(--color-forest);
    color: #fff;
  }
  .print-only {
    display: none;
  }
  .hbtn:focus-visible,
  .seg-link:focus-visible,
  .seg button:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-input);
    border: 1px solid var(--pill-sky-bd);
    background: var(--pill-sky-bg);
    color: var(--color-ink);
  }
  .banner.warn {
    border-color: var(--pill-wheat-bd);
    background: var(--pill-wheat-bg);
  }
  .sticky {
    position: sticky;
    top: 0;
    z-index: 5;
    background: var(--color-cream, var(--color-paper));
  }
  .custom {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .custom label {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-weight: 600;
  }
  .custom input {
    min-height: 48px;
    width: 6em;
    padding: 0 var(--space-2);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-3);
  }
  .main,
  .side {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  .side-empty {
    margin: 0;
    color: var(--color-ink-soft);
  }
  @media (min-width: 640px) {
    .layout {
      grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    }
  }
  @media (max-width: 639px) {
    .designer {
      padding-bottom: 96px;
    }
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .toast {
    position: fixed;
    left: 50%;
    bottom: var(--space-4);
    transform: translateX(-50%);
    max-width: calc(100vw - 32px);
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-input);
    background: var(--color-ink);
    color: #fff;
    z-index: 50;
    pointer-events: none;
  }
  @media print {
    .head-actions,
    .sticky,
    .zoom,
    .side,
    .banner,
    .toast,
    .no-print,
    .custom,
    :global(.hint),
    :global(header.topbar),
    :global(.primary-nav),
    :global(.skip-link),
    :global(div.banner) {
      display: none !important;
    }
    .print-only {
      display: block;
    }
    .print-head {
      margin: 0;
      font-weight: 700;
    }
    .legend {
      margin: var(--space-2) 0 0;
      padding-left: 1.2em;
    }
    .designer {
      padding-bottom: 0;
    }
    .layout {
      grid-template-columns: 1fr;
    }
  }
</style>
