<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import type { PlanningYearView } from '$lib/season/planningYear';

  interface Props {
    view: PlanningYearView;
    /** Form-field mode: renders plain radios under this name and never
     *  saves on its own (used before the farm exists). */
    name?: string;
    canEdit?: boolean;
    /** Where each past year links for its read-only view. */
    pastYearHref?: (year: number) => string;
    onChange?: (view: PlanningYearView) => void;
  }

  const {
    view,
    name,
    canEdit = true,
    pastYearHref = (y) => `/settings/season?year=${y}`,
    onChange
  }: Props = $props();

  let selected = $derived(view.activeYear);
  let saving = $state(false);
  let error = $state<string | null>(null);

  async function choose(year: number) {
    selected = year;
    if (name || year === view.activeYear) return;
    saving = true;
    error = null;
    try {
      const res = await fetch('/api/season/year', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ year })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
      const next = (await res.json()) as PlanningYearView;
      onChange?.(next);
      await invalidateAll();
    } catch (err) {
      selected = view.activeYear;
      error = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }
</script>

<fieldset class="pyp" disabled={!canEdit || saving} aria-describedby="pyp-reason">
  <legend class="pyp-legend">Which planting year are you setting up?</legend>
  <div class="pyp-options">
    {#each view.options as year (year)}
      <label class="pyp-option" class:checked={selected === year}>
        <input
          type="radio"
          name={name ?? 'planning-year'}
          value={year}
          checked={selected === year}
          onchange={() => choose(year)}
        />
        <span class="pyp-year serif">{year}</span>
        {#if year === view.suggestedYear}
          <span class="pyp-tag">Suggested</span>
        {/if}
      </label>
    {/each}
  </div>
  <p class="pyp-reason" id="pyp-reason">{view.suggestionReason}</p>
  {#if error}
    <p class="pyp-error" role="alert">{error}</p>
  {/if}
  {#if view.pastYears.length > 0}
    <p class="pyp-past">
      <span>Past seasons (view only):</span>
      {#each view.pastYears as year (year)}
        <a href={pastYearHref(year)}>{year}</a>
      {/each}
    </p>
  {/if}
</fieldset>

<style>
  .pyp {
    border: 0;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .pyp-legend {
    padding: 0;
    margin-bottom: 8px;
    font-weight: 600;
    color: var(--color-forest-deep);
  }
  .pyp-options {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .pyp-option {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    padding: 8px 16px;
    border: 1px solid var(--color-divider);
    border-radius: 8px;
    background: var(--color-paper, #fff);
    cursor: pointer;
  }
  .pyp-option.checked {
    border-color: var(--color-forest);
    box-shadow: inset 0 0 0 1px var(--color-forest);
  }
  .pyp-option input {
    width: 18px;
    height: 18px;
    accent-color: var(--color-forest);
  }
  .pyp-option:has(input:focus-visible) {
    outline: 2px solid var(--color-forest);
    outline-offset: 2px;
  }
  .pyp-year {
    font-size: 20px;
    font-weight: 700;
    color: var(--color-forest-deep);
  }
  .pyp-tag {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: var(--radius-pill, 999px);
    background: var(--pill-forest-bg, #e7f4ec);
    color: var(--pill-forest-fg, #1f5e3a);
  }
  .pyp-reason,
  .pyp-past {
    margin: 0;
    font-size: 13px;
    color: var(--color-ink-soft);
    line-height: 1.45;
  }
  .pyp-past {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
  }
  .pyp-past a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    padding: 0 4px;
    color: var(--color-forest);
    font-weight: 600;
  }
  .pyp-error {
    margin: 0;
    font-size: 13px;
    color: var(--pill-rust-fg, #8a3b34);
  }
  fieldset:disabled .pyp-option {
    cursor: default;
    opacity: 0.75;
  }
</style>
