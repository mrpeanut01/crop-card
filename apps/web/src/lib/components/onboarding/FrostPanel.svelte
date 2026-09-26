<script lang="ts">
  import { untrack } from 'svelte';
  import { Snowflake } from 'lucide-svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import {
    lookupFrostDates,
    type FrostLookupResult,
    type FrostProbability
  } from '$lib/climate/frostNormals';
  import {
    FROST_FIELDS,
    suggestFrostValues,
    type FrostField,
    type FrostSuggestedValue,
    type FrostValueProvenance
  } from '$lib/climate/frostSuggest';
  import {
    FROST_CONFIRM_COPY,
    FROST_STORED_FALLBACK_COPY,
    frostConfirmReason,
    suggestFromStored
  } from '$lib/climate/frostSettings';
  import { formatCalendarDate } from '$lib/prefs';

  interface Props {
    lat: number | null;
    lon: number | null;
    /** `auto` looks dates up whenever the location changes (onboarding);
     *  `manual` starts from what is saved and looks up on request. */
    mode: 'auto' | 'manual';
    stored?: {
      values: Record<FrostField, FrostSuggestedValue>;
      source: string | null;
      probability: FrostProbability | null;
    } | null;
    canEdit?: boolean;
    /** True while the owner still has to confirm or fix something. */
    blocked?: boolean;
  }

  let {
    lat,
    lon,
    mode,
    stored = null,
    canEdit = true,
    blocked = $bindable(false)
  }: Props = $props();

  const LABEL: Record<FrostField, string> = {
    lastFrost: 'Last spring frost',
    firstFrost: 'First fall frost',
    lastHardFrost: 'Last hard frost',
    firstHardFrost: 'First hard frost'
  };

  const MAIN_FIELDS: FrostField[] = ['lastFrost', 'firstFrost'];

  let basis = $state<'lookup' | 'stored'>(untrack(() => (mode === 'auto' ? 'lookup' : 'stored')));
  let probability = $state<FrostProbability>(untrack(() => stored?.probability ?? 'median'));
  let lookup = $state<FrostLookupResult | null>(null);
  let loading = $state(false);
  let editing = $state(false);
  let edits = $state<Partial<Record<FrostField, string>>>({});
  let confirmed = $state(false);
  let seq = 0;

  async function runLookup() {
    if (lat == null || lon == null) {
      lookup = null;
      return;
    }
    const mine = ++seq;
    loading = true;
    const result = await lookupFrostDates(lat, lon, { probability });
    if (mine !== seq) return;
    lookup = result;
    loading = false;
    confirmed = false;
  }

  $effect(() => {
    if (basis !== 'lookup') return;
    void lat;
    void lon;
    void probability;
    const t = setTimeout(() => void untrack(runLookup), 250);
    return () => clearTimeout(t);
  });

  function suggestFromLocation() {
    basis = 'lookup';
    edits = {};
    editing = false;
  }

  const suggestion = $derived.by(() => {
    if (basis === 'lookup') return lookup ? suggestFrostValues(lookup, edits) : null;
    if (!stored) return null;
    return suggestFromStored(stored.values, edits, stored.source);
  });

  const reason = $derived(suggestion ? frostConfirmReason(suggestion) : null);
  const hasIssues = $derived((suggestion?.issues.length ?? 0) > 0);

  $effect(() => {
    blocked =
      basis === 'lookup' && (lat == null || lon == null || loading || !suggestion)
        ? true
        : hasIssues || (reason !== null && !confirmed);
  });

  function pretty(mmdd: string | null): string {
    return mmdd ? formatCalendarDate(`2000-${mmdd}`, 'month-day') : 'None on record';
  }

  function detail(p: FrostValueProvenance): string {
    if (p === 'data') return suggestion?.sourceLabel ?? 'NOAA 1991-2020 normals';
    if (p === 'fallback') return 'Loudoun County averages';
    return 'You set this';
  }

  function posted(f: FrostField): string {
    if (edits[f] !== undefined) return edits[f] ?? '';
    return suggestion?.values[f].value ?? '';
  }

  function startEditing() {
    editing = true;
    const next: Partial<Record<FrostField, string>> = {};
    for (const f of FROST_FIELDS) next[f] = suggestion?.values[f].value ?? '';
    edits = next;
  }
</script>

<section class="frost" aria-labelledby="frost-title">
  <div class="frost-head">
    <h3 id="frost-title" class="serif">
      <Snowflake size={16} aria-hidden="true" /> Frost dates
    </h3>
    {#if mode === 'manual' && canEdit}
      <button
        type="button"
        class="ghost"
        onclick={suggestFromLocation}
        disabled={lat == null || lon == null}
      >
        Suggest from my location
      </button>
    {/if}
  </div>

  <input type="hidden" name="frostBasis" value={basis} />
  <input type="hidden" name="frostProbability" value={probability} />
  {#if !editing}
    {#each FROST_FIELDS as f (f)}
      <input type="hidden" name={f} value={posted(f)} />
    {/each}
  {/if}

  <div aria-live="polite">
    {#if basis === 'lookup' && (lat == null || lon == null)}
      <p class="muted">Set the location above and your frost dates fill in here.</p>
    {:else if basis === 'lookup' && (loading || !suggestion)}
      <p class="muted">Looking up the nearest weather station…</p>
    {:else if suggestion}
      {#if !editing}
        <dl class="dates">
          {#each MAIN_FIELDS as f (f)}
            {@const v = suggestion.values[f]}
            <div class="date">
              <dt>{LABEL[f]}</dt>
              <dd>
                <span class="serif big" data-testid="frost-{f}">{pretty(v.value)}</span>
                <Provenance source={v.provenance} detail={detail(v.provenance)} />
              </dd>
            </div>
          {/each}
        </dl>
        <p class="hard">
          Hard frost (24 °F or colder): last around {pretty(suggestion.values.lastHardFrost.value)},
          first around {pretty(suggestion.values.firstHardFrost.value)}.
          <Provenance source={suggestion.values.lastHardFrost.provenance} compact />
        </p>
      {:else}
        <div class="edit-grid">
          {#each FROST_FIELDS as f (f)}
            {@const issue = suggestion.issues.find((i) => i.field === f)}
            <label class="row">
              <span class="lbl">{LABEL[f]}</span>
              <input
                type="text"
                name={f}
                inputmode="numeric"
                placeholder="MM-DD"
                autocomplete="off"
                value={edits[f] ?? ''}
                oninput={(e) => (edits = { ...edits, [f]: e.currentTarget.value })}
                aria-invalid={issue ? 'true' : undefined}
              />
              {#if issue}<span class="issue" role="alert">{issue.message}</span>{/if}
            </label>
          {/each}
        </div>
        <p class="muted">
          Month and day, like 04-20. Leave a hard-frost date blank if you don't know it.
        </p>
      {/if}

      {#if basis === 'lookup' && suggestion.sourceLabel}
        <p class="src">
          From {suggestion.sourceLabel}, using NOAA's 1991-2020 climate normals.
        </p>
      {:else if basis === 'lookup' && suggestion.fallbackReason}
        <p class="src">{suggestion.fallbackReason}</p>
      {:else if canEdit && basis === 'stored' && suggestion.values.lastFrost.provenance === 'fallback' && suggestion.values.firstFrost.provenance === 'fallback'}
        <p class="src">{FROST_STORED_FALLBACK_COPY}</p>
      {/if}

      <div class="controls">
        {#if basis === 'lookup' && lookup?.provenance === 'data'}
          <label class="check">
            <input
              type="checkbox"
              checked={probability === 'cautious'}
              onchange={(e) => (probability = e.currentTarget.checked ? 'cautious' : 'median')}
              disabled={!canEdit}
            />
            <span>Cautious dates (90%). Nine years in ten, frost is gone by then.</span>
          </label>
        {/if}
        {#if !editing && canEdit}
          <button type="button" class="ghost" onclick={startEditing}>My place runs colder</button>
        {/if}
      </div>

      {#if reason}
        <div class="confirm" role="group" aria-label="Confirm frost dates">
          <p>{FROST_CONFIRM_COPY[reason]}</p>
          <label class="check">
            <input
              type="checkbox"
              name="frostConfirm"
              value="1"
              bind:checked={confirmed}
              disabled={!canEdit}
            />
            <span>These dates are fine for now</span>
          </label>
        </div>
      {/if}
    {/if}
  </div>
</section>

<style>
  .frost {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .frost-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  h3 {
    margin: 0;
    font-size: 17px;
    color: var(--color-forest-deep);
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .dates {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin: 0;
  }
  .date dt {
    font-size: var(--font-size-kicker);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-ink-soft);
    font-weight: 700;
  }
  .date dd {
    margin: 4px 0 0;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .big {
    font-size: 22px;
    color: var(--color-forest-deep);
  }
  .hard,
  .src,
  .muted {
    margin: 0;
    font-size: 13.5px;
    color: var(--color-ink-soft);
    line-height: 1.5;
  }
  .controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    font-size: 13.5px;
    cursor: pointer;
  }
  .check input {
    width: 22px;
    height: 22px;
    accent-color: var(--color-forest);
    flex-shrink: 0;
  }
  .ghost {
    font: inherit;
    font-weight: 600;
    min-height: 48px;
    padding: 0 16px;
    border-radius: var(--radius-input);
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-forest-deep);
    cursor: pointer;
  }
  .ghost:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .edit-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .row {
    display: grid;
    gap: 6px;
  }
  .lbl {
    font-weight: 600;
    font-size: 13.5px;
  }
  .row input {
    font: inherit;
    padding: 0 12px;
    min-height: 48px;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    background: var(--color-paper);
    min-width: 0;
  }
  .issue {
    color: var(--pill-rust-fg);
    font-size: 12.5px;
  }
  .confirm {
    background: var(--pill-wheat-bg);
    border: 1px solid var(--pill-wheat-bd);
    border-radius: var(--radius-card);
    padding: 10px 14px 4px;
    color: var(--color-ink);
  }
  .confirm p {
    margin: 0;
    font-size: 13.5px;
    line-height: 1.5;
  }
  @media (max-width: 520px) {
    .dates,
    .edit-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
