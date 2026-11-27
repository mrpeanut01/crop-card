<script lang="ts">
  import { onMount } from 'svelte';
  import 'leaflet/dist/leaflet.css';
  import type { LayerGroup, Map as LMap, Marker, Rectangle } from 'leaflet';
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  import { escapeHtml } from '$lib/html';
  import { kindStyle } from '$lib/farm/kindStyle';
  import {
    SATELLITE_TILE_ATTRIBUTION,
    SATELLITE_TILE_URL,
    TILE_NATIVE_MAX_ZOOM
  } from '$lib/farm/mapTiles';
  import { boxAround, boxCenter, boxSizeM } from '$lib/siteFinder/geometry';
  import type { WaterPoint } from '$lib/siteFinder/candidates';
  import type { SeenItem } from '$lib/siteFinder/apiSchemas';
  import type { AreaShape, Candidate, LonLat, Obstacle, SearchBox } from '$lib/siteFinder/types';

  /** The Find a spot map: the owner's Areas, shade sources and water points
   *  read-only, a search box the owner moves by tapping the map or dragging
   *  its handle, and the numbered spots of the last result. The satellite
   *  tiles are for display only. */
  interface Props {
    box: SearchBox;
    areas: AreaShape[];
    obstacles: Obstacle[];
    water: WaterPoint[];
    candidates?: Candidate[];
    seen?: SeenItem[];
    onMove: (center: LonLat) => void;
  }
  const { box, areas, obstacles, water, candidates = [], seen = [], onMove }: Props = $props();

  const tr = $derived(createT(page.data?.locale));

  let mapEl: HTMLDivElement;
  let map: LMap | null = null;
  let L: typeof import('leaflet') | null = null;
  let boxLayer: Rectangle | null = null;
  let handle: Marker | null = null;
  let resultLayer: LayerGroup | null = null;
  let ready = $state(false);
  let resizeObs: ResizeObserver | null = null;

  const ll = (p: LonLat): [number, number] => [p[1], p[0]];
  const bounds = (b: SearchBox): [[number, number], [number, number]] => [
    [b.minLat, b.minLon],
    [b.maxLat, b.maxLon]
  ];

  function drawBox() {
    if (!map || !L) return;
    // The handle sits on the middle of the box's north edge so it never
    // covers a numbered spot.
    const at: [number, number] = [box.maxLat, boxCenter(box)[0]];
    if (!boxLayer) {
      boxLayer = L.rectangle(bounds(box), {
        color: '#ffffff',
        weight: 3,
        dashArray: '8 6',
        fillColor: '#ffffff',
        fillOpacity: 0.08,
        interactive: false
      }).addTo(map);
    } else boxLayer.setBounds(bounds(box));
    if (!handle) {
      handle = L.marker(at, {
        draggable: true,
        keyboard: false,
        title: tr('sitefinder.map.handle'),
        icon: L.divIcon({
          className: 'sf-handle',
          html: '<span aria-hidden="true">✥</span>',
          iconSize: [48, 48],
          iconAnchor: [24, 24]
        })
      }).addTo(map);
      handle.on('dragend', () => {
        const p = handle?.getLatLng();
        if (p) onMove([p.lng, p.lat - (box.maxLat - box.minLat) / 2]);
      });
    } else handle.setLatLng(at);
  }

  function drawResults() {
    const leaflet = L;
    if (!map || !leaflet) return;
    resultLayer?.remove();
    const group = leaflet.layerGroup();
    for (const s of seen) {
      leaflet
        .circleMarker(ll(s.center), {
          radius: 6,
          color: '#6a4f00',
          weight: 2,
          fillColor: '#fff4d6',
          fillOpacity: 0.9,
          interactive: false
        })
        .addTo(group);
    }
    candidates.forEach((c, i) => {
      leaflet
        .polygon(c.polygon.map(ll), {
          color: '#ffffff',
          weight: 3,
          fillColor: '#2f5d3a',
          fillOpacity: 0.55,
          interactive: false
        })
        .addTo(group);
      leaflet
        .marker(ll(c.center), {
          interactive: false,
          keyboard: false,
          icon: leaflet.divIcon({
            className: 'sf-spot',
            html: `<span>${i + 1}</span>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14]
          })
        })
        .addTo(group);
    });
    resultLayer = group.addTo(map);
  }

  function fitBox() {
    if (!map) return;
    const { widthM, heightM } = boxSizeM(box);
    const view = boxAround(boxCenter(box), widthM * 1.6, heightM * 1.6);
    map.fitBounds(bounds(view), { animate: false });
  }

  onMount(() => {
    let cancelled = false;
    (async () => {
      L = (await import('leaflet')).default;
      if (cancelled) return;
      map = L.map(mapEl, { maxZoom: 21, zoomControl: false });
      fitBox();
      L.control.zoom({ zoomInTitle: tr('map.zoomIn'), zoomOutTitle: tr('map.zoomOut') }).addTo(map);
      L.tileLayer(SATELLITE_TILE_URL, {
        maxZoom: 21,
        maxNativeZoom: TILE_NATIVE_MAX_ZOOM,
        attribution: SATELLITE_TILE_ATTRIBUTION
      }).addTo(map);
      for (const a of areas) {
        const style = kindStyle(a.kind);
        L.polygon(a.ring.map(ll), {
          color: style.color,
          weight: style.weight,
          fillOpacity: a.kind === 'boundary' ? 0 : style.fillOpacity,
          dashArray: a.id.startsWith('area:') ? '6 4' : undefined,
          interactive: true
        })
          .bindTooltip(escapeHtml(a.name))
          .addTo(map);
      }
      for (const o of obstacles) {
        const opts = { color: '#15803d', weight: 2, fillColor: '#86efac', fillOpacity: 0.35 };
        const layer =
          o.shape.type === 'polygon'
            ? L.polygon(o.shape.ring.map(ll), opts)
            : o.shape.type === 'line'
              ? L.polyline(o.shape.points.map(ll), opts)
              : L.circle(ll(o.shape.center), { ...opts, radius: o.shape.radiusM });
        if (o.name) layer.bindTooltip(escapeHtml(o.name));
        layer.addTo(map);
      }
      for (const w of water) {
        L.circleMarker(ll(w.point), {
          radius: 7,
          color: '#ffffff',
          weight: 2,
          fillColor: '#2563eb',
          fillOpacity: 1
        })
          .bindTooltip(escapeHtml(w.name))
          .addTo(map);
      }
      map.on('click', (e) => onMove([e.latlng.lng, e.latlng.lat]));
      drawBox();
      drawResults();
      resizeObs = new ResizeObserver(() => map?.invalidateSize());
      resizeObs.observe(mapEl);
      ready = true;
    })();
    return () => {
      cancelled = true;
      resizeObs?.disconnect();
      map?.remove();
      map = null;
      boxLayer = null;
      handle = null;
      resultLayer = null;
    };
  });

  let lastSize = 0;
  $effect(() => {
    void box;
    if (!ready) return;
    drawBox();
    const size = Math.round(boxSizeM(box).widthM);
    if (size !== lastSize) {
      lastSize = size;
      fitBox();
    } else if (map && !map.getBounds().contains(ll(boxCenter(box)))) {
      map.panTo(ll(boxCenter(box)), { animate: false });
    }
  });

  $effect(() => {
    void candidates;
    void seen;
    if (ready) drawResults();
  });
</script>

<div
  class="sf-map"
  bind:this={mapEl}
  role="application"
  aria-label={tr('sitefinder.map.aria')}
  data-testid="site-finder-map"
  data-ready={ready}
></div>

<style>
  .sf-map {
    height: 420px;
    border-radius: 10px;
    border: 1px solid var(--color-divider);
    overflow: hidden;
    cursor: crosshair;
    max-width: 100%;
    position: relative;
    z-index: 0;
    isolation: isolate;
  }
  @media (max-width: 600px) {
    .sf-map {
      height: 320px;
    }
  }
  .sf-map :global(.sf-handle) {
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.92);
    border: 2px solid #2f5d3a;
    color: #2f5d3a;
    font-size: 22px;
    line-height: 1;
    cursor: grab;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  }
  .sf-map :global(.sf-spot) {
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: #ffffff;
    border: 2px solid #2f5d3a;
    color: #1f3f27;
    font-weight: 700;
    font-size: 14px;
  }
</style>
