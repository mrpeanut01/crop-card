<script lang="ts">
  import { onMount } from 'svelte';
  import 'leaflet/dist/leaflet.css';
  import type { CircleMarker, Map as LMap } from 'leaflet';

  let {
    lat,
    lon,
    fallback,
    onPick
  }: {
    lat: number | null;
    lon: number | null;
    fallback: { lat: number; lon: number };
    onPick: (lat: number, lon: number) => void;
  } = $props();

  let mapEl: HTMLDivElement;
  let map: LMap | null = null;
  let pin: CircleMarker | null = null;
  let L: typeof import('leaflet') | null = null;
  let resizeObs: ResizeObserver | null = null;

  function placePin(la: number, lo: number, pan: boolean) {
    if (!map || !L) return;
    if (pin) pin.setLatLng([la, lo]);
    else
      pin = L.circleMarker([la, lo], {
        radius: 10,
        color: '#fff',
        weight: 3,
        fillColor: '#2f5d3a',
        fillOpacity: 1
      }).addTo(map);
    if (pan) map.setView([la, lo], Math.max(map.getZoom(), 15));
  }

  onMount(() => {
    let cancelled = false;
    (async () => {
      L = (await import('leaflet')).default;
      if (cancelled) return;
      const start = lat != null && lon != null ? { lat, lon } : fallback;
      map = L.map(mapEl, { maxZoom: 21 }).setView([start.lat, start.lon], lat != null ? 15 : 11);
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 21,
          maxNativeZoom: 19,
          attribution:
            'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
        }
      ).addTo(map);
      if (lat != null && lon != null) placePin(lat, lon, false);
      map.on('click', (e) => {
        const la = Number(e.latlng.lat.toFixed(5));
        const lo = Number(e.latlng.lng.toFixed(5));
        placePin(la, lo, false);
        onPick(la, lo);
      });
      resizeObs = new ResizeObserver(() => map?.invalidateSize());
      resizeObs.observe(mapEl);
    })();
    return () => {
      cancelled = true;
      resizeObs?.disconnect();
      map?.remove();
      map = null;
      pin = null;
    };
  });

  $effect(() => {
    if (lat != null && lon != null) placePin(lat, lon, true);
  });
</script>

<div
  class="picker"
  bind:this={mapEl}
  role="application"
  aria-label="Map. Tap your farm to drop a pin."
></div>

<style>
  .picker {
    height: 340px;
    border-radius: 10px;
    border: 1px solid var(--color-divider);
    overflow: hidden;
    cursor: crosshair;
  }
  @media (max-width: 600px) {
    .picker {
      height: 260px;
    }
  }
</style>
