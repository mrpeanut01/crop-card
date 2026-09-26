<script lang="ts">
  import { enhance } from '$app/forms';
  import { browser } from '$app/environment';
  import { untrack } from 'svelte';
  import { ArrowRight, Check, Crosshair, MapPin, Search, Sun } from 'lucide-svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import FrostPanel from '$lib/components/onboarding/FrostPanel.svelte';
  import type { ActionData, PageData } from './$types';

  const { data, form }: { data: PageData; form: ActionData } = $props();

  let farmName = $state(untrack(() => data.suggestedName));
  let lat = $state<number | null>(null);
  let lon = $state<number | null>(null);
  let placeLabel = $state<string | null>(null);
  let frostBlocked = $state(true);
  let submitting = $state(false);

  let query = $state('');
  let searching = $state(false);
  let searchNote = $state<string | null>(null);
  let matches = $state<Array<{ label: string; lat: number; lon: number }>>([]);

  let geoBusy = $state(false);
  let geoError = $state<string | null>(null);

  let picked = $state<string[]>([]);

  function setPoint(la: number, lo: number, label: string | null) {
    lat = Number(la.toFixed(5));
    lon = Number(lo.toFixed(5));
    placeLabel = label;
  }

  async function searchAddress() {
    const q = query.trim();
    matches = [];
    if (q.length < 3) {
      searchNote = 'Type at least three letters of the address.';
      return;
    }
    searching = true;
    searchNote = null;
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const body = (await res.json()) as { matches?: typeof matches };
        matches = body.matches ?? [];
      }
    } catch {
      matches = [];
    }
    searching = false;
    if (matches.length === 0) {
      searchNote = "We couldn't find that address. Use your location or tap the map instead.";
    } else if (matches.length === 1) {
      choose(matches[0]);
    }
  }

  function choose(m: { label: string; lat: number; lon: number }) {
    setPoint(m.lat, m.lon, m.label);
    matches = [];
    searchNote = null;
  }

  function useMyLocation() {
    if (!browser || !navigator.geolocation) {
      geoError = "This browser can't share its location. Search or tap the map instead.";
      return;
    }
    geoBusy = true;
    geoError = null;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPoint(pos.coords.latitude, pos.coords.longitude, 'Your current location');
        geoBusy = false;
      },
      (err) => {
        geoBusy = false;
        geoError =
          err.code === err.PERMISSION_DENIED
            ? 'Location permission was declined. Search or tap the map instead.'
            : "Couldn't get a GPS fix. Search or tap the map instead.";
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  function typedCoord(which: 'lat' | 'lon', raw: string) {
    const n = raw.trim() === '' ? null : Number(raw);
    const v = n === null || !Number.isFinite(n) ? null : n;
    if (which === 'lat') lat = v;
    else lon = v;
    placeLabel = null;
  }

  const canContinue = $derived(
    farmName.trim().length > 0 && lat != null && lon != null && !frostBlocked && !submitting
  );

  const submitEnhance = () => {
    submitting = true;
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      submitting = false;
    };
  };
</script>

<svelte:head>
  <title>Set up your farm · CropCard</title>
</svelte:head>

<main class="ob-wrap">
  {#if data.screen === 'farm'}
    <header class="intro">
      <div class="kicker-row"><Sun size={12} strokeWidth={2} aria-hidden="true" /> Step 1 of 2</div>
      <h1 class="serif">Tell us about your farm</h1>
      <p class="lede">
        {data.firstName ? `Welcome, ${data.firstName}. ` : 'Welcome. '}Two quick questions and
        you're in. Your location sets the weather, spray windows and frost dates, so we ask for it
        first.
      </p>
    </header>

    <form method="POST" action="?/farm" use:enhance={submitEnhance} class="form">
      {#if form && 'error' in form && form.error}
        <p class="error" role="alert">{form.error}</p>
      {/if}

      <Card loose>
        <label class="row">
          <span class="lbl">Farm name</span>
          <input
            type="text"
            name="farmName"
            required
            maxlength="120"
            autocomplete="organization"
            placeholder="Hilltop Acres"
            bind:value={farmName}
          />
        </label>
      </Card>

      <Card loose>
        <h2 class="serif sub">Where is it?</h2>
        <div class="search">
          <input
            type="search"
            aria-label="Search for an address"
            placeholder="Street address, town or zip"
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
            <Search size={15} aria-hidden="true" />
            {searching ? 'Searching…' : 'Search'}
          </button>
        </div>
        {#if matches.length > 1}
          <ul class="matches" aria-label="Matching addresses">
            {#each matches as m (m.label)}
              <li>
                <button type="button" class="match" onclick={() => choose(m)}>
                  <MapPin size={14} aria-hidden="true" />
                  {m.label}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
        {#if searchNote}<p class="note" role="status">{searchNote}</p>{/if}

        <div class="or-row">
          <button type="button" class="ghost" onclick={useMyLocation} disabled={geoBusy}>
            <Crosshair size={15} aria-hidden="true" />
            {geoBusy ? 'Finding you…' : 'Use my location'}
          </button>
          <span class="muted">or tap the map to drop a pin</span>
        </div>
        {#if geoError}<p class="note warn" role="status">{geoError}</p>{/if}

        {#if browser}
          {#await import('$lib/components/onboarding/LocationPicker.svelte')}
            <div class="map-loading">Loading map…</div>
          {:then { default: LocationPicker }}
            <LocationPicker
              {lat}
              {lon}
              fallback={data.fallbackCenter}
              onPick={(la, lo) => setPoint(la, lo, 'Pin on the map')}
            />
          {:catch}
            <div class="map-loading">
              The map couldn't load. Search or use your location instead.
            </div>
          {/await}
        {:else}
          <div class="map-loading">Loading map…</div>
        {/if}

        <p class="picked" role="status" data-testid="picked-location">
          {#if lat != null && lon != null}
            <Check size={15} aria-hidden="true" />
            {placeLabel ? `${placeLabel} · ` : ''}{lat.toFixed(4)}, {lon.toFixed(4)}
          {:else}
            No location yet.
          {/if}
        </p>

        <details class="advanced">
          <summary>Type the coordinates instead</summary>
          <div class="two">
            <label class="row">
              <span class="lbl">Latitude</span>
              <input
                type="number"
                name="lat"
                step="any"
                min="-90"
                max="90"
                inputmode="decimal"
                value={lat ?? ''}
                oninput={(e) => typedCoord('lat', e.currentTarget.value)}
              />
            </label>
            <label class="row">
              <span class="lbl">Longitude</span>
              <input
                type="number"
                name="lon"
                step="any"
                min="-180"
                max="180"
                inputmode="decimal"
                value={lon ?? ''}
                oninput={(e) => typedCoord('lon', e.currentTarget.value)}
              />
            </label>
          </div>
        </details>
      </Card>

      <Card loose>
        <FrostPanel {lat} {lon} mode="auto" bind:blocked={frostBlocked} />
      </Card>

      <p class="why">
        Your coordinates stay on your farm record. They're only sent to the National Weather Service
        for your forecast.
      </p>

      <div class="actions">
        <button class="primary" type="submit" disabled={!canContinue}>
          Continue <ArrowRight size={15} aria-hidden="true" />
        </button>
      </div>
    </form>
  {:else}
    <header class="intro">
      <div class="kicker-row"><Sun size={12} strokeWidth={2} aria-hidden="true" /> Step 2 of 2</div>
      <h1 class="serif">What are you growing on?</h1>
      <p class="lede">
        Pick any that apply. We'll set up a starting spot for each one{data.farmName
          ? ` on ${data.farmName}`
          : ''}, and you can put them on the map whenever you like.
      </p>
    </header>

    <form method="POST" action="?/growing" use:enhance={submitEnhance} class="form">
      {#if form && 'error' in form && form.error}
        <p class="error" role="alert">{form.error}</p>
      {/if}
      <fieldset class="choices">
        <legend class="sr-only">What are you growing on?</legend>
        {#each data.options ?? [] as o (o.id)}
          <label class="choice" class:on={picked.includes(o.id)}>
            <input type="checkbox" name="growing" value={o.id} bind:group={picked} />
            <span class="choice-title serif">{o.title}</span>
            <span class="choice-blurb">{o.blurb}</span>
            <span class="tick" aria-hidden="true"><Check size={16} /></span>
          </label>
        {/each}
      </fieldset>
      <div class="actions">
        <button class="link" type="submit" name="skip" value="1" disabled={submitting}>
          Not sure yet
        </button>
        <button class="primary" type="submit" disabled={picked.length === 0 || submitting}>
          Take me to Today <ArrowRight size={15} aria-hidden="true" />
        </button>
      </div>
    </form>
  {/if}
</main>

<style>
  .ob-wrap {
    max-width: 760px;
    margin: 0 auto;
    padding: 28px 16px 56px;
  }
  .intro {
    margin-bottom: 20px;
  }
  .kicker-row {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--font-size-kicker);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 700;
    color: var(--color-ink-soft);
  }
  h1 {
    margin: 8px 0 8px;
    font-size: var(--font-size-display);
    color: var(--color-forest-deep);
    letter-spacing: var(--letter-tighter);
    line-height: 1.1;
  }
  .lede {
    margin: 0;
    color: var(--color-ink-soft);
    font-size: 15px;
    line-height: 1.55;
    max-width: 60ch;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .sub {
    margin: 0 0 12px;
    font-size: 18px;
    color: var(--color-forest-deep);
  }
  .row {
    display: grid;
    gap: 6px;
  }
  .lbl {
    font-weight: 600;
  }
  input[type='text'],
  input[type='search'],
  input[type='number'] {
    font: inherit;
    padding: 0 12px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    min-height: 48px;
    background: var(--color-paper);
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
  }
  input:focus-visible,
  button:focus-visible,
  summary:focus-visible {
    outline: 2px solid var(--color-forest);
    outline-offset: 2px;
  }
  .search {
    display: flex;
    gap: 8px;
  }
  .search input {
    flex: 1;
  }
  .matches {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .match {
    font: inherit;
    width: 100%;
    text-align: left;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 48px;
    padding: 0 12px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    background: var(--color-cream);
    cursor: pointer;
  }
  .note {
    margin: 8px 0 0;
    font-size: 13.5px;
    color: var(--color-ink-soft);
  }
  .note.warn {
    color: var(--pill-rust-fg);
  }
  .or-row {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    margin: 14px 0 10px;
  }
  .muted {
    color: var(--color-ink-soft);
    font-size: 13.5px;
  }
  .map-loading {
    border: 1px solid var(--color-divider);
    border-radius: 10px;
    padding: 40px 16px;
    text-align: center;
    color: var(--color-ink-soft);
  }
  .picked {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 10px 0 0;
    font-size: 13.5px;
    color: var(--color-forest-deep);
    font-weight: 600;
  }
  .advanced {
    margin-top: 10px;
  }
  .advanced summary {
    cursor: pointer;
    min-height: 48px;
    display: flex;
    align-items: center;
    color: var(--color-ink-soft);
    font-size: 13.5px;
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .why {
    margin: 0;
    font-size: 13px;
    color: var(--color-ink-soft);
    line-height: 1.5;
  }
  .error {
    background: var(--pill-rust-bg);
    border: 1px solid var(--pill-rust-bd);
    color: var(--pill-rust-fg);
    padding: 12px 16px;
    border-radius: var(--radius-input);
    margin: 0;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .primary,
  .ghost,
  .link {
    font: inherit;
    font-weight: 600;
    border-radius: var(--radius-input);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 48px;
    padding: 0 18px;
    cursor: pointer;
  }
  .primary {
    background: var(--color-forest);
    color: var(--color-cream);
    border: none;
  }
  .primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ghost {
    background: var(--color-paper);
    color: var(--color-forest-deep);
    border: 1px solid var(--color-divider);
    flex-shrink: 0;
  }
  .ghost:disabled {
    opacity: 0.6;
  }
  .link {
    background: none;
    border: none;
    color: var(--color-ink-soft);
    text-decoration: underline;
  }
  .choices {
    border: 0;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .choice {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 132px;
    padding: 18px 18px 18px 20px;
    border: 1.5px solid var(--color-divider);
    border-radius: var(--radius-hero);
    background: var(--color-paper);
    cursor: pointer;
  }
  .choice::before {
    content: '';
    position: absolute;
    left: 0;
    top: 12px;
    bottom: 12px;
    width: 4px;
    border-radius: 0 4px 4px 0;
    background: var(--color-divider);
  }
  .choice.on {
    border-color: var(--color-forest);
    background: var(--pill-forest-bg);
  }
  .choice.on::before {
    background: var(--color-forest);
  }
  .choice:focus-within {
    outline: 2px solid var(--color-forest);
    outline-offset: 2px;
  }
  .choice input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
  }
  .choice-title {
    font-size: 19px;
    color: var(--color-forest-deep);
    padding-right: 32px;
  }
  .choice-blurb {
    color: var(--color-ink-soft);
    font-size: 13.5px;
    line-height: 1.5;
  }
  .tick {
    position: absolute;
    top: 16px;
    right: 16px;
    width: 26px;
    height: 26px;
    border-radius: 999px;
    border: 1.5px solid var(--color-divider);
    display: grid;
    place-items: center;
    color: transparent;
    background: var(--color-paper);
  }
  .choice.on .tick {
    background: var(--color-forest);
    border-color: var(--color-forest);
    color: var(--color-cream);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  @media (max-width: 600px) {
    h1 {
      font-size: var(--font-size-hero);
    }
    .choices,
    .two {
      grid-template-columns: 1fr;
    }
    .choice {
      min-height: 96px;
    }
  }
</style>
