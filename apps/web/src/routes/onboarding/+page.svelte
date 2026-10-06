<script lang="ts">
  import { enhance } from '$app/forms';
  import { browser } from '$app/env';
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import { createT, type MessageKey } from '$lib/i18n';
  import LanguageToggle from '$lib/components/ui/LanguageToggle.svelte';
  import { ArrowRight, Check, Crosshair, MapPin, Search, Sun } from 'lucide-svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import FrostPanel from '$lib/components/onboarding/FrostPanel.svelte';
  import type { ActionData, PageData } from './$types';

  const { data, form }: { data: PageData; form: ActionData } = $props();

  const tr = $derived(createT(page.data?.locale));
  const showLanguage = $derived((page.data?.locales?.length ?? 0) > 1);

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
  let pickedAnimals = $state<string[]>([]);

  function setPoint(la: number, lo: number, label: string | null) {
    lat = Number(la.toFixed(5));
    lon = Number(lo.toFixed(5));
    placeLabel = label;
  }

  async function searchAddress() {
    const q = query.trim();
    matches = [];
    if (q.length < 3) {
      searchNote = tr('onboard.errShort');
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
      searchNote = tr('onboard.errNoMatch');
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
      geoError = tr('onboard.errNoGeo');
      return;
    }
    geoBusy = true;
    geoError = null;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPoint(pos.coords.latitude, pos.coords.longitude, tr('onboard.currentLocation'));
        geoBusy = false;
      },
      (err) => {
        geoBusy = false;
        geoError =
          err.code === err.PERMISSION_DENIED ? tr('onboard.errDenied') : tr('onboard.errNoFix');
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
  <title>{tr('onboard.title')}</title>
</svelte:head>

<div class="ob-wrap">
  {#if data.screen === 'farm'}
    <header class="intro">
      <div class="kicker-row">
        <Sun size={12} strokeWidth={2} aria-hidden="true" />
        {tr('onboard.step', { n: 1 })}
      </div>
      <h1 class="serif">{tr('onboard.farm.h1')}</h1>
      <p class="lede">
        {data.firstName
          ? tr('onboard.farm.welcomeNamed', { name: data.firstName })
          : tr('onboard.farm.welcome')}{tr('onboard.farm.lede')}
      </p>
      {#if showLanguage}
        <div class="lang-q">
          <p class="lang-q-text">{tr('onboarding.language.question')}</p>
          <LanguageToggle />
          <p class="lang-q-note">{tr('onboarding.language.note')}</p>
        </div>
      {/if}
    </header>

    <form method="POST" action="?/farm" use:enhance={submitEnhance} class="form">
      {#if form && 'error' in form && form.error}
        <p class="error" role="alert">{form.error}</p>
      {/if}

      <Card loose>
        <label class="row">
          <span class="lbl">{tr('onboard.farm.nameLabel')}</span>
          <input
            type="text"
            name="farmName"
            required
            maxlength="120"
            autocomplete="organization"
            placeholder={tr('onboard.farm.namePlaceholder')}
            bind:value={farmName}
          />
        </label>
      </Card>

      <Card loose>
        <h2 class="serif sub">{tr('onboard.where')}</h2>
        <div class="search">
          <input
            type="search"
            aria-label={tr('onboard.searchAria')}
            placeholder={tr('onboard.searchPlaceholder')}
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
            {searching ? tr('onboard.searching') : tr('onboard.search')}
          </button>
        </div>
        {#if matches.length > 1}
          <ul class="matches" aria-label={tr('onboard.matchesAria')}>
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
            {geoBusy ? tr('onboard.findingYou') : tr('onboard.useMyLocation')}
          </button>
          <span class="muted">{tr('onboard.orTapMap')}</span>
        </div>
        {#if geoError}<p class="note warn" role="status">{geoError}</p>{/if}

        {#if browser}
          {#await import('$lib/components/onboarding/LocationPicker.svelte')}
            <div class="map-loading">{tr('onboard.loadingMap')}</div>
          {:then { default: LocationPicker }}
            <LocationPicker
              {lat}
              {lon}
              fallback={data.fallbackCenter}
              onPick={(la, lo) => setPoint(la, lo, tr('onboard.pinOnMap'))}
            />
          {:catch}
            <div class="map-loading">{tr('onboard.mapFailed')}</div>
          {/await}
        {:else}
          <div class="map-loading">{tr('onboard.loadingMap')}</div>
        {/if}

        <p class="picked" role="status" data-testid="picked-location">
          {#if lat != null && lon != null}
            <Check size={15} aria-hidden="true" />
            {placeLabel ? `${placeLabel} · ` : ''}{lat.toFixed(4)}, {lon.toFixed(4)}
          {:else}
            {tr('onboard.noLocation')}
          {/if}
        </p>

        <details class="advanced">
          <summary>{tr('onboard.typeCoords')}</summary>
          <div class="two">
            <label class="row">
              <span class="lbl">{tr('onboard.latitude')}</span>
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
              <span class="lbl">{tr('onboard.longitude')}</span>
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
        {tr('onboard.why')}
      </p>

      <div class="actions">
        <button class="primary" type="submit" disabled={!canContinue}>
          {tr('onboard.continue')}
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      </div>
    </form>
  {:else}
    <header class="intro">
      <div class="kicker-row">
        <Sun size={12} strokeWidth={2} aria-hidden="true" />
        {tr('onboard.step', { n: 2 })}
      </div>
      <h1 class="serif">{tr('onboard.grow.h1')}</h1>
      <p class="lede">
        {data.farmName
          ? tr('onboard.grow.ledeNamed', { farm: data.farmName })
          : tr('onboard.grow.ledePlain')}
      </p>
    </header>

    <form method="POST" action="?/growing" use:enhance={submitEnhance} class="form">
      {#if form && 'error' in form && form.error}
        <p class="error" role="alert">{form.error}</p>
      {/if}
      <fieldset class="choices">
        <legend class="sr-only">{tr('onboard.grow.h1')}</legend>
        {#each data.options ?? [] as o (o.id)}
          <label class="choice" class:on={picked.includes(o.id)}>
            <input type="checkbox" name="growing" value={o.id} bind:group={picked} />
            <span class="choice-title serif">{tr(`onboard.opt.${o.id}.title` as MessageKey)}</span>
            <span class="choice-blurb">{tr(`onboard.opt.${o.id}.blurb` as MessageKey)}</span>
            <span class="tick" aria-hidden="true"><Check size={16} /></span>
          </label>
        {/each}
      </fieldset>
      {#if data.animalOptions?.length}
        <fieldset class="choices animals" aria-describedby="animals-note">
          <legend class="choices-legend serif">{tr('onboard.anyAnimals')}</legend>
          <p class="choices-note" id="animals-note">
            {tr('onboard.animalsNote')}
          </p>
          {#each data.animalOptions as o (o.id)}
            <label class="choice" class:on={pickedAnimals.includes(o.id)}>
              <input type="checkbox" name="animals" value={o.id} bind:group={pickedAnimals} />
              <span class="choice-title serif">{tr(`onboard.opt.${o.id}.title` as MessageKey)}</span
              >
              <span class="choice-blurb">{tr(`onboard.opt.${o.id}.blurb` as MessageKey)}</span>
              <span class="tick" aria-hidden="true"><Check size={16} /></span>
            </label>
          {/each}
        </fieldset>
      {/if}
      <div class="actions">
        <button class="link" type="submit" name="skip" value="1" disabled={submitting}>
          {tr('onboard.notSure')}
        </button>
        <button
          class="primary"
          type="submit"
          disabled={(picked.length === 0 && pickedAnimals.length === 0) || submitting}
        >
          {tr('onboard.takeMe')}
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      </div>
    </form>
  {/if}
</div>

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
  .choices.animals {
    margin-top: 8px;
  }
  .choices-legend {
    grid-column: 1 / -1;
    padding: 0;
    margin: 0 0 4px;
    font-size: 20px;
    color: var(--color-forest-deep);
  }
  .choices-note {
    grid-column: 1 / -1;
    margin: 0;
    color: var(--color-ink-soft);
    font-size: 14px;
    line-height: 1.5;
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
  .lang-q {
    margin-top: 16px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
  }
  .lang-q-text {
    margin: 0;
    font-weight: 600;
  }
  .lang-q-note {
    margin: 0;
    flex-basis: 100%;
    font-size: 13px;
    color: var(--color-ink-muted);
  }
</style>
