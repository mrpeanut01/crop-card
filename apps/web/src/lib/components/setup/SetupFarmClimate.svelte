<script lang="ts">
  import { untrack } from 'svelte';
  import { deserialize } from '$app/forms';
  import FrostPanel from '$lib/components/onboarding/FrostPanel.svelte';

  interface Props {
    /** The saved farm location, when there is one. */
    latLon: { lat: number; lon: number } | null;
    onDone: (saved: true) => void;
  }

  const { latLon, onDone }: Props = $props();

  const round5 = (n: number) => Number(n.toFixed(5));
  let lat = $state<number | null>(untrack(() => (latLon ? round5(latLon.lat) : null)));
  let lon = $state<number | null>(untrack(() => (latLon ? round5(latLon.lon) : null)));
  let query = $state('');
  let searching = $state(false);
  let note = $state<string | null>(null);
  let geoBusy = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let frostBlocked = $state(false);

  const hasPoint = $derived(
    typeof lat === 'number' &&
      Number.isFinite(lat) &&
      typeof lon === 'number' &&
      Number.isFinite(lon)
  );

  function setPoint(la: number, lo: number) {
    lat = round5(la);
    lon = round5(lo);
  }

  async function searchAddress() {
    const q = query.trim();
    note = null;
    if (q.length < 3) {
      note = 'Type at least three letters of the address.';
      return;
    }
    searching = true;
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      const body = res.ok
        ? ((await res.json()) as { matches?: { lat: number; lon: number }[] })
        : {};
      const first = body.matches?.[0];
      if (first) setPoint(first.lat, first.lon);
      else
        note =
          "We couldn't find that address. The lookup needs a house number and street. Use your location or type the coordinates instead.";
    } catch {
      note = "The address lookup isn't working right now. Use your location instead.";
    } finally {
      searching = false;
    }
  }

  function useMyLocation() {
    note = null;
    if (!('geolocation' in navigator)) {
      note = "This browser can't share its location. Type the coordinates instead.";
      return;
    }
    geoBusy = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPoint(pos.coords.latitude, pos.coords.longitude);
        geoBusy = false;
      },
      () => {
        note = "We couldn't get your location. Type the coordinates or search an address.";
        geoBusy = false;
      },
      { enableHighAccuracy: false, timeout: 15_000 }
    );
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!hasPoint) {
      error = 'Set the farm location first.';
      return;
    }
    saving = true;
    error = null;
    try {
      const res = await fetch('/settings/farm?/save', {
        method: 'POST',
        headers: { accept: 'application/json', 'x-sveltekit-action': 'true' },
        body: new FormData(e.currentTarget as HTMLFormElement)
      });
      const result = deserialize(await res.text());
      if (result.type === 'success') {
        onDone(true);
        return;
      }
      const data = result.type === 'failure' ? (result.data as { error?: string }) : null;
      error = data?.error ?? "That didn't save. Try again, or use Settings, Farm.";
    } catch {
      error = "That didn't save. Check your connection and try again.";
    } finally {
      saving = false;
    }
  }
</script>

<form class="climate" onsubmit={submit} data-testid="setup-farm-climate">
  <p class="lede">
    Your location sets the weather, frost dates and planting times. It stays on your farm record.
  </p>

  <div class="search">
    <input
      type="search"
      aria-label="Search for an address"
      placeholder="Street address, e.g. 12 Main St, Leesburg VA"
      autocomplete="street-address"
      bind:value={query}
      onkeydown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void searchAddress();
        }
      }}
    />
    <button type="button" class="ghost" onclick={searchAddress} disabled={searching}>
      {searching ? 'Searching…' : 'Search'}
    </button>
  </div>
  <button type="button" class="ghost wide" onclick={useMyLocation} disabled={geoBusy}>
    {geoBusy ? 'Finding you…' : 'Use my location'}
  </button>
  {#if note}<p class="note" role="status">{note}</p>{/if}

  <div class="coords">
    <label>
      <span>Latitude</span>
      <input
        type="number"
        name="lat"
        step="any"
        min="-90"
        max="90"
        inputmode="decimal"
        bind:value={lat}
      />
    </label>
    <label>
      <span>Longitude</span>
      <input
        type="number"
        name="lon"
        step="any"
        min="-180"
        max="180"
        inputmode="decimal"
        bind:value={lon}
      />
    </label>
  </div>

  {#if hasPoint}
    <FrostPanel {lat} {lon} mode="auto" bind:blocked={frostBlocked} />
  {/if}

  {#if error}<p class="error" role="alert">{error}</p>{/if}

  <div class="actions">
    <button type="submit" class="primary" disabled={saving || !hasPoint || frostBlocked}>
      {saving ? 'Saving…' : 'Save location and frost dates'}
    </button>
    <a class="ghost" href="/settings/farm">Use the map in Settings</a>
  </div>
</form>

<style>
  .climate {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }
  .lede,
  .note {
    margin: 0;
    font-size: 0.92rem;
  }
  .note {
    color: var(--color-ink-soft);
  }
  .search {
    display: flex;
    gap: 8px;
    min-width: 0;
  }
  .search input {
    flex: 1 1 auto;
    min-width: 0;
  }
  input {
    min-height: 48px;
    font: inherit;
    padding: 0 10px;
    border: 1px solid var(--color-divider);
    border-radius: 6px;
    background: var(--color-paper);
    color: var(--color-ink);
    box-sizing: border-box;
  }
  .coords {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 8px;
  }
  .coords label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.85rem;
    min-width: 0;
  }
  .coords input {
    width: 100%;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .primary,
  .ghost {
    min-height: 48px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 14px;
    border-radius: 6px;
    font: inherit;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
  }
  .primary {
    background: var(--color-forest);
    color: var(--color-cream);
    border: 1px solid var(--color-forest);
  }
  .primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .ghost {
    background: transparent;
    color: var(--color-forest-deep);
    border: 1px solid var(--color-divider);
  }
  .wide {
    align-self: flex-start;
  }
  .error {
    margin: 0;
    color: var(--color-rust-deep, #8a2e12);
    font-weight: 600;
  }
</style>
