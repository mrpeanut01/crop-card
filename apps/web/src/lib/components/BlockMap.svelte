<script lang="ts">
  import { escapeHtml } from '$lib/html';
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
  import UnitInput from '$lib/components/ui/UnitInput.svelte';
  import AreaDetailsFields from '$lib/components/farm/AreaDetailsFields.svelte';
  import MapFeatureFields from '$lib/components/farm/MapFeatureFields.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { fmt } from '$lib/prefsState.svelte';
  import {
    AREA_KINDS,
    AREA_KIND_LABELS,
    isCropBearing,
    perimeterFtFromGeojson,
    type AreaDetails,
    type AreaKind
  } from '$lib/farm/areaKinds';
  import { AREA_NAME_PLACEHOLDER, kindStyle, shadeStyle, type AddPick } from '$lib/farm/kindStyle';
  import { isFeatureVisible, isKindVisible, type MapFilter } from '$lib/farm/mapFilter';
  import {
    MAP_FEATURE_LABELS,
    MAP_FEATURE_STYLE,
    describeFeature,
    geometryTypeFor,
    lineLengthFt,
    parseFeatureGeometry,
    type FeatureGeometry,
    type MapFeatureDetails,
    type MapFeatureKind,
    type MapFeatureView
  } from '$lib/farm/mapFeatures';
  import { bodyFromDraft, draftFromFeature, type FeatureFormDraft } from '$lib/farm/mapFeatureForm';
  import { detailsFromDraft, draftFromDetails, type DetailsDraft } from '$lib/farm/areaDetailsForm';
  import 'leaflet/dist/leaflet.css';
  import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
  import { geojsonCentroid, metersSquaredToAcres, polygonAreaSqMeters } from '$lib/geo/area';
  import type {
    Map as LMap,
    Polygon as LPolygon,
    LayerGroup,
    GeoJSON as LGeoJSON,
    TileLayer
  } from 'leaflet';
  import type { BlockWithPlantings } from '$lib/db/blocks';
  import type { FieldWithBlocks } from '$lib/db/fields';

  type Geom = { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] };
  type SaveCallback = (id: string, geom: Geom | null) => Promise<void> | void;
  type CreateBlockCb = (geom: Geom, acres: number | null) => Promise<void> | void;
  type AreaExtra = { kind: AreaKind; details: AreaDetails | null };
  type CreateFieldCb = (
    name: string,
    geom: Geom,
    acres: number | null,
    extra?: AreaExtra
  ) => Promise<void> | void;
  type SaveAreaDetailsCb = (fieldId: string, extra: AreaExtra) => Promise<void> | void;

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
    kind: AreaKind;
    details: DetailsDraft;
    perimeterFt: number | null;
    /** True when the draw started from a pick in the Add drawer. */
    typed: boolean;
    // shared
    busy: boolean;
    error: string | null;
  };

  /** v1.3 shade-source: external shade emitter rendered alongside blocks. */
  export type ShadeSourceLite = {
    id: string;
    name: string;
    fieldId?: string;
    kind:
      | 'tree-row'
      | 'tree-grove'
      | 'tree-single'
      | 'hedge'
      | 'building'
      | 'fence'
      | 'structure'
      | 'other';
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
  export type CreateMapFeatureCb = (input: {
    kind: MapFeatureKind;
    name: string;
    geometry: FeatureGeometry;
    fieldId: string | null;
    details: MapFeatureDetails | null;
  }) => Promise<void>;
  export type UpdateMapFeatureGeometryCb = (id: string, geometry: FeatureGeometry) => Promise<void>;
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
    showBlockLabels = false,
    declutterLabels = false,
    shadeSources = [],
    onCreateShadeSource,
    onDeleteShadeSource,
    onUpdateShadeGeometry,
    mapFeatures = [],
    onCreateMapFeature,
    onUpdateMapFeatureGeometry,
    onBusyChange,
    initialCenter = null,
    autoLocate = false,
    filter,
    onSelectArea,
    onSaveAreaDetails
  }: {
    blocks: BlockWithPlantings[];
    fields: FieldWithBlocks[];
    canEdit: boolean;
    thumbnail?: boolean;
    onThumbnailClick?: () => void;
    /** Render a permanent, high-contrast name pill at each block centroid
     *  (read-only surfaces like /plan layout). Off by default so the crops
     *  tab + thumbnail previews keep their hover-only block tooltips. */
    showBlockLabels?: boolean;
    /** Run a greedy collision-avoidance pass on the permanent labels so block
     *  names never overlap; falls back to a compact badge when a label can't
     *  be separated at the current zoom. Re-runs on zoom/pan. */
    declutterLabels?: boolean;
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
    /** Lines and points: fences, gates, water sources, hydrants, irrigation
     *  lines and paths. */
    mapFeatures?: MapFeatureView[];
    onCreateMapFeature?: CreateMapFeatureCb;
    onUpdateMapFeatureGeometry?: UpdateMapFeatureGeometryCb;
    /** Where the map opens before any geometry exists (the farm location).
     *  Once blocks or fields are drawn, the map fits to them instead. */
    initialCenter?: { lat: number; lon: number } | null;
    /** When nothing is drawn yet, center on the browser's location (the
     *  browser asks the user first). */
    autoLocate?: boolean;
    /** Layer toggles from the map's Filter panel. When set, the Satellite
     *  toggle replaces Leaflet's base-layer control. */
    filter?: MapFilter;
    /** Tapping an Area opens its card instead of starting an edit. */
    onSelectArea?: (fieldId: string) => void;
    onSaveAreaDetails?: SaveAreaDetailsCb;
    /** True while a shape is being drawn or its details form is open, so
     *  the page can keep coachmarks off the drawing. */
    onBusyChange?: (busy: boolean) => void;
  } = $props();

  // ── Colors by Area kind ──────────────────────────────────────────────────
  const fieldKindMap = new Map<string, AreaKind>();

  function buildFieldColorMap() {
    fieldKindMap.clear();
    for (const f of fields) fieldKindMap.set(f.id, f.kind ?? 'field');
  }

  function blockColor(fieldId: string | undefined): string {
    return kindStyle(fieldId ? fieldKindMap.get(fieldId) : 'field').color;
  }

  function areaVisible(kind: AreaKind | undefined): boolean {
    return !filter || isKindVisible(filter, kind);
  }

  const labelsOn = $derived(!filter || filter.labels);
  const blockParents = $derived(fields.filter((f) => isCropBearing(f.kind ?? 'field')));

  // ── Map state ────────────────────────────────────────────────────────────
  let mapEl: HTMLDivElement;
  let map: LMap | null = null;
  let satelliteLayer: TileLayer | null = null;
  let streetsLayer: TileLayer | null = null;
  let fieldLayer: LayerGroup | null = null; // rendered below blockLayer
  let blockLayer: LayerGroup | null = null;
  /** v1.3 — shade-source layer renders above blocks. */
  let shadeLayer: LayerGroup | null = null;
  let featureLayer: LayerGroup | null = null;
  /** Permanent block-name labels render above everything else. */
  let labelLayer: LayerGroup | null = null;
  /** Live label elements + their map anchor, rebuilt on every block render and
   *  re-flowed by the declutter pass. */
  let labelEntries: Array<{
    el: HTMLElement;
    lat: number;
    lon: number;
    full: string;
    compact: string;
  }> = [];
  let labelRelayoutQueued = false;

  const polygonToBlockId = new Map<number, string>();
  const polygonToFieldId = new Map<number, string>();
  const fieldLayersById = new Map<string, LGeoJSON>();
  const polygonToShadeId = new Map<number, string>();

  let pendingDraft = $state<DraftState | null>(null);
  /** Active draw mode. 'auto' = field/block by centroid containment;
   *  'shade-line' = drawing a tree row / fence / hedge;
   *  'shade-polygon' = drawing a tree grove / building / structure. */
  let drawMode = $state<
    'auto' | 'area' | 'block' | 'shade-line' | 'shade-polygon' | 'feature-line' | 'feature-point'
  >('auto');
  let pendingFeatureKind = $state<MapFeatureKind>('fence');
  let featureDraft = $state<FeatureDraft | null>(null);
  let pendingAreaKind = $state<AreaKind>('field');
  /** Pending shade-source draft (after shape is drawn). */
  let shadeDraft = $state<ShadeDraft | null>(null);
  let drawing = $state(false);
  let editingActive = $state(false);
  let drawError = $state<string | null>(null);

  type FeatureDraft = {
    kind: MapFeatureKind;
    geometry: FeatureGeometry;
    lengthFt: number | null;
    form: FeatureFormDraft;
    busy: boolean;
    error: string | null;
  };

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

  const busy = $derived(drawing || !!featureDraft || !!shadeDraft || !!pendingDraft);
  $effect(() => {
    onBusyChange?.(busy);
  });

  // ── Geometry helpers ─────────────────────────────────────────────────────

  function polygonCentroid(ring: Array<[number, number]>): [number, number] {
    let x = 0,
      y = 0;
    for (const [lng, lat] of ring) {
      x += lng;
      y += lat;
    }
    return [x / ring.length, y / ring.length];
  }

  function pointInRing(pt: [number, number], ring: Array<[number, number]>): boolean {
    const [px, py] = pt;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i],
        [xj, yj] = ring[j];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function pointInField(lon: number, lat: number, field: FieldWithBlocks): boolean {
    return centroidInField({ type: 'Polygon', coordinates: [[[lon, lat]]] }, field);
  }

  function centroidInField(drawnGeom: Geom, field: FieldWithBlocks): boolean {
    if (!field.geometryGeojson) return false;
    let fg: unknown;
    try {
      fg = JSON.parse(field.geometryGeojson);
    } catch {
      return false;
    }
    const outerRing =
      drawnGeom.type === 'Polygon'
        ? ((drawnGeom.coordinates as number[][][])[0] as Array<[number, number]>)
        : ((drawnGeom.coordinates as number[][][][])[0][0] as Array<[number, number]>);
    const centroid = polygonCentroid(outerRing);
    const g = fg as {
      type: string;
      coordinates?: unknown;
      geometry?: { type: string; coordinates: unknown };
      features?: Array<{ geometry: { type: string; coordinates: unknown } }>;
    };
    const checkCoords = (type: string, coords: unknown): boolean => {
      if (type === 'Polygon')
        return pointInRing(centroid, (coords as number[][][])[0] as Array<[number, number]>);
      if (type === 'MultiPolygon')
        return (coords as number[][][][]).some((p) =>
          pointInRing(centroid, p[0] as Array<[number, number]>)
        );
      return false;
    };
    if (g.type === 'Feature' && g.geometry)
      return checkCoords(g.geometry.type, g.geometry.coordinates);
    if (g.type === 'FeatureCollection' && g.features)
      return g.features.some((f) => checkCoords(f.geometry.type, f.geometry.coordinates));
    return checkCoords(g.type, g.coordinates);
  }

  const draftReady = $derived.by(() => {
    if (!pendingDraft || pendingDraft.busy) return false;
    if (pendingDraft.mode === 'block') {
      return pendingDraft.assignMode === 'existing'
        ? !!pendingDraft.existingBlockId
        : !!pendingDraft.newBlockName.trim() && !!pendingDraft.newBlockFieldId;
    }
    return pendingDraft.assignFieldMode === 'existing'
      ? !!pendingDraft.existingFieldId
      : !!pendingDraft.newFieldName.trim();
  });

  const LOCATE_GIVE_UP_MS = 15000;
  let markMapReady: () => void = () => {};
  const mapReady = new Promise<void>((resolve) => (markMapReady = resolve));

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
    }).setView(
      initialCenter ? [initialCenter.lat, initialCenter.lon] : [39.1, -77.55],
      initialCenter ? 16 : 13
    );
    markMapReady();

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
    satelliteLayer = satellite;
    streetsLayer = streets;
    if (filter && !filter.satellite) streets.addTo(map);
    else satellite.addTo(map);
    if (!thumbnail && !filter) {
      L.control
        .layers({ Satellite: satellite, Streets: streets }, undefined, { position: 'topright' })
        .addTo(map);
    }

    // Fields layer first so it renders beneath blocks.
    fieldLayer = L.layerGroup().addTo(map);
    blockLayer = L.layerGroup().addTo(map);
    shadeLayer = L.layerGroup().addTo(map);
    featureLayer = L.layerGroup().addTo(map);
    // Permanent name labels render on top of every polygon layer.
    labelLayer = L.layerGroup().addTo(map);

    buildFieldColorMap();
    renderFields(L);
    renderBlocks(L);
    renderShadeSources(L);
    renderMapFeatures(L);
    const fitted = fitToAll(L);
    if (!fitted && autoLocate && !thumbnail) void centerOnMe();

    if (showBlockLabels && declutterLabels) {
      map.on('zoomend moveend', scheduleLabelRelayout);
      scheduleLabelRelayout();
    }

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
          'display:flex;align-items:center;justify-content:center;width:44px;height:44px;background:white;border:none;cursor:pointer;font-size:1.3rem;';
        L.DomEvent.disableClickPropagation(wrap);
        L.DomEvent.on(btn, 'click', () => {
          void centerOnMe().then((msg) => {
            if (msg) drawError = msg;
          });
        });
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
        if (_suppressNextMapClick) {
          _suppressNextMapClick = false;
          return;
        }
        if (editingActive) stopEditing();
      });

      map.on('pm:create', (e: { layer: LPolygon }) => {
        drawing = false;
        const layer = e.layer as LPolygon;
        const geojson = (layer.toGeoJSON() as { geometry: Geom }).geometry;
        layer.remove();

        if (drawMode === 'feature-line' || drawMode === 'feature-point') {
          const kind = pendingFeatureKind;
          drawMode = 'auto';
          map?.pm.disableDraw();
          const parsed = parseFeatureGeometry(
            kind,
            (layer.toGeoJSON() as { geometry: unknown }).geometry
          );
          if (!parsed.ok) {
            drawError =
              geometryTypeFor(kind) === 'LineString'
                ? 'That line needs at least two points. Try again.'
                : 'That spot could not be read. Try again.';
            return;
          }
          featureDraft = {
            kind,
            geometry: parsed.geometry,
            lengthFt: lineLengthFt(parsed.geometry),
            form: { ...draftFromFeature(), fieldId: suggestFieldFor(parsed.geometry) },
            busy: false,
            error: null
          };
          return;
        }

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
        const typedArea = drawMode === 'area';
        const typedBlock = drawMode === 'block';
        const areaKind = pendingAreaKind;
        drawMode = 'auto';

        // The legacy tool auto-detects: inside an existing Area → block,
        // otherwise → a new Area. A kind picked from the Add drawer skips that.
        const inside = fields.filter((f) => centroidInField(geojson, f));
        const containingField = typedArea
          ? undefined
          : (inside.find((f) => isCropBearing(f.kind ?? 'field')) ?? inside[0]);

        if (containingField || typedBlock) {
          const parent = containingField ?? fields.find((f) => isCropBearing(f.kind ?? 'field'));
          const unmapped = parent
            ? blocks.filter((b) => !b.geometryGeojson && b.fieldId === parent.id)
            : [];
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
            newBlockFieldId: parent?.id ?? '',
            assignFieldMode: 'new',
            fieldChoices: [],
            existingFieldId: '',
            newFieldName: '',
            kind: parent?.kind ?? 'field',
            details: {},
            perimeterFt: null,
            typed: typedBlock,
            busy: false,
            error: null
          };
        } else {
          const kind: AreaKind = typedArea ? areaKind : 'field';
          const undrawn = fields.filter((f) => !f.geometryGeojson);
          const unmapped = typedArea
            ? undrawn.filter((f) => (f.kind ?? 'field') === kind)
            : undrawn;
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
            kind,
            details: draftFromDetails(kind, null),
            perimeterFt: perimeterFtFromGeojson(JSON.stringify(geojson)),
            typed: typedArea,
            busy: false,
            error: null
          };
        }
      });
    }
  });

  onDestroy(() => {
    if (map) {
      map.remove();
      map = null;
    }
  });

  // ── Render ───────────────────────────────────────────────────────────────

  function renderFields(L: typeof import('leaflet')) {
    if (!map || !fieldLayer) return;
    fieldLayer.clearLayers();
    polygonToFieldId.clear();
    fieldLayersById.clear();
    for (const f of fields) {
      if (!f.geometryGeojson) continue;
      if (!areaVisible(f.kind)) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(f.geometryGeojson);
      } catch {
        continue;
      }
      const ks = kindStyle(f.kind);
      const layer = L.geoJSON(parsed as never, {
        style: () => ({
          color: ks.color,
          weight: ks.weight,
          dashArray: ks.dashArray,
          fillColor: ks.color,
          fillOpacity: ks.fillOpacity
        })
      });
      layer.bindTooltip(
        escapeHtml(f.name),
        labelsOn
          ? { permanent: true, direction: 'center', className: 'field-label-tip' }
          : { direction: 'center' }
      );
      const id = (layer as unknown as { _leaflet_id: number })._leaflet_id;
      polygonToFieldId.set(id, f.id);
      fieldLayersById.set(f.id, layer as LGeoJSON);
      (layer as LGeoJSON).eachLayer((l) => {
        const poly = l as LPolygon & { pm: { enable: (o: object) => void } };
        if (canEdit) {
          l.on('pm:edit', () => debouncedFieldSave(f.id, poly));
          l.on('contextmenu', () => removeFieldGeometry(f.id, f.name));
        }
        l.on('click', () => {
          if (drawing) return;
          _suppressNextMapClick = true;
          if (onSelectArea && !editingActive) {
            onSelectArea(f.id);
            return;
          }
          if (!canEdit) return;
          editingActive = true;
          poly.pm.enable({ snappable: true, allowSelfIntersection: false });
        });
      });
      layer.addTo(fieldLayer);
      (layer as LGeoJSON).eachLayer((l) => {
        const el = (l as unknown as { getElement?: () => Element | undefined }).getElement?.();
        el?.setAttribute('data-area-id', f.id);
        el?.setAttribute('data-area-kind', f.kind ?? 'field');
      });
    }
  }

  function renderBlocks(L: typeof import('leaflet')) {
    if (!map || !blockLayer) return;
    blockLayer.clearLayers();
    polygonToBlockId.clear();
    if (labelLayer) labelLayer.clearLayers();
    labelEntries = [];
    for (const b of blocks) {
      if (!b.geometryGeojson) continue;
      if (!areaVisible(b.fieldId ? fieldKindMap.get(b.fieldId) : 'field')) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(b.geometryGeojson);
      } catch {
        continue;
      }
      const color = blockColor(b.fieldId);
      const layer = L.geoJSON(parsed as never, {
        style: () => ({ color, weight: 2, fillColor: color, fillOpacity: 0.22 })
      });
      layer.bindTooltip(escapeHtml(b.name), { direction: 'center' });
      const id = (layer as unknown as { _leaflet_id: number })._leaflet_id;
      polygonToBlockId.set(id, b.id);

      // Permanent, high-contrast name pill at the centroid for read-only
      // surfaces. The declutter pass (when enabled) keeps these from
      // overlapping; without it they render at the raw centroid.
      if (showBlockLabels && labelsOn && !thumbnail && labelLayer) {
        const centroid = geojsonCentroid(b.geometryGeojson);
        if (centroid) {
          const [lon, lat] = centroid;
          const full = b.name;
          const compact = b.blockLabel?.trim() || b.name.charAt(0).toUpperCase();
          const icon = L.divIcon({
            html: `<span class="block-label">${escapeHtml(full)}</span>`,
            className: 'block-label-wrap',
            iconSize: [0, 0]
          });
          const marker = L.marker([lat, lon], {
            icon,
            interactive: false,
            keyboard: false
          }).addTo(labelLayer);
          const el = marker.getElement()?.querySelector('.block-label') as HTMLElement | null;
          if (el) labelEntries.push({ el, lat, lon, full, compact });
        }
      }

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
    if (filter && !filter.shade) return;
    for (const s of shadeSources) {
      if (!s.geometryGeojson) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(s.geometryGeojson);
      } catch {
        continue;
      }
      const isLine = isLineGeometry(parsed);
      // Distinct visual: dashed gray-green for tree-rows; dashed dark-amber
      // for buildings/structures so they don't compete with field/block colors.
      const { color: stroke, fill } = shadeStyle(s.kind);
      const layer = L.geoJSON(parsed as never, {
        style: () => ({
          color: stroke,
          weight: isLine ? 4 : 2,
          dashArray: '6 6',
          fillColor: fill,
          fillOpacity: isLine ? 0 : 0.18
        })
      });
      const tooltipText = `${s.name} · ${s.kind} · ${fmt.qty(s.heightFt, 'distance')}${s.isDeciduous ? ' · deciduous' : ''}`;
      layer.bindTooltip(escapeHtml(tooltipText), { direction: 'top' });
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
        const iconHtml = `<span class="shade-marker" title="${escapeHtml(s.name)}">${emoji}</span>`;
        const icon = L.divIcon({
          html: iconHtml,
          className: 'shade-marker-wrap',
          iconSize: [0, 0]
        });
        L.marker([lat, lon], { icon, interactive: false, keyboard: false }).addTo(shadeLayer);
      }
    }
  }

  function featureMarkerIcon(L: typeof import('leaflet'), kind: MapFeatureKind, name: string) {
    const st = MAP_FEATURE_STYLE[kind];
    return L.divIcon({
      html: `<span class="feature-pin" data-feature-kind="${kind}" style="--pin:${st.color}" title="${escapeHtml(name)}">${st.symbol ?? ''}</span>`,
      className: 'feature-pin-wrap',
      iconSize: [0, 0]
    });
  }

  function renderMapFeatures(L: typeof import('leaflet')) {
    if (!map || !featureLayer) return;
    featureLayer.clearLayers();
    for (const f of mapFeatures) {
      if (!f.geometry) continue;
      if (filter && !isFeatureVisible(filter, f.kind)) continue;
      const st = MAP_FEATURE_STYLE[f.kind];
      const tip = describeFeature(f, (ft) => fmt.qty(ft, 'distance', { digits: 0 }));
      let layer: import('leaflet').Layer;
      if (f.geometry.type === 'LineString') {
        const latlngs = f.geometry.coordinates.map(([lon, lat]) => [lat, lon] as [number, number]);
        layer = L.polyline(latlngs, {
          color: st.color,
          weight: st.weight + 1,
          dashArray: st.dashArray,
          opacity: 0.95,
          className: `feature-line feature-${f.kind}`
        });
      } else {
        const [lon, lat] = f.geometry.coordinates;
        layer = L.marker([lat, lon], {
          icon: featureMarkerIcon(L, f.kind, f.name),
          keyboard: false,
          title: f.name
        });
      }
      layer.bindTooltip(escapeHtml(`${MAP_FEATURE_LABELS[f.kind]}: ${tip}`), { direction: 'top' });
      if (canEdit && onUpdateMapFeatureGeometry) {
        const id = f.id;
        const kind = f.kind;
        const editable = layer as import('leaflet').Layer & {
          pm: { enable: (o: object) => void };
          toGeoJSON: () => { geometry: unknown };
        };
        layer.on('pm:edit', () => debouncedFeatureSave(id, kind, editable));
        layer.on('click', () => {
          if (drawing) return;
          _suppressNextMapClick = true;
          editingActive = true;
          editable.pm.enable({ snappable: true, allowSelfIntersection: true });
        });
      }
      layer.addTo(featureLayer);
    }
  }

  function suggestFieldFor(geometry: FeatureGeometry): string {
    const [lon, lat] =
      geometry.type === 'Point'
        ? geometry.coordinates
        : geometry.coordinates[Math.floor(geometry.coordinates.length / 2)];
    const inside = fields.find((f) => pointInField(lon, lat, f));
    return inside?.id ?? '';
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
    void blocks;
    void fields;
    void shadeSources;
    void mapFeatures;
    const f = filter;
    if (!browser || !map) return;
    if (f && satelliteLayer && streetsLayer) {
      const [on, off] = f.satellite
        ? [satelliteLayer, streetsLayer]
        : [streetsLayer, satelliteLayer];
      if (map.hasLayer(off)) map.removeLayer(off);
      if (!map.hasLayer(on)) {
        on.addTo(map);
        on.bringToBack();
      }
    }
    import('leaflet').then((mod) => {
      buildFieldColorMap();
      renderFields(mod.default);
      renderBlocks(mod.default);
      renderShadeSources(mod.default);
      renderMapFeatures(mod.default);
      if (showBlockLabels && declutterLabels) scheduleLabelRelayout();
    });
  });

  /** Coalesce relayout requests into one rAF tick so zoom/pan/data churn
   *  doesn't thrash layout. */
  function scheduleLabelRelayout() {
    if (labelRelayoutQueued) return;
    labelRelayoutQueued = true;
    requestAnimationFrame(() => {
      labelRelayoutQueued = false;
      relayoutLabels();
    });
  }

  /**
   * Greedy collision-avoidance for the permanent block labels. Resets every
   * label to its true centroid, then places labels north-to-south, nudging any
   * that would overlap an already-placed label. A label that still can't be
   * separated within the nudge budget collapses to its compact code so the
   * guarantee ("no overlap") always holds. Idempotent — safe to re-run on
   * every zoom/pan/render.
   */
  function relayoutLabels() {
    if (!map || !labelEntries.length) return;
    // Reset to full text + base transform before measuring.
    for (const e of labelEntries) {
      e.el.classList.remove('block-label--compact');
      e.el.innerHTML = escapeHtml(e.full);
      e.el.style.transform = 'translate(-50%, -50%)';
    }
    const sorted = [...labelEntries].sort((a, b) => b.lat - a.lat);
    const placed: Array<{ cx: number; cy: number; w: number; h: number }> = [];
    const PAD = 2;
    const STEP = 4;
    const CAP = 28;
    const overlaps = (box: { cx: number; cy: number; w: number; h: number }) =>
      placed.find(
        (q) =>
          Math.abs(box.cx - q.cx) < (box.w + q.w) / 2 + PAD &&
          Math.abs(box.cy - q.cy) < (box.h + q.h) / 2 + PAD
      );
    // Greedily nudge a box (vertically first, then horizontally) until it
    // clears every already-placed box or the budget is exhausted. Captures the
    // colliding box once per step rather than re-scanning twice.
    const nudgeClear = (px: number, py: number, w: number, h: number) => {
      let dx = 0;
      let dy = 0;
      let hit: { cx: number; cy: number } | undefined;
      for (let guard = 0; guard < 200; guard++) {
        hit = overlaps({ cx: px + dx, cy: py + dy, w, h });
        if (!hit) break;
        dy += py + dy >= hit.cy ? STEP : -STEP;
        if (Math.abs(dy) > CAP) {
          dy = 0;
          dx += STEP;
        }
        if (Math.abs(dx) > CAP) break;
      }
      return { dx, dy, clear: !hit };
    };
    for (const e of sorted) {
      const p = map.latLngToContainerPoint([e.lat, e.lon]);
      let { dx, dy, clear } = nudgeClear(p.x, p.y, e.el.offsetWidth, e.el.offsetHeight);
      // Couldn't separate the full label — fall back to the compact code and
      // try once more from the centroid.
      if (!clear) {
        e.el.classList.add('block-label--compact');
        e.el.innerHTML = escapeHtml(e.compact);
        ({ dx, dy } = nudgeClear(p.x, p.y, e.el.offsetWidth, e.el.offsetHeight));
      }
      const w = e.el.offsetWidth;
      const h = e.el.offsetHeight;
      e.el.style.transform = `translate(-50%, -50%) translate(${dx}px, ${dy}px)`;
      placed.push({ cx: p.x + dx, cy: p.y + dy, w, h });
    }
  }

  function fitToAll(L: typeof import('leaflet')): boolean {
    if (!map) return false;
    const group = L.featureGroup([
      ...(fieldLayer?.getLayers() ?? []),
      ...(blockLayer?.getLayers() ?? []),
      ...(shadeLayer?.getLayers() ?? []),
      ...(featureLayer?.getLayers() ?? [])
    ] as Parameters<typeof L.featureGroup>[0]);
    const bounds = group.getBounds();
    if (!bounds.isValid()) return false;
    map.fitBounds(bounds, { padding: [40, 40] });
    return true;
  }

  // ── Debounced saves ───────────────────────────────────────────────────────

  const blockEditTimers = new Map<string, ReturnType<typeof setTimeout>>();
  function debouncedSave(blockId: string, poly: LPolygon) {
    const prev = blockEditTimers.get(blockId);
    if (prev) clearTimeout(prev);
    blockEditTimers.set(
      blockId,
      setTimeout(async () => {
        const geojson = (poly.toGeoJSON() as { geometry: Geom }).geometry;
        try {
          await onSaveGeometry(blockId, geojson);
        } catch (e) {
          drawError = e instanceof Error ? e.message : String(e);
        }
      }, 800)
    );
  }

  const fieldEditTimers = new Map<string, ReturnType<typeof setTimeout>>();
  function debouncedFieldSave(fieldId: string, poly: LPolygon) {
    const prev = fieldEditTimers.get(fieldId);
    if (prev) clearTimeout(prev);
    fieldEditTimers.set(
      fieldId,
      setTimeout(async () => {
        const geojson = (poly.toGeoJSON() as { geometry: Geom }).geometry;
        try {
          await onSaveFieldGeometry(fieldId, geojson);
        } catch (e) {
          drawError = e instanceof Error ? e.message : String(e);
        }
      }, 800)
    );
  }

  const shadeEditTimers = new Map<string, ReturnType<typeof setTimeout>>();
  function debouncedShadeSave(shadeId: string, poly: LPolygon) {
    if (!onUpdateShadeGeometry) return;
    const prev = shadeEditTimers.get(shadeId);
    if (prev) clearTimeout(prev);
    shadeEditTimers.set(
      shadeId,
      setTimeout(async () => {
        const geojson = (poly.toGeoJSON() as { geometry: Geom }).geometry;
        try {
          await onUpdateShadeGeometry!(shadeId, JSON.stringify(geojson));
        } catch (e) {
          drawError = e instanceof Error ? e.message : String(e);
        }
      }, 800)
    );
  }

  const featureEditTimers = new Map<string, ReturnType<typeof setTimeout>>();
  function debouncedFeatureSave(
    id: string,
    kind: MapFeatureKind,
    layer: { toGeoJSON: () => { geometry: unknown } }
  ) {
    if (!onUpdateMapFeatureGeometry) return;
    const prev = featureEditTimers.get(id);
    if (prev) clearTimeout(prev);
    featureEditTimers.set(
      id,
      setTimeout(async () => {
        const parsed = parseFeatureGeometry(kind, layer.toGeoJSON().geometry);
        if (!parsed.ok) {
          drawError = 'That edit could not be saved. Try again.';
          return;
        }
        try {
          await onUpdateMapFeatureGeometry!(id, parsed.geometry);
        } catch (e) {
          drawError = e instanceof Error ? e.message : String(e);
        }
      }, 800)
    );
  }

  async function removeGeometry(blockId: string, name: string) {
    if (!confirm(`Remove polygon for block "${name}"?`)) return;
    try {
      await onSaveGeometry(blockId, null);
    } catch (e) {
      drawError = e instanceof Error ? e.message : String(e);
    }
  }

  async function removeFieldGeometry(fieldId: string, name: string) {
    if (!confirm(`Remove boundary for field "${name}"?`)) return;
    try {
      await onSaveFieldGeometry(fieldId, null);
    } catch (e) {
      drawError = e instanceof Error ? e.message : String(e);
    }
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
    drawError = null;
    drawing = true;
    drawMode = 'auto';
    map.pm.enableDraw('Polygon');
  }

  function cancelDraw() {
    if (!map) return;
    map.pm.disableDraw();
    drawing = false;
    drawMode = 'auto';
    pendingShadeKind = null;
  }

  /** Starts drawing whatever was picked in the Add drawer. */
  export function startDrawPick(pick: AddPick) {
    if (pick.type === 'shade') {
      startDrawShade(pick.kind);
      return;
    }
    if (pick.type === 'feature') {
      startDrawFeature(pick.kind);
      return;
    }
    if (!map || !canEdit) return;
    stopEditing();
    drawError = null;
    drawing = true;
    if (pick.type === 'area') {
      pendingAreaKind = pick.kind;
      drawMode = 'area';
    } else {
      drawMode = 'block';
    }
    map.pm.enableDraw('Polygon');
  }

  /** Turns on vertex editing for one Area's outline (from its card). */
  export function editArea(fieldId: string): boolean {
    const layer = fieldLayersById.get(fieldId);
    if (!layer || !canEdit || !map) return false;
    stopEditing();
    let bounds: import('leaflet').LatLngBounds | null = null;
    layer.eachLayer((l) => {
      const poly = l as LPolygon & { pm: { enable: (o: object) => void } };
      poly.pm.enable({ snappable: true, allowSelfIntersection: false });
      bounds = poly.getBounds();
    });
    editingActive = true;
    if (bounds) map.fitBounds(bounds, { padding: [40, 40] });
    return true;
  }

  export function hasAreaOnMap(fieldId: string): boolean {
    return fieldLayersById.has(fieldId);
  }

  /** Centers the map on the browser's location. Resolves with an error
   *  message when location is unavailable or the user declines. */
  export async function centerOnMe(): Promise<string | null> {
    await mapReady;
    if (!browser || !('geolocation' in navigator)) {
      return 'This browser does not share its location.';
    }
    const denied = 'Location permission is off. Allow it in your browser to center the map on you.';
    try {
      const status = await navigator.permissions?.query({ name: 'geolocation' });
      if (status?.state === 'denied') return denied;
    } catch {
      /* Permissions API missing; the request below still asks. */
    }
    return new Promise((resolve) => {
      // The geolocation timeout only starts once permission is granted, so an
      // unanswered prompt needs its own limit.
      const giveUp = setTimeout(
        () => resolve('No location yet. Allow location access in your browser, then try again.'),
        LOCATE_GIVE_UP_MS
      );
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(giveUp);
          map?.flyTo([pos.coords.latitude, pos.coords.longitude], 17);
          resolve(null);
        },
        (err) => {
          clearTimeout(giveUp);
          resolve(
            err.code === err.PERMISSION_DENIED
              ? denied
              : `Could not get your location: ${err.message}`
          );
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    });
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
        return {
          heightFt: '30',
          opacity: '0.7',
          isDeciduous: true,
          leafOnDayOfYear: '105',
          leafOffDayOfYear: '305',
          geomKind: 'LineString'
        };
      case 'hedge':
        return {
          heightFt: '6',
          opacity: '0.7',
          isDeciduous: true,
          leafOnDayOfYear: '105',
          leafOffDayOfYear: '305',
          geomKind: 'LineString'
        };
      case 'fence':
        return {
          heightFt: '6',
          opacity: '0.95',
          isDeciduous: false,
          leafOnDayOfYear: '105',
          leafOffDayOfYear: '305',
          geomKind: 'LineString'
        };
      case 'tree-grove':
        return {
          heightFt: '40',
          opacity: '0.7',
          isDeciduous: true,
          leafOnDayOfYear: '105',
          leafOffDayOfYear: '305',
          geomKind: 'Polygon'
        };
      case 'tree-single':
        return {
          heightFt: '25',
          opacity: '0.7',
          isDeciduous: true,
          leafOnDayOfYear: '105',
          leafOffDayOfYear: '305',
          geomKind: 'Polygon'
        };
      case 'building':
        return {
          heightFt: '20',
          opacity: '1.0',
          isDeciduous: false,
          leafOnDayOfYear: '105',
          leafOffDayOfYear: '305',
          geomKind: 'Polygon'
        };
      case 'structure':
        return {
          heightFt: '15',
          opacity: '0.9',
          isDeciduous: false,
          leafOnDayOfYear: '105',
          leafOffDayOfYear: '305',
          geomKind: 'Polygon'
        };
      default:
        return {
          heightFt: '20',
          opacity: '0.7',
          isDeciduous: false,
          leafOnDayOfYear: '105',
          leafOffDayOfYear: '305',
          geomKind: 'Polygon'
        };
    }
  }

  function shadeKindEmoji(kind: ShadeKind): string {
    switch (kind) {
      case 'tree-row':
        return '🌳';
      case 'tree-grove':
        return '🌲';
      case 'tree-single':
        return '🌳';
      case 'hedge':
        return '🌿';
      case 'building':
        return '🏠';
      case 'fence':
        return '🧱';
      case 'structure':
        return '🏗️';
      default:
        return '🌑';
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

  function startDrawFeature(kind: MapFeatureKind) {
    if (!map || !canEdit || !onCreateMapFeature) return;
    stopEditing();
    drawError = null;
    drawing = true;
    pendingFeatureKind = kind;
    const color = MAP_FEATURE_STYLE[kind].color;
    if (geometryTypeFor(kind) === 'LineString') {
      drawMode = 'feature-line';
      map.pm.enableDraw('Line', {
        templineStyle: { color },
        hintlineStyle: { color, dashArray: '5 5' }
      });
      return;
    }
    drawMode = 'feature-point';
    void import('leaflet').then((mod) => {
      if (!map || drawMode !== 'feature-point') return;
      const icon = featureMarkerIcon(mod.default, kind, MAP_FEATURE_LABELS[kind]);
      map.pm.enableDraw('Marker', { markerStyle: { icon }, continueDrawing: false });
    });
  }

  async function submitFeatureDraft() {
    if (!featureDraft || featureDraft.busy || !onCreateMapFeature) return;
    const checked = bodyFromDraft(featureDraft.kind, featureDraft.form);
    if (!checked.ok) {
      featureDraft.error = checked.message;
      return;
    }
    featureDraft.busy = true;
    featureDraft.error = null;
    try {
      await onCreateMapFeature({
        kind: featureDraft.kind,
        geometry: featureDraft.geometry,
        ...checked.body
      });
      featureDraft = null;
    } catch (e) {
      if (featureDraft) {
        featureDraft.error = e instanceof Error ? e.message : String(e);
        featureDraft.busy = false;
      }
    }
  }

  function dismissFeatureDraft() {
    featureDraft = null;
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
        const checked = detailsFromDraft(pendingDraft.kind, pendingDraft.details);
        if (!checked.ok) {
          pendingDraft.error = 'Some details don’t look right. Check them and try again.';
          return;
        }
        const extra = { kind: pendingDraft.kind, details: checked.details };
        if (pendingDraft.assignFieldMode === 'existing') {
          await onSaveFieldGeometry(pendingDraft.existingFieldId, pendingDraft.geom);
          const existing = fields.find((f) => f.id === pendingDraft?.existingFieldId);
          if (
            onSaveAreaDetails &&
            existing &&
            (existing.kind !== extra.kind || (pendingDraft.typed && extra.details))
          ) {
            await onSaveAreaDetails(existing.id, extra);
          }
        } else {
          await onCreateFieldWithGeometry(
            pendingDraft.newFieldName.trim(),
            pendingDraft.geom,
            pendingDraft.acres,
            extra
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

  function dismissDraft() {
    pendingDraft = null;
  }

  // Expose block name/fieldId for parent's createBlockWithGeometry.
  export function currentDraftName(): string {
    return pendingDraft?.newBlockName.trim() ?? '';
  }
  export function currentDraftFieldId(): string {
    return pendingDraft?.newBlockFieldId ?? '';
  }
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
      {:else if !filter}
        <button
          type="button"
          class="tool primary"
          onclick={startDraw}
          title="Draw a field or block polygon"
        >
          🌾 Field / Block
        </button>
        {#if onCreateShadeSource}
          <button
            type="button"
            class="tool"
            class:active={shadePickerOpen}
            onclick={toggleShadePicker}
            title="Add a shade source — pick a kind, then draw">🌑 Shade ▾</button
          >
          {#if shadePickerOpen && !drawing}
            <div class="shade-picker" role="menu" aria-label="Pick shade source kind">
              <p class="shade-picker-hint">Pick a kind to draw:</p>
              <div class="shade-picker-row"><strong>Lines</strong></div>
              <button
                type="button"
                class="shade-picker-btn"
                onclick={() => startDrawShade('tree-row')}>🌳 Tree row</button
              >
              <button type="button" class="shade-picker-btn" onclick={() => startDrawShade('hedge')}
                >🌿 Hedge</button
              >
              <button type="button" class="shade-picker-btn" onclick={() => startDrawShade('fence')}
                >🧱 Fence</button
              >
              <div class="shade-picker-row"><strong>Areas</strong></div>
              <button
                type="button"
                class="shade-picker-btn"
                onclick={() => startDrawShade('tree-grove')}>🌲 Tree grove</button
              >
              <button
                type="button"
                class="shade-picker-btn"
                onclick={() => startDrawShade('tree-single')}>🌳 Single tree</button
              >
              <button
                type="button"
                class="shade-picker-btn"
                onclick={() => startDrawShade('building')}>🏠 Building</button
              >
              <button
                type="button"
                class="shade-picker-btn"
                onclick={() => startDrawShade('structure')}>🏗️ Structure</button
              >
              <button type="button" class="shade-picker-btn" onclick={() => startDrawShade('other')}
                >🌑 Other</button
              >
              <button
                type="button"
                class="shade-picker-cancel"
                onclick={() => (shadePickerOpen = false)}>Cancel</button
              >
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
    <p
      class="hint"
      aria-live="polite"
      data-hint-busy
      data-hint-anchor={drawMode === 'area' ? 'map_draw_area' : undefined}
    >
      {#if drawMode === 'feature-line'}
        Tap along the {MAP_FEATURE_LABELS[pendingFeatureKind].toLowerCase()}, then tap the last
        point again (or double-click) to finish.
      {:else if drawMode === 'feature-point'}
        Tap the map where the {MAP_FEATURE_LABELS[pendingFeatureKind].toLowerCase()} is.
      {:else if drawMode === 'shade-line'}
        Click points to draw the tree row / fence line. Double-click to finish.
      {:else if drawMode === 'shade-polygon'}
        Click points to outline the grove / building footprint. Double-click to finish.
      {:else if drawMode === 'area'}
        Tap each corner of the {AREA_KIND_LABELS[pendingAreaKind].toLowerCase()}, then tap the first
        corner again (or double-click) to finish.
      {:else if drawMode === 'block'}
        Tap each corner of the block inside one of your crop areas, then tap the first corner again
        (or double-click) to finish.
      {:else}
        Click points to outline an area. Double-click to finish. Draw <strong>inside a field</strong
        >
        to create a block; draw <strong>outside</strong> to create a field.
      {/if}
    </p>
  {/if}
</div>

{#if featureDraft}
  <div
    class="draft-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="feature-draft-title"
    onclick={(e) => e.target === e.currentTarget && dismissFeatureDraft()}
    onkeydown={(e) => e.key === 'Escape' && dismissFeatureDraft()}
    tabindex="-1"
  >
    <div class="draft-modal" style:--kind={MAP_FEATURE_STYLE[featureDraft.kind].color}>
      <h2 id="feature-draft-title">New {MAP_FEATURE_LABELS[featureDraft.kind].toLowerCase()}</h2>
      {#if featureDraft.lengthFt !== null}
        <dl class="measures" data-testid="feature-draft-length">
          <div>
            <dt>Length</dt>
            <dd>
              ≈ {fmt.qty(featureDraft.lengthFt, 'distance', { digits: 0 })}
              <Provenance source="data" compact />
            </dd>
          </div>
        </dl>
      {/if}
      <MapFeatureFields
        kind={featureDraft.kind}
        bind:draft={featureDraft.form}
        areas={fields.map((f) => ({ id: f.id, name: f.name }))}
        idPrefix="feature-draft"
      />
      {#if featureDraft.error}<p class="map-error" role="alert">{featureDraft.error}</p>{/if}
      <div class="actions">
        <button
          type="button"
          class="primary"
          onclick={submitFeatureDraft}
          disabled={featureDraft.busy || !featureDraft.form.name.trim()}
        >
          {featureDraft.busy ? '…' : 'Save'}
        </button>
        <button type="button" onclick={dismissFeatureDraft}>Discard</button>
      </div>
    </div>
  </div>
{/if}

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
      <p class="acres-hint">
        {shadeDraft.geomKind === 'LineString'
          ? 'Tree row / fence line'
          : 'Grove / building footprint'}
      </p>
      <label>
        Name
        <input
          type="text"
          bind:value={shadeDraft.name}
          placeholder="North maple windbreak"
          maxlength="120"
        />
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
          Height ({fmt.unit('distance')})
          <UnitInput
            quantity="distance"
            min={1}
            max={200}
            suffix={false}
            bind:value={
              () => (shadeDraft?.heightFt ? Number(shadeDraft.heightFt) : null),
              (v) => {
                if (shadeDraft) shadeDraft.heightFt = v == null ? '' : String(v);
              }
            }
          />
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
        <button
          type="button"
          class="primary"
          onclick={submitShadeDraft}
          disabled={!shadeDraftReady}
        >
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
    <div class="draft-modal" style:--kind={kindStyle(pendingDraft.kind).color}>
      {#if pendingDraft.mode === 'block'}
        <h2 id="draft-title">
          {pendingDraft.typed ? 'New block' : 'Assign block geometry'}
        </h2>
        {@render measures(pendingDraft.acres, null)}

        {#if pendingDraft.blockChoices.length > 0}
          <div class="mode-radio">
            <label>
              <input type="radio" bind:group={pendingDraft.assignMode} value="existing" />
              Use a block you already named
            </label>
            <label>
              <input type="radio" bind:group={pendingDraft.assignMode} value="new" />
              Create a new block
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
            <input
              type="text"
              bind:value={pendingDraft.newBlockName}
              placeholder="e.g. Corn Block A"
            />
          </label>
          {#if blockParents.length > 1 || !pendingDraft.newBlockFieldId}
            <label>
              Inside
              <select bind:value={pendingDraft.newBlockFieldId}>
                {#if !pendingDraft.newBlockFieldId}<option value="">Pick one</option>{/if}
                {#each blockParents as f (f.id)}
                  <option value={f.id}>{f.name}</option>
                {/each}
              </select>
            </label>
          {/if}
          {#if blockParents.length === 0}
            <p class="map-error">Add a field, garden or other crop area first.</p>
          {/if}
        {/if}
      {:else}
        <h2 id="draft-title">
          {pendingDraft.typed
            ? `New ${AREA_KIND_LABELS[pendingDraft.kind].toLowerCase()}`
            : 'New area'}
        </h2>
        {@render measures(pendingDraft.acres, pendingDraft.perimeterFt)}

        {#if pendingDraft.fieldChoices.length > 0}
          <div class="mode-radio">
            <label>
              <input type="radio" bind:group={pendingDraft.assignFieldMode} value="existing" />
              Use one you already named
            </label>
            <label>
              <input type="radio" bind:group={pendingDraft.assignFieldMode} value="new" />
              Create a new one
            </label>
          </div>
        {/if}

        {#if pendingDraft.assignFieldMode === 'existing'}
          <label>
            Name
            <select bind:value={pendingDraft.existingFieldId}>
              {#each pendingDraft.fieldChoices as c (c.id)}
                <option value={c.id}>{c.name}</option>
              {/each}
            </select>
          </label>
        {:else}
          <label>
            Name
            <input
              type="text"
              bind:value={pendingDraft.newFieldName}
              placeholder={AREA_NAME_PLACEHOLDER[pendingDraft.kind]}
            />
          </label>
        {/if}
        <label>
          Kind
          <select
            value={pendingDraft.kind}
            onchange={(e) => {
              if (!pendingDraft) return;
              const k = e.currentTarget.value as AreaKind;
              pendingDraft.kind = k;
              pendingDraft.details = draftFromDetails(k, null);
            }}
          >
            {#each AREA_KINDS as k (k)}
              <option value={k}>{AREA_KIND_LABELS[k]}</option>
            {/each}
          </select>
        </label>
        <AreaDetailsFields
          kind={pendingDraft.kind}
          bind:draft={pendingDraft.details}
          idPrefix="draft"
        />
      {/if}

      {#if pendingDraft.error}<p class="map-error">{pendingDraft.error}</p>{/if}

      <div class="actions">
        <button type="button" class="primary" onclick={submitDraft} disabled={!draftReady}>
          {#if pendingDraft.busy}…
          {:else if pendingDraft.mode === 'block'}
            {pendingDraft.assignMode === 'existing' ? 'Save outline' : 'Save block'}
          {:else}
            Save
          {/if}
        </button>
        <button type="button" onclick={dismissDraft}>Discard</button>
      </div>
    </div>
  </div>
{/if}

{#snippet measures(acres: number | null, perimeterFt: number | null)}
  {#if acres !== null || perimeterFt !== null}
    <dl class="measures" data-testid="draft-measures">
      {#if acres !== null}
        <div>
          <dt>Size</dt>
          <dd>≈ {fmt.qty(acres, 'area')} <Provenance source="data" compact /></dd>
        </div>
      {/if}
      {#if perimeterFt !== null}
        <div>
          <dt>Perimeter</dt>
          <dd>
            ≈ {fmt.qty(perimeterFt, 'distance', { digits: 0 })}
            <Provenance source="data" compact />
          </dd>
        </div>
      {/if}
    </dl>
  {/if}
{/snippet}

<style>
  .measures {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 24px;
    margin: 0 0 0.5rem;
  }
  .measures dt {
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-ink-soft);
  }
  .measures dd {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 1rem;
    color: var(--color-ink);
  }
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
  :global(.block-label-wrap) {
    background: transparent !important;
    border: 0 !important;
  }
  /* Permanent, high-contrast block name pill for read-only maps. The
     declutter pass adds an extra translate() on top of the centering one. */
  :global(.block-label) {
    display: inline-block;
    transform: translate(-50%, -50%);
    background: rgba(255, 255, 255, 0.95);
    color: #14331f;
    font-weight: 700;
    font-size: 0.8rem;
    line-height: 1.1;
    padding: 2px 7px;
    border-radius: 6px;
    white-space: nowrap;
    border: 1px solid rgba(0, 0, 0, 0.15);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
    pointer-events: none;
    user-select: none;
  }
  :global(.block-label--compact) {
    font-weight: 800;
    padding: 1px 6px;
    border-radius: 999px;
  }
  :global(.feature-pin-wrap) {
    background: transparent !important;
    border: 0 !important;
  }
  :global(.feature-pin) {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    border: 3px solid #fff;
    background: var(--pin);
    color: #fff;
    font:
      800 13px/1 system-ui,
      sans-serif;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45);
    cursor: pointer;
  }
  :global(.feature-pin::before) {
    content: '';
    position: absolute;
    inset: -14px;
    border-radius: 50%;
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
  .map-thumbnail .map {
    height: 200px;
  }
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
    background: rgba(0, 0, 0, 0.55);
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
  .tool:hover {
    background: #f8fbf9;
  }
  .tool.primary {
    background: #1f5e3a;
    color: white;
  }
  .tool.primary:hover {
    background: #2a7849;
  }
  .tool.danger {
    background: #b00020;
    color: white;
    border-color: #b00020;
  }
  .tool.done {
    background: #1a5276;
    color: white;
    border-color: #1a5276;
  }
  .tool.done:hover {
    background: #1f6391;
  }
  .map-error {
    color: #b00020;
    padding: 0.5rem 0.75rem;
    margin: 0;
    background: #fce4e4;
  }
  .hint {
    background: #fff3cd;
    color: #b35900;
    padding: 0.5rem 0.75rem;
    margin: 0;
    font-size: 0.9rem;
  }

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
    border-top: 6px solid var(--kind, #1f5e3a);
    max-height: calc(100vh - 2rem);
    overflow-y: auto;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  }
  .draft-modal h2 {
    margin: 0 0 0.75rem;
    color: #1f5e3a;
    font-size: 1.2rem;
  }
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
  .acres-hint {
    color: #555;
    margin: 0 0 0.75rem;
    font-size: 0.95rem;
  }

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
  .mode-radio input[type='radio'] {
    margin: 0;
    accent-color: #1f5e3a;
  }

  .draft-modal .actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
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
  .draft-modal .actions button.primary {
    background: #1f5e3a;
    color: white;
  }
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
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
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
  .shade-picker-btn:hover {
    background: #f3f4f6;
    border-color: #15803d;
  }
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
  .shade-checkbox input {
    width: auto;
    accent-color: #15803d;
  }
</style>
