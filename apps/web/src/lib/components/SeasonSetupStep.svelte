<script lang="ts">
  /**
   * Season Setup wizard step (Phase 21 / UC-42).
   *
   * Five-question form (plus one conditional) that gates downstream Phase 21
   * input planning. Renders inside `AllocationWizard.svelte` as the new
   * first step before 'seeds'. Also reused on /settings/season.
   *
   * State management is local — server persistence happens on submit via
   * POST /api/season/setup. Carry-forward uses POST /api/season/setup/carry-forward.
   */

  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  import type { SeasonSetup } from '$lib/season/setup';
  import { SEASON_SETUP_DEFAULTS, seasonSetupLabels } from '$lib/season/setup';

  const tr = $derived(createT(page.data?.locale));
  const labels = $derived(seasonSetupLabels(page.data?.locale));

  let {
    existing,
    lastYearSetup,
    currentYear,
    onSave
  }: {
    existing: SeasonSetup | null;
    lastYearSetup: SeasonSetup | null;
    currentYear: number;
    onSave: (setup: SeasonSetup) => void;
  } = $props();

  // Seed local form state from props ONCE on mount. The form is owned by
  // this step; subsequent prop changes from the parent are intentionally
  // ignored (a re-mount happens when the wizard step changes). `untrack`
  // makes this acknowledgement explicit so Svelte 5 doesn't warn.
  const seed = untrack(() => existing ?? lastYearSetup ?? { ...SEASON_SETUP_DEFAULTS });

  let philosophy = $state(seed.philosophy);
  let weedStrategy = $state(seed.weedStrategy);
  let pestStrategy = $state(seed.pestStrategy);
  let fertilityApproach = $state(seed.fertilityApproach);
  let coverCropIntent = $state(seed.coverCropIntent);
  let transitioningStartedYear = $state<number | null>(
    untrack(() =>
      seed.philosophy === 'organic-transitioning'
        ? (('transitioningStartedYear' in seed ? seed.transitioningStartedYear : null) ??
          currentYear - 1)
        : null
    )
  );

  let saving = $state(false);
  let error = $state<string | null>(null);

  // Whenever philosophy flips into organic-transitioning, seed the year if
  // it's currently null. When flipping away, null it out so the conditional
  // input doesn't render stale state.
  $effect(() => {
    if (philosophy === 'organic-transitioning' && transitioningStartedYear === null) {
      transitioningStartedYear = currentYear - 1;
    } else if (philosophy !== 'organic-transitioning') {
      transitioningStartedYear = null;
    }
  });

  async function submit() {
    saving = true;
    error = null;
    try {
      const res = await fetch('/api/season/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          year: currentYear,
          philosophy,
          weedStrategy,
          pestStrategy,
          fertilityApproach,
          coverCropIntent,
          transitioningStartedYear
        })
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || tr('wizard.setup.saveFailed', { status: res.status }));
      }
      const data = (await res.json()) as { setup: SeasonSetup };
      onSave(data.setup);
    } catch (e) {
      error = e instanceof Error ? e.message : tr('wizard.setup.unknownError');
    } finally {
      saving = false;
    }
  }

  async function useLastYear() {
    if (!lastYearSetup) return;
    saving = true;
    error = null;
    try {
      const res = await fetch('/api/season/setup/carry-forward', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fromYear: lastYearSetup.year,
          toYear: currentYear
        })
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || tr('wizard.setup.carryFailed', { status: res.status }));
      }
      const data = (await res.json()) as { setup: SeasonSetup | null };
      if (data.setup) {
        onSave(data.setup);
      } else {
        error = tr('wizard.setup.noSaved', { year: lastYearSetup.year });
      }
    } catch (e) {
      error = e instanceof Error ? e.message : tr('wizard.setup.unknownError');
    } finally {
      saving = false;
    }
  }
</script>

<div class="ss-step">
  <header class="ss-header">
    <h3>{tr('wizard.setup.title', { year: currentYear })}</h3>
    <p class="ss-intro">
      {tr('wizard.setup.intro')}
      <a href="/settings/season">{tr('wizard.setup.introLink')}</a>.
    </p>
    {#if lastYearSetup && !existing}
      <button type="button" class="ss-carry" disabled={saving} onclick={useLastYear}>
        ↻ {tr('wizard.setup.useLast', { year: lastYearSetup.year })}
      </button>
    {/if}
  </header>

  <form
    class="ss-form"
    onsubmit={(e) => {
      e.preventDefault();
      submit();
    }}
  >
    <label class="ss-field">
      <span class="ss-label">{tr('wizard.setup.philosophy')}</span>
      <select bind:value={philosophy} disabled={saving} required>
        {#each Object.entries(labels.philosophy) as [val, label] (val)}
          <option value={val}>{label}</option>
        {/each}
      </select>
      <span class="ss-hint">
        {tr('wizard.setup.philosophyHint')}
      </span>
    </label>

    {#if philosophy === 'organic-transitioning'}
      <label class="ss-field">
        <span class="ss-label">{tr('wizard.setup.transition')}</span>
        <input
          type="number"
          min="1900"
          max="3000"
          step="1"
          bind:value={transitioningStartedYear}
          disabled={saving}
          required
        />
        <span class="ss-hint">
          {tr('wizard.setup.transitionHint')}
        </span>
      </label>
    {/if}

    <label class="ss-field">
      <span class="ss-label">{tr('wizard.setup.weed')}</span>
      <select bind:value={weedStrategy} disabled={saving} required>
        {#each Object.entries(labels.weed) as [val, label] (val)}
          <option value={val}>{label}</option>
        {/each}
      </select>
      <span class="ss-hint">{tr('wizard.setup.weedHint')}</span>
    </label>

    <label class="ss-field">
      <span class="ss-label">{tr('wizard.setup.pest')}</span>
      <select bind:value={pestStrategy} disabled={saving} required>
        {#each Object.entries(labels.pest) as [val, label] (val)}
          <option value={val}>{label}</option>
        {/each}
      </select>
      <span class="ss-hint">
        {tr('wizard.setup.pestHint')}
      </span>
    </label>

    <label class="ss-field">
      <span class="ss-label">{tr('wizard.setup.cover')}</span>
      <select bind:value={coverCropIntent} disabled={saving} required>
        {#each Object.entries(labels.cover) as [val, label] (val)}
          <option value={val}>{label}</option>
        {/each}
      </select>
      <span class="ss-hint">
        {tr('wizard.setup.coverHint')}
      </span>
    </label>

    <label class="ss-field">
      <span class="ss-label">{tr('wizard.setup.fert')}</span>
      <select bind:value={fertilityApproach} disabled={saving} required>
        {#each Object.entries(labels.fert) as [val, label] (val)}
          <option value={val}>{label}</option>
        {/each}
      </select>
      <span class="ss-hint">
        {tr('wizard.setup.fertHint')}
      </span>
    </label>

    {#if error}
      <p class="ss-error" role="alert">⚠ {error}</p>
    {/if}

    <div class="ss-actions">
      <button type="submit" class="ss-submit" disabled={saving}>
        {existing ? tr('wizard.setup.saveChanges') : tr('wizard.setup.save')}
      </button>
    </div>
  </form>
</div>

<style>
  .ss-step {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    width: 100%;
    max-width: 640px;
    margin: 0 auto;
  }
  .ss-header {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .ss-header h3 {
    margin: 0;
    font-size: 1.15rem;
    color: #1f5e3a;
  }
  .ss-intro {
    margin: 0;
    font-size: 0.9rem;
    color: #4a5a4a;
    line-height: 1.4;
  }
  .ss-intro a {
    color: #1f5e3a;
    text-decoration: underline;
  }
  .ss-carry {
    align-self: flex-start;
    min-height: 48px;
    padding: 0.5rem 1rem;
    background: #f0f7f2;
    color: #1f5e3a;
    border: 1px solid #1f5e3a;
    border-radius: 6px;
    font-weight: 600;
    font-size: 0.95rem;
    cursor: pointer;
  }
  .ss-carry:hover:not(:disabled) {
    background: #1f5e3a;
    color: white;
  }
  .ss-carry:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ss-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .ss-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .ss-label {
    font-weight: 600;
    color: #1f5e3a;
    font-size: 0.95rem;
  }
  .ss-field select,
  .ss-field input[type='number'] {
    max-width: 100%;
    min-height: 48px;
    padding: 0.5rem 0.75rem;
    font-size: 1rem;
    border: 1px solid #c4d2c4;
    border-radius: 6px;
    background: white;
    color: #1a1a1a;
  }
  .ss-field select:focus-visible,
  .ss-field input[type='number']:focus-visible {
    outline: 2px solid #1f5e3a;
    outline-offset: 2px;
  }
  .ss-hint {
    font-size: 0.82rem;
    color: #6a7d6a;
    line-height: 1.35;
  }
  .ss-error {
    margin: 0;
    padding: 0.5rem 0.75rem;
    background: #fdecea;
    border: 1px solid #b71c1c;
    border-radius: 6px;
    color: #6e0c0c;
    font-size: 0.9rem;
  }
  .ss-actions {
    display: flex;
    justify-content: flex-end;
    padding-top: 0.5rem;
  }
  .ss-submit {
    min-height: 48px;
    padding: 0.6rem 1.5rem;
    background: #1f5e3a;
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 700;
    font-size: 1rem;
    cursor: pointer;
  }
  .ss-submit:hover:not(:disabled) {
    background: #174a2c;
  }
  .ss-submit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
