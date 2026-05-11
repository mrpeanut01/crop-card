<script lang="ts">
  /**
   * Interactive map for /plan?tab=layout.
   *
   * Renders field boundaries (dashed, field-colored) beneath block polygons
   * (solid, field-colored). "Draw block" pre-selects existing unmapped blocks;
   * "Draw field" does the same for fields. Both draw modes share a single
   * pm:create handler that branches on drawMode.
   */

  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import 'leaflet/dist/leaflet.css';
  import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
  import { geojsonCentroid, metersSquaredToAcres, polygonAreaSqMeters } from '$lib/geo/area';
  import type { Map as LMap, Polygon as LPolygon, LayerGroup, GeoJSON as LGeoJSON } from 'leaflet';
  import type { BlockWithPlantings } from '$lib/db/blocks';
  import type { FieldWithBlocks } from '$lib/db/fields';

  type Geom = { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] };
  type SaveCallback = (id: string, geom: Geom | null) => Promise<void> | void;
  type CreateBlockCb = (geom: Geom, acres: number | null) => Promise<void> | void;
  type CreateFieldCb = (name: string, geom: Geom, acres: number | null) => Promise<void> | void;

  type BlockChoice = { id: string; name: string; fieldName: string };
  type FieldChoice = { id: string; name: string };

  type DraftState = {
    mode: 'block' | 'field';
    geom: Geom;
    acres: number | null;
    // block fields
    assignMode: 'existing' | 'new';
    blockChoices: BlockChoice[];
    existingBlockId: string;
    newBlockName: string;
    newBlockFieldId: string;
    // field fields
    assignFieldMode: 'existing' | 'new';
    fieldChoices: FieldChoice[];
    existingFieldId: string;
    newFieldName: string;
    // shared
    busy: boolean;
    error: string | null;
  };

  /** v1.3 shade-source: external shade emitter rendered alongside blocks. */
  export type ShadeSourceLite = {
    id: string;
    name: string;
    kind: 'tree-row' | 'tree-grove' | 'tree-single' | 'hedge' | 'building' | 'fence' | 'structure' | 'other';
    geometryGeojson?: string;
    heightFt: number;
    opacity: number;
    isDeciduous: boolean;
    leafOnDayOfYear: number;
    leafOffDayOfYear: number;
  };
  export type CreateShadeSourceCb = (input: {
    name: string;
    kind: ShadeSourceLite['kind'];
    geometryGeojson: string;
    heightFt: number;
    opacity: number;
    isDeciduous: boolean;
    leafOnDayOfYear: number;
    leafOffDayOfYear: number;
  }) => Promise<void>;
  export type DeleteShadeSourceCb = (id: string, name: string) => Promise<void>;
  export type UpdateShadeGeometryCb = (id: string, geometryGeojson: string) => Promise<void>;

  let {
    blocks,
    fields,
    canEdit,
    thumbnail = false,
    onThumbnailClick,
    onSaveGeometry,
    onCreateWithGeometry,
    onSaveFieldGeometry,
    onCreateFieldWithGeometry,
    blockBadges,
    shadeSources = [],
    onCreateShadeSource,
    onDeleteShadeSource,
    onUpdateShadeGeometry
  }: {
    blocks: BlockWithPlantings[];
    fields: FieldWithBlocks[];
    canEdit: boolean;
    thumbnail?: boolean;
    onThumbnailClick?: () => void;
    onSaveGeometry: SaveCallback;
    onCreateWithGeometry: CreateBlockCb;
    onSaveFieldGeometry: SaveCallback;
    onCreateFieldWithGeometry: CreateFieldCb;
    /** Optional emoji/text overlay per block (Phase 14e). When set, a
     *  non-interactive marker is placed at the polygon centroid showing
     *  the badge string. Used by /plan?tab=crops to surface what's planted
     *  on each block. */
    blockBadges?: Record<string, string>;
    /** v1.3 shade model — external shade sources rendered as dashed
     *  overlays on the map. Tree rows / fences as polylines, groves and
     *  buildings as polygons. */
    shadeSources?: ShadeSourceLite[];
    onCreateShadeSource?: CreateShadeSourceCb;
    onDeleteShadeSource?: DeleteShadeSourceCb;
    onUpdateShadeGeometry?: UpdateShadeGeometryCb;
  } = $props();

  // ── Per-field color palette (index cycles for farms with >8 fields) ──────
  const FIELD_COLORS = [
    '#1f5e3a', '#2980b9', '#8e44ad', '#c0392b',
    '#d35400', '#16a085', '#2c3e50', '#a67c00'
  ];
  const fieldColorMap = new Map<string, string>();

  function buildFieldColorMap() {
    fieldColorMap.clear();
    fields.forEach((f, i) => {
      fieldColorMap.set(f.id, FIELD_COLORS[i % FIELD_COLORS.length]);
    });
  }

  function blockColor(fieldId: string | undefined): string {
    return (fieldId && fieldColorMap.get(fieldId)) ?? FIELD_COLORS[0];
  }

  // ── Map state ────────────────────────────────────────────────────────────
  let mapEl: HTMLDivElement;
  let map: LMap | null = null;
  let fieldLayer: LayerGroup | null = null;  // rendered below blockLayer
  let blockLayer: LayerGroup | null = null;
  /** v1.3 — shade-source layer renders above blocks. */
  let shadeLayer: LayerGroup | null = null;

  const polygonToBlockId = new Map<number, string>();
  const polygonToFieldId = new Map<number, string>();
  const polygonToShadeId = new Map<number, string>();

  let pendingDraft = $state<DraftState | null>(null);
  /** Active draw mode. 'auto' = field/block by centroid containment;
   *  'shade-line' = drawing a tree row / fence / hedge;
   *  'shade-polygon' = drawing a tree grove / building / structure. */
  let drawMode = $state<'auto' | 'shade-line' | 'shade-polygon'>('auto');
  /** Pending shade-source draft (after shape is drawn). */
  let shadeDraft = $state<ShadeDraft | null>(null);
  let drawing = $state(false);
  let editingActive = $state(false);
  let drawError = $state<string | null>(null);

  type ShadeDraft = {
    geom: Geom;
    geomKind: 'LineString' | 'Polygon';
    name: string;
    kind: ShadeSourceLite['kind'];
    heightFt: string;
    opacity: string;
    isDeciduous: boolean;
    leafOnDayOfYear: string;
    leafOffDayOfYear: string;
    busy: boolean;
    error: string | null;
  };
  // Set to true in a layer click so the immediately-following map click doesn't deselect.
  let _suppressNextMapClick = false;

  // ── Geometry helpers ─────────────────────────────────────────────────────

  function polygonCentroid(ring: Array<[number, number]>): [number, number] {
    let x = 0, y = 0;
    for (const [lng, lat] of ring) { x += lng; y += lat; }
    return [x / ring.length, y / ring.length];
  }

  function pointInRing(pt: [number, number], ring: Array<[number, number]>): boolean {
    const [px, py] = pt;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
        inside = !inside;
    }
    return inside;
  }

  function centroidInField(drawnGeom: Geom, field: FieldWithBlocks): boolean {
    if (!field.geometryGeojson) return false;
    let fg: unknown;
    try { fg = JSON.parse(field.geometryGeojson); } catch { return false; }
    const outerRing = drawnGeom.type === 'Polygon'
      ? (drawnGeom.coordinates as number[][][])[0] as Array<[number, number]>
      : ((drawnGeom.coordinates as number[][][][])[0][0]) as Array<[number, number]>;
    const centroid = polygonCentroid(outerRing);
    const g = fg as { type: string; coordinates?: unknown; geometry?: { type: string; coordinates: unknown }; features?: Array<{ geometry: { type: string; coordinates: unknown } }> };
    const checkCoords = (type: string, coords: unknown): boolean => {
      if (type === 'Polygon') return pointInRing(centroid, (coords as number[][][])[0] as Array<[number, number]>);
      if (type === 'MultiPolygon') return (coords as number[][][][]).some(p => pointInRing(centroid, p[0] as Array<[number, number]>));
      return false;
    };
    if (g.type === 'Feature' && g.geometry) return checkCoords(g.geometry.type, g.geometry.coordinates);
    if (g.type === 'FeatureCollection' && g.features) return g.features.some(f => checkCoords(f.geometry.type, f.geometry.coordinates));
    return checkCoords(g.type, g.coordinates);
  }

  const draftReady = $derived.by(() => {
    if (!pendingDraft || pendingDraft.busy) return false;
    if (pendingDraft.mode === 'block') {
      return pendingDraft.assignMode === 'existing'
        ? !!pendingDraft.existingBlockId
        : !!pendingDraft.newBlockName.trim();
    }
    return pendingDraft.assignFieldMode === 'existing'
      ? !!pendingDraft.existingFieldId
      : !!pendingDraft.newFieldName.trim();
  });

  onMount(async () => {
    if (!browser) return;
    const L = (await import('leaflet')).default;
    await import('@geoman-io/leaflet-geoman-free');

    map = L.map(mapEl, {
      zoomControl: !thumbnail,
      dragging: !thumbnail,
      scrollWheelZoom: !thumbnail,
      doubleClickZoom: !thumbnail,
      touchZoom: !thumbnail,
      keyboard: !thumbnail,
      attributionControl: !thumbnail
    }).setView([39.1, -77.55], 13);

    const satellite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 19,
        attribution:
          'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
      }
    );
    const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    });
    satellite.addTo(map);
    if (!thumbnail) {
      L.control.layers({ Satellite: satellite, Streets: streets }, undefined, { position: 'topright' }).addTo(map);
    }

    // Fields layer first so it renders beneath blocks.
    fieldLayer = L.layerGroup().addTo(map);
    blockLayer = L.layerGroup().addTo(map);
    shadeLayer = L.layerGroup().addTo(map);

    buildFieldColorMap();
    renderFields(L);
    renderBlocks(L);
    renderShadeSources(L);
    fitToAll(L);

    if (thumbnail) return; // no controls or editing in thumbnail mode

    // Locate-me control (bottom-right, matches Maps convention).
    const LocateControl = L.Control.extend({
      onAdd() {
        const wrap = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
        const btn = L.DomUtil.create('button', '', wrap) as HTMLButtonElement;
        btn.type = 'button';
        btn.title = 'My location';
        btn.setAttribute('aria-label', 'Center on my GPS location');
        btn.innerHTML = '📍';
        btn.style.cssText =
          'display:flex;align-items:center;justify-content:center;width:30px;height:30px;background:white;border:none;cursor:pointer;font-size:1.1rem;';
        L.DomEvent.disableClickPropagation(wrap);
        L.DomEvent.on(btn, 'click', () => locateMe());
        return wrap;
      }
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new (LocateControl as any)({ position: 'bottomright' }).addTo(map);

    if (canEdit) {
      map.pm.setLang('en');
      map.pm.setGlobalOptions({
        snappable: true,
        snapDistance: 20,
        finishOn: 'dblclick',
        allowSelfIntersection: false
      });

      // Click on empty map space → deselect. Suppress when a layer click just fired.
      map.on('click', () => {
        if (_suppressNextMapClick) { _suppressNextMapClick = false; return; }
        if (editingActive) stopEditing();
      });

      map.on('pm:create', (e: { layer: LPolygon }) => {
        drawing = false;
        const layer = e.layer as LPolygon;
        const geojson = (layer.toGeoJSON() as { geometry: Geom }).geometry;
        layer.remove();

        // v1.3 — shade-source draw modes capture before the block/field path.
        if (drawMode === 'shade-line' || drawMode === 'shade-polygon') {
          const expectedKind = drawMode === 'shade-line' ? 'LineString' : 'Polygon';
          if (geojson.type !== expectedKind) {
            drawError = `Expected ${expectedKind} but got ${geojson.type}`;
            drawMode = 'auto';
            pendingShadeKind = null;
            return;
          }
          // Use the kind picked from the toolbar; fall back to a sensible
          // default for the geometry shape.
          const expectedKindStr: string = expectedKind;
          const kind: ShadeKind =
            pendingShadeKind ?? (expectedKindStr === 'LineString' ? 'tree-row' : 'tree-grove');
          const d = shadeDefaultsFor(kind);
          shadeDraft = {
            geom: geojson,
            geomKind: expectedKind,
            name: '',
            kind,
            heightFt: d.heightFt,
            opacity: d.opacity,
            isDeciduous: d.isDeciduous,
            leafOnDayOfYear: d.leafOnDayOfYear,
            leafOffDayOfYear: d.leafOffDayOfYear,
            busy: false,
            error: null
          };
          drawMode = 'auto';
          pendingShadeKind = null;
          return;
        }

        const acres = areaFromGeom(geojson);

        // Auto-detect: if the centroid falls inside an existing field → block, otherwise → field.
        const containingField = fields.find((f) => centroidInField(geojson, f));

        if (containingField) {
          const unmapped = blocks.filter((b) => !b.geometryGeojson && b.fieldId === containingField.id);
          const allUnmapped = blocks.filter((b) => !b.geometryGeojson);
          const choices = (unmapped.length > 0 ? unmapped : allUnmapped).map((b) => ({
            id: b.id,
            name: b.name,
            fieldName: fields.find((f) => f.id === b.fieldId)?.name ?? ''
          }));
          pendingDraft = {
            mode: 'block',
            geom: geojson,
            acres,
            assignMode: choices.length > 0 ? 'existing' : 'new',
            blockChoices: choices,
            existingBlockId: choices[0]?.id ?? '',
            newBlockName: '',
            newBlockFieldId: containingField.id,
            assignFieldMode: 'new',
            fieldChoices: [],
            existingFieldId: '',
            newFieldName: '',
            busy: false,
            error: null
          };
        } else {
          const unmapped = fields.filter((f) => !f.geometryGeojson);
          pendingDraft = {
            mode: 'field',
            geom: geojson,
            acres,
            assignMode: 'new',
            blockChoices: [],
            existingBlockId: '',
            newBlockName: '',
            newBlockFieldId: '',
            assignFieldMode: unmapped.length > 0 ? 'existing' : 'new',
            fieldChoices: unmapped.map((f) => ({ id: f.id, name: f.name })),
            existingFieldId: unmapped[0]?.id ?? '',
            newFieldName: '',
            busy: false,
            error: null
          };
        }
      });
    }
  });

  onDestroy(() => {
    if (map) { map.remove(); map = null; }
  });

  // ── Render ───────────────────────────────────────────────────────────────

  function renderFields(L: typeof import('leaflet')) {
    if (!map || !fieldLayer) return;
    fieldLayer.clearLayers();
    polygonToFieldId.clear();
    for (const f of fields) {
      if (!f.geometryGeojson) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(f.geometryGeojson); } catch { continue; }
      const color = fieldColorMap.get(f.id) ?? FIELD_COLORS[0];
      const layer = L.geoJSON(parsed as never, {
        style: () => ({ color, weight: 2, dashArray: '7 5', fillColor: color, fillOpacity: 0.07 })
      });
      layer.bindTooltip(f.name, { permanent: true, direction: 'center', className: 'field-label-tip' });
      const id = (layer as unknown as { _leaflet_id: number })._leaflet_id;
      polygonToFieldId.set(id, f.id);
      if (canEdit) {
        // Attach handlers once to each sub-layer at render time.
        (layer as LGeoJSON).eachLayer((l) => {
          const poly = l as LPolygon & { pm: { enable: (o: object) => void } };
          l.on('pm:edit', () => debouncedFieldSave(f.id, poly));
          l.on('contextmenu', () => removeFieldGeometry(f.id, f.name));
          l.on('click', () => {
            if (drawing) return;
            _suppressNextMapClick = true;
            editingActive = true;
            poly.pm.enable({ snappable: true, allowSelfIntersection: false });
          });
        });
      }
      layer.addTo(fieldLayer);
    }
  }

  function renderBlocks(L: typeof import('leaflet')) {
    if (!map || !blockLayer) return;
    blockLayer.clearLayers();
    polygonToBlockId.clear();
    for (const b of blocks) {
      if (!b.geometryGeojson) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(b.geometryGeojson); } catch { continue; }
      const color = blockColor(b.fieldId);
      const layer = L.geoJSON(parsed as never, {
        style: () => ({ color, weight: 2, fillColor: color, fillOpacity: 0.22 })
      });
      layer.bindTooltip(b.name, { direction: 'center' });
      const id = (layer as unknown as { _leaflet_id: number })._leaflet_id;
      polygonToBlockId.set(id, b.id);

      // Phase 14e: optional badge at the polygon centroid (e.g. crop family
      // emoji on /plan?tab=crops). Non-interactive so polygon clicks still
      // pass through.
      if (blockBadges?.[b.id]) {
        const obj = parsed as { type?: string; coordinates?: unknown };
        let ring: Array<[number, number]> | null = null;
        if (obj.type === 'Polygon' && Array.isArray(obj.coordinates)) {
          const r = (obj.coordinates as unknown[])[0];
          if (Array.isArray(r)) ring = r as Array<[number, number]>;
        } else if (obj.type === 'MultiPolygon' && Array.isArray(obj.coordinates)) {
          const poly = (obj.coordinates as unknown[])[0];
          if (Array.isArray(poly)) {
            const r = (poly as unknown[])[0];
            if (Array.isArray(r)) ring = r as Array<[number, number]>;
          }
        }
        if (ring) {
          const [lon, lat] = polygonCentroid(ring);
          const icon = L.divIcon({
            html: `<span class="block-badge">${blockBadges[b.id]}</span>`,
            className: 'block-badge-wrap',
            iconSize: [0, 0]
          });
          L.marker([lat, lon], { icon, interactive: false, keyboard: false }).addTo(blockLayer);
        }
      }

      if (canEdit) {
        // Attach handlers once to each sub-layer at render time.
        (layer as LGeoJSON).eachLayer((l) => {
          const poly = l as LPolygon & { pm: { enable: (o: object) => void } };
          l.on('pm:edit', () => debouncedSave(b.id, poly));
          l.on('contextmenu', () => removeGeometry(b.id, b.name));
          l.on('click', () => {
            if (drawing) return;
            _suppressNextMapClick = true;
            editingActive = true;
            poly.pm.enable({ snappable: true, allowSelfIntersection: false });
          });
        });
      }
      layer.addTo(blockLayer);
    }
  }

  function renderShadeSources(L: typeof import('leaflet')) {
    if (!map || !shadeLayer) return;
    shadeLayer.clearLayers();
    polygonToShadeId.clear();
    for (const s of shadeSources) {
      if (!s.geometryGeojson) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(s.geometryGeojson); } catch { continue; }
      const isLine = isLineGeometry(parsed);
      // Distinct visual: dashed gray-green for tree-rows; dashed dark-amber
      // for buildings/structures so they don't compete with field/block colors.
      const isStructure =
        s.kind === 'building' || s.kind === 'structure' || s.kind === 'fence';
      const stroke = isStructure ? '#92400e' : '#15803d';
      const fill = isStructure ? '#fbbf24' : '#86efac';
      const layer = L.geoJSON(parsed as never, {
        style: () => ({
          color: stroke,
          weight: isLine ? 4 : 2,
          dashArray: '6 6',
          fillColor: fill,
          fillOpacity: isLine ? 0 : 0.18
        })
      });
      const tooltipText = `${s.name} · ${s.kind} · ${s.heightFt} ft${s.isDeciduous ? ' · deciduous' : ''}`;
      layer.bindTooltip(tooltipText, { direction: 'top' });
      const id = (layer as unknown as { _leaflet_id: number })._leaflet_id;
      polygonToShadeId.set(id, s.id);
      if (canEdit) {
        (layer as LGeoJSON).eachLayer((l) => {
          const poly = l as LPolygon & { pm: { enable: (o: object) => void } };
          if (onUpdateShadeGeometry) {
            l.on('pm:edit', () => debouncedShadeSave(s.id, poly));
          }
          if (onDeleteShadeSource) {
            l.on('contextmenu', () => {
              void onDeleteShadeSource!(s.id, s.name);
            });
          }
          l.on('click', () => {
            if (drawing) return;
            _suppressNextMapClick = true;
            editingActive = true;
            poly.pm.enable({ snappable: true, allowSelfIntersection: false });
          });
        });
      }
      layer.addTo(shadeLayer);

      // Kind-emoji marker at the centroid (LineString midpoint or Polygon
      // area-weighted centroid) so the operator sees what the source IS at
      // a glance, even when zoomed out where the dashed outline shrinks.
      const centroid = geojsonCentroid(s.geometryGeojson);
      if (centroid) {
        const [lon, lat] = centroid;
        const emoji = shadeKindEmoji(s.kind);
        const iconHtml = `<span class="shade-marker" title="${s.name}">${emoji}</span>`;
        const icon = L.divIcon({
          html: iconHtml,
          className: 'shade-marker-wrap',
          iconSize: [0, 0]
        });
        L.marker([lat, lon], { icon, interactive: false, keyboard: false }).addTo(shadeLayer);
      }
    }
  }

  function isLineGeometry(parsed: unknown): boolean {
    if (!parsed || typeof parsed !== 'object') return false;
    const o = parsed as { type?: string; geometry?: { type?: string } };
    if (o.type === 'LineString' || o.type === 'MultiLineString') return true;
    if (o.type === 'Feature' && o.geometry) {
      return o.geometry.type === 'LineString' || o.geometry.type === 'MultiLineString';
    }
    return false;
  }

  $effect(() => {
    void blocks; void fields; void shadeSources;
    if (!browser || !map) return;
    import('leaflet').then((mod) => {
      buildFieldColorMap();
      renderFields(mod.default);
      renderBlocks(mod.default);
      renderShadeSources(mod.default);
    });
  });

  function fitToAll(L: typeof import('leaflet')) {
    if (!map) return;
    const group = L.featureGroup([
      ...(fieldLayer?.getLayers() ?? []),
      ...(blockLayer?.getLayers() ?? []),
      ...(shadeLayer?.getLayers() ?? [])
    ] as Parameters<typeof L.featureGroup>[0]);
    const bounds = group.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40] });
  }

  // ── Debounced saves ───────────────────────────────────────────────────────

  const blockEditTimers = new Map<string, ReturnType<typeof setTimeout>>();
  function debouncedSave(blockId: string, poly: LPolygon) {
    const prev = blockEditTimers.get(blockId);
    if (prev) clearTimeout(prev);
    blockEditTimers.set(blockId, setTimeout(async () => {
      const geojson = (poly.toGeoJSON() as { geometry: Geom }).geometry;
      try { await onSaveGeometry(blockId, geojson); }
      catch (e) { drawError = e instanceof Error ? e.message : String(e); }
    }, 800));
  }

  const fieldEditTimers = new Map<string, ReturnType<typeof setTimeout>>();
  function debouncedFieldSave(fieldId: string, poly: LPolygon) {
    const prev = fieldEditTimers.get(fieldId);
    if (prev) clearTimeout(prev);
    fieldEditTimers.set(fieldId, setTimeout(async () => {
      const geojson = (poly.toGeoJSON() as { geometry: Geom }).geometry;
      try { await onSaveFieldGeometry(fieldId, geojson); }
      catch (e) { drawError = e instanceof Error ? e.message : String(e); }
    }, 800));
  }

  const shadeEditTimers = new Map<string, ReturnType<typeof setTimeout>>();
  function debouncedShadeSave(shadeId: string, poly: LPolygon) {
    if (!onUpdateShadeGeometry) return;
    const prev = shadeEditTimers.get(shadeId);
    if (prev) clearTimeout(prev);
    shadeEditTimers.set(shadeId, setTimeout(async () => {
      const geojson = (poly.toGeoJSON() as { geometry: Geom }).geometry;
      try { await onUpdateShadeGeometry!(shadeId, JSON.stringify(geojson)); }
      catch (e) { drawError = e instanceof Error ? e.message : String(e); }
    }, 800));
  }

  async function removeGeometry(blockId: string, name: string) {
    if (!confirm(`Remove polygon for block "${name}"?`)) return;
    try { await onSaveGeometry(blockId, null); }
    catch (e) { drawError = e instanceof Error ? e.message : String(e); }
  }

  async function removeFieldGeometry(fieldId: string, name: string) {
    if (!confirm(`Remove boundary for field "${name}"?`)) return;
    try { await onSaveFieldGeometry(fieldId, null); }
    catch (e) { drawError = e instanceof Error ? e.message : String(e); }
  }

  // ── Draw controls ─────────────────────────────────────────────────────────

  function stopEditing() {
    if (!map) return;
    map.pm.disableGlobalEditMode();
    editingActive = false;
  }

  function startDraw() {
    if (!map || !canEdit) return;
    stopEditing();
    drawError = null; drawing = true; drawMode = 'auto';
    map.pm.enableDraw('Polygon');
  }

  function cancelDraw() {
    if (!map) return;
    map.pm.disableDraw();
    drawing = false;
    drawMode = 'auto';
    pendingShadeKind = null;
  }

  function locateMe() {
    if (!map) return;
    if (!('geolocation' in navigator)) { drawError = 'Geolocation not available'; return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { map?.flyTo([pos.coords.latitude, pos.coords.longitude], 17); },
      (err) => { drawError = `Location: ${err.message}`; },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  // ── Area helper ───────────────────────────────────────────────────────────

  function areaFromGeom(g: Geom): number | null {
    if (g.type === 'Polygon') {
      const outer = (g.coordinates as number[][][])[0];
      if (!Array.isArray(outer)) return null;
      return metersSquaredToAcres(polygonAreaSqMeters(outer as Array<[number, number]>));
    }
    if (g.type === 'MultiPolygon') {
      let m2 = 0;
      for (const poly of g.coordinates as number[][][][]) {
        const outer = poly[0];
        if (Array.isArray(outer)) m2 += polygonAreaSqMeters(outer as Array<[number, number]>);
      }
      return metersSquaredToAcres(m2);
    }
    return null;
  }

  // ── Shade-source draft ────────────────────────────────────────────────────

  const shadeDraftReady = $derived.by(() => {
    if (!shadeDraft || shadeDraft.busy) return false;
    if (!shadeDraft.name.trim()) return false;
    const h = Number(shadeDraft.heightFt);
    if (!Number.isFinite(h) || h <= 0 || h > 200) return false;
    const o = Number(shadeDraft.opacity);
    if (!Number.isFinite(o) || o < 0 || o > 1) return false;
    return true;
  });

  async function submitShadeDraft() {
    if (!shadeDraft || !shadeDraftReady || !onCreateShadeSource) return;
    shadeDraft.busy = true;
    shadeDraft.error = null;
    try {
      await onCreateShadeSource({
        name: shadeDraft.name.trim(),
        kind: shadeDraft.kind,
        geometryGeojson: JSON.stringify(shadeDraft.geom),
        heightFt: Number(shadeDraft.heightFt),
        opacity: Number(shadeDraft.opacity),
        isDeciduous: shadeDraft.isDeciduous,
        leafOnDayOfYear: Number(shadeDraft.leafOnDayOfYear) || 105,
        leafOffDayOfYear: Number(shadeDraft.leafOffDayOfYear) || 305
      });
      shadeDraft = null;
    } catch (e) {
      if (shadeDraft) {
        shadeDraft.error = e instanceof Error ? e.message : String(e);
        shadeDraft.busy = false;
      }
    }
  }

  function dismissShadeDraft() {
    shadeDraft = null;
  }

  /** Per-kind defaults for height/opacity/deciduous/leaf dates. Drives both
   *  the post-draw modal pre-fill and live re-pre-fill when the user changes
   *  kind in the modal dropdown. */
  type ShadeKind = ShadeSourceLite['kind'];
  function shadeDefaultsFor(kind: ShadeKind): {
    heightFt: string;
    opacity: string;
    isDeciduous: boolean;
    leafOnDayOfYear: string;
    leafOffDayOfYear: string;
    geomKind: 'LineString' | 'Polygon';
  } {
    switch (kind) {
      case 'tree-row':
        return { heightFt: '30', opacity: '0.7', isDeciduous: true, leafOnDayOfYear: '105', leafOffDayOfYear: '305', geomKind: 'LineString' };
      case 'hedge':
        return { heightFt: '6', opacity: '0.7', isDeciduous: true, leafOnDayOfYear: '105', leafOffDayOfYear: '305', geomKind: 'LineString' };
      case 'fence':
        return { heightFt: '6', opacity: '0.95', isDeciduous: false, leafOnDayOfYear: '105', leafOffDayOfYear: '305', geomKind: 'LineString' };
      case 'tree-grove':
        return { heightFt: '40', opacity: '0.7', isDeciduous: true, leafOnDayOfYear: '105', leafOffDayOfYear: '305', geomKind: 'Polygon' };
      case 'tree-single':
        return { heightFt: '25', opacity: '0.7', isDeciduous: true, leafOnDayOfYear: '105', leafOffDayOfYear: '305', geomKind: 'Polygon' };
      case 'building':
        return { heightFt: '20', opacity: '1.0', isDeciduous: false, leafOnDayOfYear: '105', leafOffDayOfYear: '305', geomKind: 'Polygon' };
      case 'structure':
        return { heightFt: '15', opacity: '0.9', isDeciduous: false, leafOnDayOfYear: '105', leafOffDayOfYear: '305', geomKind: 'Polygon' };
      default:
        return { heightFt: '20', opacity: '0.7', isDeciduous: false, leafOnDayOfYear: '105', leafOffDayOfYear: '305', geomKind: 'Polygon' };
    }
  }

  function shadeKindEmoji(kind: ShadeKind): string {
    switch (kind) {
      case 'tree-row': return '🌳';
      case 'tree-grove': return '🌲';
      case 'tree-single': return '🌳';
      case 'hedge': return '🌿';
      case 'building': return '🏠';
      case 'fence': return '🧱';
      case 'structure': return '🏗️';
      default: return '🌑';
    }
  }

  /** Shade-kind picker overlay state. When non-null, the toolbar shows a
   *  small list of kind buttons; clicking one starts the appropriate draw
   *  mode with the kind pre-selected for the post-draw modal. */
  let shadePickerOpen = $state(false);
  let pendingShadeKind = $state<ShadeKind | null>(null);

  function toggleShadePicker() {
    shadePickerOpen = !shadePickerOpen;
  }

  function startDrawShade(kind: ShadeKind) {
    if (!map || !canEdit) return;
    shadePickerOpen = false;
    pendingShadeKind = kind;
    stopEditing();
    drawError = null;
    drawing = true;
    const defaults = shadeDefaultsFor(kind);
    drawMode = defaults.geomKind === 'LineString' ? 'shade-line' : 'shade-polygon';
    map.pm.enableDraw(defaults.geomKind === 'LineString' ? 'Line' : 'Polygon');
  }

  // ── Draft submit ──────────────────────────────────────────────────────────

  async function submitDraft() {
    if (!pendingDraft || !draftReady) return;
    pendingDraft.busy = true;
    pendingDraft.error = null;
    try {
      if (pendingDraft.mode === 'block') {
        if (pendingDraft.assignMode === 'existing') {
          await onSaveGeometry(pendingDraft.existingBlockId, pendingDraft.geom);
        } else {
          await onCreateWithGeometry(pendingDraft.geom, pendingDraft.acres);
        }
      } else {
        if (pendingDraft.assignFieldMode === 'existing') {
          await onSaveFieldGeometry(pendingDraft.existingFieldId, pendingDraft.geom);
        } else {
          await onCreateFieldWithGeometry(
            pendingDraft.newFieldName.trim(),
            pendingDraft.geom,
            pendingDraft.acres
          );
        }
      }
      pendingDraft = null;
    } catch (e) {
      if (pendingDraft) pendingDraft.error = e instanceof Error ? e.message : String(e);
    } finally {
      if (pendingDraft) pendingDraft.busy = false;
    }
  }

  function dismissDraft() { pendingDraft = null; }

  // Expose block name/fieldId for parent's createBlockWithGeometry.
  export function currentDraftName(): string { return pendingDraft?.newBlockName.trim() ?? ''; }
  export function currentDraftFieldId(): string { return pendingDraft?.newBlockFieldId ?? ''; }

</script>

<div class="map-shell" class:map-thumbnail={thumbnail}>
  <div class="map" bind:this={mapEl} aria-label="Field and block map" role="application"></div>

  {#if thumbnail && onThumbnailClick}
    <div
      class="thumbnail-overlay"
      role="button"
      tabindex="0"
      aria-label="Open full map in Layout"
      onclick={onThumbnailClick}
      onkeydown={(e) => e.key === 'Enter' && onThumbnailClick?.()}
    >
      <span class="thumbnail-hint">View in Layout →</span>
    </div>
  {/if}

  {#if canEdit && !thumbnail}
    <div class="toolbar" role="toolbar" aria-label="Map tools">
      {#if drawing}
        <button type="button" class="tool danger" onclick={cancelDraw}>✕ Cancel</button>
      {:else if editingActive}
        <button type="button" class="tool done" onclick={stopEditing} title="Finish editing">
          ✓ Done editing
        </button>
      {:else}
        <button type="button" class="tool primary" onclick={startDraw} title="Draw a field or block polygon">
          🌾 Field / Block
        </button>
        {#if onCreateShadeSource}
          <button
            type="button"
            class="tool"
            class:active={shadePickerOpen}
            onclick={toggleShadePicker}
            title="Add a shade source — pick a kind, then draw"
          >🌑 Shade ▾</button>
          {#if shadePickerOpen && !drawing}
            <div class="shade-picker" role="menu" aria-label="Pick shade source kind">
              <p class="shade-picker-hint">Pick a kind to draw:</p>
              <div class="shade-picker-row"><strong>Lines</strong></div>
              <button type="button" class="shade-picker-btn" onclick={() => startDrawShade('tree-row')}>🌳 Tree row</button>
              <button type="button" class="shade-picker-btn" onclick={() => startDrawShade('hedge')}>🌿 Hedge</button>
              <button type="button" class="shade-picker-btn" onclick={() => startDrawShade('fence')}>🧱 Fence</button>
              <div class="shade-picker-row"><strong>Areas</strong></div>
              <button type="button" class="shade-picker-btn" onclick={() => startDrawShade('tree-grove')}>🌲 Tree grove</button>
              <button type="button" class="shade-picker-btn" onclick={() => startDrawShade('tree-single')}>🌳 Single tree</button>
              <button type="button" class="shade-picker-btn" onclick={() => startDrawShade('building')}>🏠 Building</button>
              <button type="button" class="shade-picker-btn" onclick={() => startDrawShade('structure')}>🏗️ Structure</button>
              <button type="button" class="shade-picker-btn" onclick={() => startDrawShade('other')}>🌑 Other</button>
              <button type="button" class="shade-picker-cancel" onclick={() => (shadePickerOpen = false)}>Cancel</button>
            </div>
          {/if}
        {/if}
      {/if}
    </div>
  {/if}

  {#if drawError}
    <p class="map-error" role="alert">{drawError}</p>
  {/if}

  {#if drawing}
    <p class="hint" aria-live="polite">
      {#if drawMode === 'shade-line'}
        Click points to draw the tree row / fence line. Double-click to finish.
      {:else if drawMode === 'shade-polygon'}
        Click points to outline the grove / building footprint. Double-click to finish.
      {:else}
        Click points to outline an area. Double-click to finish.
        Draw <strong>inside a field</strong> to create a block; draw <strong>outside</strong> to create a field.
      {/if}
    </p>
  {/if}
</div>

{#if shadeDraft}
  <div
    class="draft-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="shade-draft-title"
    onclick={(e) => e.target === e.currentTarget && dismissShadeDraft()}
    onkeydown={(e) => e.key === 'Escape' && dismissShadeDraft()}
    tabindex="-1"
  >
    <div class="draft-modal">
      <h2 id="shade-draft-title">Add shade source</h2>
      <p class="acres-hint">{shadeDraft.geomKind === 'LineString' ? 'Tree row / fence line' : 'Grove / building footprint'}</p>
      <label>
        Name
        <input type="text" bind:value={shadeDraft.name} placeholder="North maple windbreak" maxlength="120" />
      </label>
      <label>
        Kind
        <select
          value={shadeDraft.kind}
          onchange={(e) => {
            if (!shadeDraft) return;
            const newKind = (e.currentTarget as HTMLSelectElement).value as ShadeKind;
            const d = shadeDefaultsFor(newKind);
            shadeDraft.kind = newKind;
            shadeDraft.heightFt = d.heightFt;
            shadeDraft.opacity = d.opacity;
            shadeDraft.isDeciduous = d.isDeciduous;
            shadeDraft.leafOnDayOfYear = d.leafOnDayOfYear;
            shadeDraft.leafOffDayOfYear = d.leafOffDayOfYear;
          }}
        >
          {#if shadeDraft.geomKind === 'LineString'}
            <option value="tree-row">🌳 Tree row (line of trees, e.g. windbreak)</option>
            <option value="hedge">🌿 Hedge</option>
            <option value="fence">🧱 Fence</option>
            <option value="other">🌑 Other</option>
          {:else}
            <option value="tree-grove">🌲 Tree grove (clump or stand)</option>
            <option value="tree-single">🌳 Single tree (canopy footprint)</option>
            <option value="building">🏠 Building</option>
            <option value="structure">🏗️ Structure</option>
            <option value="other">🌑 Other</option>
          {/if}
        </select>
      </label>
      <p class="shade-defaults-hint">Defaults adjust to match the kind — tweak any value below.</p>
      <div class="shade-grid-2">
        <label>
          Height (ft)
          <input type="number" min="1" max="200" step="1" bind:value={shadeDraft.heightFt} />
        </label>
        <label>
          Opacity (0–1)
          <input type="number" min="0" max="1" step="0.05" bind:value={shadeDraft.opacity} />
        </label>
      </div>
      <label class="shade-checkbox">
        <input type="checkbox" bind:checked={shadeDraft.isDeciduous} />
        Deciduous (leaves drop in winter)
      </label>
      {#if shadeDraft.isDeciduous}
        <div class="shade-grid-2">
          <label>
            Leaf-on (day of year)
            <input type="number" min="1" max="366" bind:value={shadeDraft.leafOnDayOfYear} />
          </label>
          <label>
            Leaf-off (day of year)
            <input type="number" min="1" max="366" bind:value={shadeDraft.leafOffDayOfYear} />
          </label>
        </div>
      {/if}
      {#if shadeDraft.error}<p class="map-error">{shadeDraft.error}</p>{/if}
      <div class="actions">
        <button type="button" class="primary" onclick={submitShadeDraft} disabled={!shadeDraftReady}>
          {shadeDraft.busy ? '…' : 'Save shade source'}
        </button>
        <button type="button" onclick={dismissShadeDraft}>Discard</button>
      </div>
    </div>
  </div>
{/if}

{#if pendingDraft}
  <div
    class="draft-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="draft-title"
    onclick={(e) => e.target === e.currentTarget && dismissDraft()}
    onkeydown={(e) => e.key === 'Escape' && dismissDraft()}
    tabindex="-1"
  >
    <div class="draft-modal">
      {#if pendingDraft.acres !== null}
        <p class="acres-hint">Area ≈ <strong>{pendingDraft.acres.toFixed(2)} ac</strong></p>
      {/if}

      {#if pendingDraft.mode === 'block'}
        <!-- ── Block mode ── -->
        <h2 id="draft-title">Assign block geometry</h2>

        {#if pendingDraft.blockChoices.length > 0}
          <div class="mode-radio">
            <label>
              <input type="radio" bind:group={pendingDraft.assignMode} value="existing" />
              Assign to existing block
            </label>
            <label>
              <input type="radio" bind:group={pendingDraft.assignMode} value="new" />
              Create new block
            </label>
          </div>
        {/if}

        {#if pendingDraft.assignMode === 'existing'}
          <label>
            Block
            <select bind:value={pendingDraft.existingBlockId}>
              {#each pendingDraft.blockChoices as c (c.id)}
                <option value={c.id}>{c.name}{c.fieldName ? ` (${c.fieldName})` : ''}</option>
              {/each}
            </select>
          </label>
        {:else}
          <label>
            Block name
            <input type="text" bind:value={pendingDraft.newBlockName} placeholder="e.g. Corn Block A" />
          </label>
          {#if fields.length > 1}
            <label>
              Field
              <select bind:value={pendingDraft.newBlockFieldId}>
                {#each fields as f (f.id)}
                  <option value={f.id}>{f.name}</option>
                {/each}
              </select>
            </label>
          {/if}
        {/if}

      {:else}
        <!-- ── Field mode ── -->
        <h2 id="draft-title">Assign field boundary</h2>

        {#if pendingDraft.fieldChoices.length > 0}
          <div class="mode-radio">
            <label>
              <input type="radio" bind:group={pendingDraft.assignFieldMode} value="existing" />
              Assign to existing field
            </label>
            <label>
              <input type="radio" bind:group={pendingDraft.assignFieldMode} value="new" />
              Create new field
            </label>
          </div>
        {/if}

        {#if pendingDraft.assignFieldMode === 'existing'}
          <label>
            Field
            <select bind:value={pendingDraft.existingFieldId}>
              {#each pendingDraft.fieldChoices as c (c.id)}
                <option value={c.id}>{c.name}</option>
              {/each}
            </select>
          </label>
        {:else}
          <label>
            Field name
            <input type="text" bind:value={pendingDraft.newFieldName} placeholder="e.g. North Field" />
          </label>
        {/if}
      {/if}

      {#if pendingDraft.error}<p class="map-error">{pendingDraft.error}</p>{/if}

      <div class="actions">
        <button
          type="button"
          class="primary"
          onclick={submitDraft}
          disabled={!draftReady}
        >
          {#if pendingDraft.busy}…
          {:else if pendingDraft.mode === 'block'}
            {pendingDraft.assignMode === 'existing' ? 'Assign geometry' : 'Save block'}
          {:else}
            {pendingDraft.assignFieldMode === 'existing' ? 'Assign boundary' : 'Save field'}
          {/if}
        </button>
        <button type="button" onclick={dismissDraft}>Discard</button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Leaflet renders divIcons outside the component scope, so the badge
     styling has to be :global. */
  :global(.block-badge-wrap) {
    background: transparent !important;
    border: 0 !important;
  }
  :global(.block-badge) {
    display: inline-block;
    transform: translate(-50%, -50%);
    background: rgba(255, 255, 255, 0.95);
    border-radius: 999px;
    padding: 2px 8px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
    font-size: 1.1rem;
    line-height: 1.2;
    white-space: nowrap;
    pointer-events: none;
    user-select: none;
  }
  :global(.shade-marker-wrap) {
    background: transparent !important;
    border: 0 !important;
  }
  :global(.shade-marker) {
    display: inline-block;
    transform: translate(-50%, -50%);
    font-size: 1.4rem;
    line-height: 1;
    text-shadow:
      0 0 3px rgba(255, 255, 255, 0.95),
      0 0 6px rgba(255, 255, 255, 0.7);
    pointer-events: none;
    user-select: none;
  }
  .map-shell {
    position: relative;
    margin-bottom: 1rem;
    background: white;
    border-radius: 8px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    overflow: hidden;
  }
  .map {
    width: 100%;
    height: 480px;
    background: #f5f7f4;
  }
  .map-thumbnail .map { height: 200px; }
  .thumbnail-overlay {
    position: absolute;
    inset: 0;
    z-index: 500;
    cursor: pointer;
    display: flex;
    align-items: flex-end;
    justify-content: flex-end;
    padding: 0.5rem;
  }
  .thumbnail-hint {
    background: rgba(0,0,0,0.55);
    color: #fff;
    font-size: 0.75rem;
    padding: 0.2rem 0.6rem;
    border-radius: 4px;
    pointer-events: none;
  }
  .toolbar {
    position: absolute;
    bottom: 2rem;
    left: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    z-index: 500;
  }
  .tool {
    background: white;
    border: 2px solid #1f5e3a;
    color: #1f5e3a;
    font-weight: 600;
    border-radius: 6px;
    padding: 0.6rem 0.9rem;
    min-height: 48px;
    cursor: pointer;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
    font: inherit;
    text-align: left;
  }
  .tool:hover { background: #f8fbf9; }
  .tool.primary { background: #1f5e3a; color: white; }
  .tool.primary:hover { background: #2a7849; }
  .tool.danger { background: #b00020; color: white; border-color: #b00020; }
  .tool.done { background: #1a5276; color: white; border-color: #1a5276; }
  .tool.done:hover { background: #1f6391; }
  .map-error { color: #b00020; padding: 0.5rem 0.75rem; margin: 0; background: #fce4e4; }
  .hint { background: #fff3cd; color: #b35900; padding: 0.5rem 0.75rem; margin: 0; font-size: 0.9rem; }

  /* Draft modal */
  .draft-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }
  .draft-modal {
    background: white;
    border-radius: 8px;
    padding: 1.5rem;
    max-width: 420px;
    width: 100%;
    border-top: 6px solid #1f5e3a;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  }
  .draft-modal h2 { margin: 0 0 0.75rem; color: #1f5e3a; font-size: 1.2rem; }
  .draft-modal label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.9rem;
    margin: 0.5rem 0;
  }
  .draft-modal input[type='text'],
  .draft-modal select {
    padding: 0.6rem;
    border: 2px solid #d0d7d0;
    border-radius: 4px;
    font-size: 1rem;
    min-height: 48px;
    font-family: inherit;
  }
  .acres-hint { color: #555; margin: 0 0 0.75rem; font-size: 0.95rem; }

  /* Assign / create radio toggle */
  .mode-radio {
    display: flex;
    gap: 1rem;
    margin: 0.5rem 0 0.75rem;
    padding: 0.6rem;
    background: #f5f7f4;
    border-radius: 6px;
  }
  .mode-radio label {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.9rem;
    margin: 0;
    cursor: pointer;
  }
  .mode-radio input[type='radio'] { margin: 0; accent-color: #1f5e3a; }

  .draft-modal .actions { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
  .draft-modal .actions button {
    flex: 1;
    padding: 0.75rem;
    border-radius: 6px;
    border: 2px solid #1f5e3a;
    background: white;
    color: #1f5e3a;
    font-weight: 600;
    cursor: pointer;
    min-height: 48px;
    font: inherit;
  }
  .draft-modal .actions button.primary { background: #1f5e3a; color: white; }
  .draft-modal .actions button:disabled {
    background: #999;
    border-color: #999;
    color: white;
    cursor: not-allowed;
  }
  .shade-grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }
  .shade-defaults-hint {
    font-size: 0.75rem;
    color: #6b7280;
    margin: 0.25rem 0 0.6rem;
  }
  .shade-picker {
    position: absolute;
    left: calc(100% + 0.5rem);
    bottom: 0;
    z-index: 1000;
    padding: 0.45rem 0.5rem 0.5rem;
    background: white;
    border: 1px solid #cbd5e1;
    border-radius: 0.5rem;
    box-shadow: 0 6px 20px rgba(0,0,0,0.15);
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.2rem 0.35rem;
    width: 16rem;
  }
  .shade-picker-hint {
    grid-column: 1 / -1;
    margin: 0 0 0.15rem;
    font-size: 0.75rem;
    color: #475569;
  }
  .shade-picker-row {
    grid-column: 1 / -1;
    font-size: 0.65rem;
    color: #6b7280;
    margin: 0.2rem 0 0;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 1px solid #e5e7eb;
    padding-bottom: 0.15rem;
  }
  .shade-picker-btn {
    text-align: left;
    padding: 0.3rem 0.45rem;
    font-size: 0.8rem;
    line-height: 1.2;
    border: 1px solid #d1d5db;
    background: white;
    border-radius: 0.25rem;
    cursor: pointer;
    color: #1f2937;
    min-height: 32px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .shade-picker-btn:hover { background: #f3f4f6; border-color: #15803d; }
  .shade-picker-cancel {
    grid-column: 1 / -1;
    margin-top: 0.25rem;
    padding: 0.3rem 0.5rem;
    font-size: 0.75rem;
    background: transparent;
    border: 1px solid #d1d5db;
    border-radius: 0.25rem;
    color: #6b7280;
    cursor: pointer;
  }
  .tool.active {
    background: #15803d;
    color: white;
    border-color: #15803d;
  }
  .shade-checkbox {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.5rem 0;
    font-size: 0.95rem;
  }
  .shade-checkbox input { width: auto; accent-color: #15803d; }
</style>
