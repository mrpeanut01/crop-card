<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import {
    WATERER_METHODS,
    type StoredSchedule,
    type WatererMethod
  } from '$lib/irrigation/apiSchemas';
  import { WEEKDAY_ORDER, scheduleSummary, weekdayName } from '$lib/irrigation/summary';

  interface AreaOption {
    id: string;
    name: string;
    beds: Array<{ id: string; name: string }>;
  }

  interface Props {
    equipmentId: string;
    schedule: StoredSchedule | null;
    /** The template's method, used when there is no schedule yet. */
    defaultMethod: WatererMethod;
    targets: Array<{ fieldId: string; blockId: string | null }>;
    areas: AreaOption[];
    canEdit: boolean;
  }

  const { equipmentId, schedule, defaultMethod, targets, areas, canEdit }: Props = $props();
  const tr = $derived(createT(page.data?.locale));
  const locale = $derived(page.data?.locale as string | undefined);

  let editing = $state(false);
  let days = $state<number[]>([]);
  let start = $state('06:00');
  let minutes = $state<number | null>(20);
  let method = $state<WatererMethod>('drip');
  let inches = $state<number | null>(null);
  let gpm = $state<number | null>(null);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let saved = $state<string | null>(null);

  function startEdit() {
    days = schedule ? [...schedule.days] : [1, 3, 5];
    start = schedule?.start ?? '06:00';
    minutes = schedule?.minutes ?? 20;
    method = schedule?.method ?? defaultMethod;
    inches = schedule?.inchesPerRun ?? null;
    gpm = schedule?.gallonsPerMinute ?? null;
    error = null;
    saved = null;
    editing = true;
  }

  function toggleDay(d: number) {
    days = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
  }

  async function patch(body: unknown): Promise<boolean> {
    saving = true;
    error = null;
    try {
      const res = await fetch(`/api/equipment/${encodeURIComponent(equipmentId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        error = out.error ?? tr('herbse.timer.skipError');
        return false;
      }
      await invalidateAll();
      return true;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      saving = false;
    }
  }

  async function saveSchedule() {
    if (days.length === 0) {
      error = tr('herbse.editor.err.days');
      return;
    }
    if (minutes === null || !Number.isInteger(minutes) || minutes < 1 || minutes > 720) {
      error = tr('herbse.editor.err.minutes');
      return;
    }
    const ok = await patch({
      spec: {
        schedule: {
          days: [...days].sort((a, b) => a - b),
          start,
          minutes,
          method,
          inchesPerRun: inches !== null && inches > 0 ? inches : null,
          gallonsPerMinute: gpm !== null && gpm > 0 ? gpm : null
        }
      }
    });
    if (ok) {
      editing = false;
      saved = tr('herbse.editor.saved');
    }
  }

  async function clearSchedule() {
    if (await patch({ spec: { schedule: null } })) {
      editing = false;
      saved = tr('herbse.editor.saved');
    }
  }

  const initialPicked = (): string[] =>
    targets.map((t) => (t.blockId ? `b:${t.blockId}` : `a:${t.fieldId}`));
  let picked = $state<string[]>([]);
  let targetsDirty = $state(false);
  $effect(() => {
    if (!targetsDirty) picked = initialPicked();
  });
  let savingTargets = $state(false);
  let targetsError = $state<string | null>(null);

  function togglePick(key: string) {
    targetsDirty = true;
    picked = picked.includes(key) ? picked.filter((k) => k !== key) : [...picked, key];
  }

  async function saveTargets() {
    savingTargets = true;
    targetsError = null;
    try {
      const res = await fetch(`/api/equipment/${encodeURIComponent(equipmentId)}/water-targets`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          areaIds: picked.filter((k) => k.startsWith('a:')).map((k) => k.slice(2)),
          blockIds: picked.filter((k) => k.startsWith('b:')).map((k) => k.slice(2))
        })
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        targetsError = out.error ?? tr('herbse.timer.skipError');
        return;
      }
      targetsDirty = false;
      await invalidateAll();
      saved = tr('herbse.editor.saved');
    } catch (e) {
      targetsError = e instanceof Error ? e.message : String(e);
    } finally {
      savingTargets = false;
    }
  }

  const targetNames = $derived(
    targets.map((t) => {
      const area = areas.find((a) => a.id === t.fieldId);
      if (!t.blockId) return tr('herbse.targets.wholeArea', { area: area?.name ?? t.fieldId });
      const bed = area?.beds.find((b) => b.id === t.blockId);
      return area ? `${area.name} · ${bed?.name ?? t.blockId}` : (bed?.name ?? t.blockId);
    })
  );
</script>

<section class="card" data-testid="waterer-editor">
  <h2>{tr('herbse.editor.title')}</h2>
  <p class="lede">{tr('herbse.editor.lede')}</p>

  {#if schedule && !editing}
    <p class="summary" data-testid="waterer-summary">
      {scheduleSummary(schedule, locale)}
      <Provenance source="manual" detail={tr('herbse.editor.manual')} />
    </p>
    <p class="amount">
      {#if schedule.inchesPerRun != null}
        {tr('herbse.editor.inchesSet', { inches: String(schedule.inchesPerRun) })}
      {:else}
        <span class="warn">{tr('herbse.editor.noInches')}</span>
      {/if}
    </p>
  {:else if !schedule && !editing}
    <p class="empty">{tr('herbse.editor.none')}</p>
  {/if}

  {#if editing}
    <fieldset class="days">
      <legend>{tr('herbse.editor.days')}</legend>
      {#each WEEKDAY_ORDER as d (d)}
        <button
          type="button"
          class="day"
          class:on={days.includes(d)}
          aria-pressed={days.includes(d)}
          aria-label={weekdayName(d, locale, 'long')}
          onclick={() => toggleDay(d)}>{weekdayName(d, locale)}</button
        >
      {/each}
    </fieldset>
    <div class="grid">
      <label>
        <span>{tr('herbse.editor.start')}</span>
        <input type="time" bind:value={start} disabled={saving} data-testid="waterer-start" />
      </label>
      <label>
        <span>{tr('herbse.editor.minutes')}</span>
        <input
          type="number"
          min="1"
          max="720"
          step="1"
          inputmode="numeric"
          bind:value={minutes}
          disabled={saving}
          data-testid="waterer-minutes"
        />
      </label>
      <label>
        <span>{tr('herbse.editor.method')}</span>
        <select bind:value={method} disabled={saving}>
          {#each WATERER_METHODS as m (m)}
            <option value={m}>{tr(`herbse.method.${m}`)}</option>
          {/each}
        </select>
      </label>
      <label>
        <span>{tr('herbse.editor.inches')}</span>
        <input
          type="number"
          min="0.01"
          max="5"
          step="any"
          inputmode="decimal"
          bind:value={inches}
          disabled={saving}
          data-testid="waterer-inches"
        />
      </label>
      <label>
        <span>{tr('herbse.editor.gpm')}</span>
        <input
          type="number"
          min="0"
          max="500"
          step="any"
          inputmode="decimal"
          bind:value={gpm}
          disabled={saving}
        />
      </label>
    </div>
    <p class="hint" class:warn={inches === null || !(inches > 0)}>
      {tr('herbse.editor.inchesHint')}
    </p>
    <p class="hint">{tr('herbse.editor.gpmHint')}</p>
    <div class="actions">
      <button class="primary" onclick={saveSchedule} disabled={saving} data-testid="waterer-save">
        {saving ? tr('herbse.editor.saving') : tr('herbse.editor.save')}
      </button>
      <button class="btn" onclick={() => (editing = false)} disabled={saving}
        >{tr('herbse.editor.cancel')}</button
      >
      {#if schedule}
        <button class="btn" onclick={clearSchedule} disabled={saving}
          >{tr('herbse.editor.clear')}</button
        >
      {/if}
    </div>
  {:else if canEdit}
    <div class="actions">
      <button class="btn" onclick={startEdit} data-testid="waterer-edit">
        {schedule ? tr('herbse.editor.edit') : tr('herbse.editor.set')}
      </button>
    </div>
  {:else}
    <p class="hint">{tr('herbse.editor.askOwner')}</p>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}

  <h3>{tr('herbse.targets.title')}</h3>
  {#if targetNames.length}
    <ul class="targets" data-testid="waterer-targets">
      {#each targetNames as name (name)}<li>{name}</li>{/each}
    </ul>
  {:else}
    <p class="empty">{tr('herbse.targets.none')}</p>
  {/if}
  {#if canEdit}
    {#if areas.length === 0}
      <p class="hint">{tr('herbse.targets.noAreas')}</p>
    {:else}
      <div class="pick">
        {#each areas as area (area.id)}
          <fieldset>
            <legend>{area.name}</legend>
            <label class="check">
              <input
                type="checkbox"
                checked={picked.includes(`a:${area.id}`)}
                onchange={() => togglePick(`a:${area.id}`)}
              />
              <span>{tr('herbse.targets.wholeArea', { area: area.name })}</span>
            </label>
            {#each area.beds as bed (bed.id)}
              <label class="check">
                <input
                  type="checkbox"
                  checked={picked.includes(`b:${bed.id}`)}
                  disabled={picked.includes(`a:${area.id}`)}
                  onchange={() => togglePick(`b:${bed.id}`)}
                />
                <span>{bed.name}</span>
              </label>
            {/each}
          </fieldset>
        {/each}
      </div>
      <div class="actions">
        <button
          class="primary"
          onclick={saveTargets}
          disabled={savingTargets || !targetsDirty}
          data-testid="waterer-targets-save"
        >
          {savingTargets ? tr('herbse.editor.saving') : tr('herbse.targets.save')}
        </button>
      </div>
      {#if targetsError}<p class="error" role="alert">{targetsError}</p>{/if}
    {/if}
  {/if}
  {#if saved}<p class="saved" role="status">{saved}</p>{/if}
</section>

<style>
  .card {
    background: var(--color-paper, #fff);
    border: 1px solid var(--color-divider-soft, #dfe5dc);
    border-radius: var(--radius-card, 8px);
    padding: 1rem;
    margin-bottom: 1rem;
  }
  h2 {
    margin: 0 0 0.35rem;
  }
  h3 {
    margin: 1rem 0 0.35rem;
    font-size: 1rem;
  }
  .lede,
  .hint,
  .empty {
    color: var(--color-ink-soft, #4a5a4a);
    margin: 0.25rem 0;
  }
  .warn {
    color: var(--color-rust, #8a3b12);
    font-weight: 600;
  }
  .summary {
    font-weight: 600;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    margin: 0.5rem 0 0.25rem;
  }
  .amount {
    margin: 0 0 0.5rem;
  }
  .days {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    border: none;
    padding: 0;
    margin: 0.5rem 0;
  }
  .days legend {
    font-weight: 600;
    margin-bottom: 0.35rem;
  }
  .day {
    min-width: 48px;
    min-height: 48px;
    border-radius: 999px;
    border: 2px solid var(--color-divider, #cbd5cb);
    background: var(--color-paper, #fff);
    color: var(--color-ink, #1b2a1b);
    font-weight: 600;
    cursor: pointer;
  }
  .day.on {
    background: var(--color-forest-deep, #1f5e3a);
    border-color: var(--color-forest-deep, #1f5e3a);
    color: #fff;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 11rem), 1fr));
    gap: 0.75rem;
  }
  .grid label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-weight: 600;
    min-width: 0;
  }
  .grid input,
  .grid select {
    min-height: 48px;
    font: inherit;
    padding: 0 0.5rem;
    border: 1px solid var(--color-divider, #cbd5cb);
    border-radius: 6px;
    box-sizing: border-box;
    width: 100%;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  .primary,
  .btn {
    min-height: 48px;
    padding: 0 1rem;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
    font: inherit;
  }
  .primary {
    background: var(--color-forest-deep, #1f5e3a);
    color: #fff;
    border: none;
  }
  .btn {
    background: var(--color-paper, #fff);
    color: var(--color-forest-deep, #1f5e3a);
    border: 2px solid var(--color-forest-deep, #1f5e3a);
  }
  .pick fieldset {
    border: 1px solid var(--color-divider-soft, #dfe5dc);
    border-radius: 6px;
    margin: 0.5rem 0;
    padding: 0.5rem 0.75rem;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-height: 48px;
    cursor: pointer;
  }
  .check input {
    width: 22px;
    height: 22px;
  }
  .targets {
    margin: 0.25rem 0;
    padding-left: 1.25rem;
  }
  .error {
    color: var(--color-rust, #8a3b12);
  }
  .saved {
    color: var(--color-forest-deep, #1f5e3a);
    font-weight: 600;
  }
</style>
