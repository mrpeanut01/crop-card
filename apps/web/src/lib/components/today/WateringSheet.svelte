<script lang="ts">
  import { onMount } from 'svelte';
  import { submitGauge, submitWatering } from '$lib/irrigation/client';
  import { IRRIGATION_METHOD_VALUES } from '$lib/irrigation/apiSchemas';
  import { gaugeCountsFrom } from '$lib/weather/waterBalance';
  import { inchesText } from '$lib/weather/waterCopy';
  import { dateTimeFormat } from '$lib/intlCache';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import type { AdviceSheet } from '$lib/today/advice';

  interface Summary {
    area: { id: string; name: string; kind: string; sized: boolean };
    beds: Array<{ id: string; name: string; sized: boolean }>;
    target: { inches: number; provenance: 'manual' | 'fallback' } | null;
    targetSource: string | null;
    canSetTarget: boolean;
    canLog: boolean;
    lastGaugeAt: number | null;
    areas: Array<{ id: string; name: string; lastGaugeAt: number | null }>;
    gauges: Array<{ id: string; readAt: number; inches: number; canRemove: boolean }>;
    logs: Array<{
      id: string;
      blockId: string | null;
      occurredAt: number;
      inches: number | null;
      gallons: number | null;
      durationMin: number | null;
      method: string | null;
      canRemove: boolean;
    }>;
  }

  interface Props {
    mode: AdviceSheet;
    fieldId: string;
    onDone: (message: string) => void;
    fetcher?: typeof fetch;
  }

  const { mode, fieldId, onDone, fetcher }: Props = $props();
  const uid = $props.id();
  const doFetch = (...args: Parameters<typeof fetch>) => (fetcher ?? fetch)(...args);

  const METHOD_LABEL: Record<(typeof IRRIGATION_METHOD_VALUES)[number], string> = {
    drip: 'Drip line',
    soaker: 'Soaker hose',
    sprinkler: 'Sprinkler',
    hand: 'Hose or can by hand',
    flood: 'Flood or furrow',
    other: 'Other'
  };

  function localNow(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function whenText(ms: number): string {
    return dateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(
      new Date(ms)
    );
  }

  let summary = $state<Summary | null>(null);
  let loadError = $state<string | null>(null);
  let error = $state<string | null>(null);
  let saving = $state(false);

  let blockId = $state('');
  let when = $state(localNow());
  let amountKind = $state<'inches' | 'gallons' | 'minutes'>('inches');
  let amount = $state<number | null>(null);
  let method = $state('');
  let notes = $state('');

  let gaugeInches = $state<number | null>(null);
  let alsoAreas = $state<string[]>([]);

  let targetInput = $state<number | null>(null);
  let targetMessage = $state<string | null>(null);

  async function load() {
    try {
      const res = await doFetch(`/api/irrigation/summary?fieldId=${encodeURIComponent(fieldId)}`);
      if (!res.ok) {
        loadError = 'This Area could not load. Try again in a moment.';
        return;
      }
      summary = (await res.json()) as Summary;
      targetInput = summary.target?.inches ?? null;
    } catch {
      loadError = 'No connection. You can still save; it sends when you have signal.';
    }
  }

  onMount(() => {
    void load();
  });

  const whenMs = $derived(
    Number.isNaN(new Date(when).getTime()) ? Date.now() : new Date(when).getTime()
  );
  const countsFrom = $derived(gaugeCountsFrom(summary?.lastGaugeAt ?? null, whenMs));
  const targetSized = $derived.by(() => {
    if (!summary) return true;
    if (!blockId) return summary.area.sized;
    return summary.beds.find((b) => b.id === blockId)?.sized ?? summary.area.sized;
  });
  const otherAreas = $derived((summary?.areas ?? []).filter((a) => a.id !== fieldId));

  async function saveWatering(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    if (amount === null || !Number.isFinite(amount) || amount <= 0) {
      error = 'Enter how much you watered.';
      return;
    }
    saving = true;
    try {
      const out = await submitWatering({
        fieldId,
        blockId: blockId || null,
        occurredAt: whenMs,
        inches: amountKind === 'inches' ? amount : null,
        gallons: amountKind === 'gallons' ? amount : null,
        durationMin: amountKind === 'minutes' ? Math.round(amount) : null,
        method: (method || null) as (typeof IRRIGATION_METHOD_VALUES)[number] | null,
        notes: notes.trim() || null
      });
      if (out.status === 'error') error = out.message;
      else
        onDone(
          out.status === 'queued'
            ? 'Watering saved on this phone. It sends when you have signal.'
            : 'Watering saved.'
        );
    } finally {
      saving = false;
    }
  }

  async function saveGauge(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    if (gaugeInches === null || !Number.isFinite(gaugeInches) || gaugeInches < 0) {
      error = 'Enter the inches in the gauge. Enter 0 if it is dry.';
      return;
    }
    if (gaugeInches > 15) {
      error = 'That is more than 15 inches. Check the reading.';
      return;
    }
    saving = true;
    try {
      const out = await submitGauge({
        fieldIds: [fieldId, ...alsoAreas],
        readAt: whenMs,
        inches: gaugeInches
      });
      if (out.status === 'error') error = out.message;
      else
        onDone(
          out.status === 'queued'
            ? 'Gauge reading saved on this phone. It sends when you have signal.'
            : 'Gauge reading saved.'
        );
    } finally {
      saving = false;
    }
  }

  async function saveTarget(reset: boolean) {
    targetMessage = null;
    const inches = reset ? null : targetInput;
    if (!reset && (inches === null || inches < 0.1 || inches > 5)) {
      targetMessage = 'Enter between 0.1 and 5 inches a week.';
      return;
    }
    const res = await doFetch('/api/irrigation/target', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fieldId, inches })
    }).catch(() => null);
    if (!res || !res.ok) {
      targetMessage = 'The target did not save. Try again with signal.';
      return;
    }
    const body = (await res.json()) as { target: Summary['target'] };
    if (summary) summary = { ...summary, target: body.target };
    targetInput = body.target?.inches ?? null;
    targetMessage = 'Target saved.';
  }

  async function remove(kind: 'irrigation' | 'rain-gauge', id: string) {
    const res = await doFetch(`/api/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(
      () => null
    );
    if (!res || !res.ok) {
      error = 'That could not be removed. Try again with signal.';
      return;
    }
    await load();
  }

  function logAmount(l: Summary['logs'][number]): string {
    if (l.inches !== null) return inchesText(l.inches);
    if (l.gallons !== null) return `${l.gallons} gal`;
    if (l.durationMin !== null) return `${l.durationMin} min, amount not logged`;
    return 'amount not logged';
  }
</script>

<div class="watering-sheet" data-testid="watering-sheet">
  {#if loadError}<p class="note" role="status">{loadError}</p>{/if}
  {#if summary && !summary.canLog}
    <p class="note" role="note">You can read this Area's watering. Inspectors can't log it.</p>
  {:else if mode === 'log-watering'}
    <form onsubmit={saveWatering} data-testid="log-watering-form">
      {#if summary && summary.beds.length > 0}
        <label for="{uid}-bed">Where</label>
        <select id="{uid}-bed" bind:value={blockId} data-autofocus>
          <option value="">All of {summary.area.name}</option>
          {#each summary.beds as b (b.id)}
            <option value={b.id}>{b.name}</option>
          {/each}
        </select>
      {/if}
      <label for="{uid}-when">When</label>
      <input id="{uid}-when" type="datetime-local" bind:value={when} required />
      <fieldset>
        <legend>How much?</legend>
        <div class="choices">
          <label class="choice" class:on={amountKind === 'inches'}>
            <input type="radio" name="{uid}-kind" value="inches" bind:group={amountKind} />
            Inches
          </label>
          <label class="choice" class:on={amountKind === 'gallons'}>
            <input type="radio" name="{uid}-kind" value="gallons" bind:group={amountKind} />
            Gallons
          </label>
          <label class="choice" class:on={amountKind === 'minutes'}>
            <input type="radio" name="{uid}-kind" value="minutes" bind:group={amountKind} />
            Minutes
          </label>
        </div>
        <input
          aria-label={amountKind === 'inches'
            ? 'Inches of water'
            : amountKind === 'gallons'
              ? 'Gallons'
              : 'Minutes'}
          type="number"
          min="0"
          step="any"
          inputmode="decimal"
          bind:value={amount}
        />
        {#if amountKind === 'minutes'}
          <p class="help">
            Minutes alone don't say how much water went on, so the advice can't count it.
          </p>
        {:else if amountKind === 'gallons' && !targetSized}
          <p class="help" data-testid="gallons-no-size">
            {blockId ? 'This bed' : 'This Area'} has no size yet, so gallons can't be turned into inches.
            Add its size on the farm map, or log inches instead.
          </p>
        {/if}
      </fieldset>
      <label for="{uid}-method">How <span class="optional">(optional)</span></label>
      <select id="{uid}-method" bind:value={method}>
        <option value="">Not saying</option>
        {#each IRRIGATION_METHOD_VALUES as m (m)}
          <option value={m}>{METHOD_LABEL[m]}</option>
        {/each}
      </select>
      <label for="{uid}-notes">Notes <span class="optional">(optional)</span></label>
      <input id="{uid}-notes" type="text" maxlength="500" bind:value={notes} />
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button class="primary" type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Save watering'}
      </button>
    </form>
  {:else}
    <form onsubmit={saveGauge} data-testid="rain-gauge-form">
      <label for="{uid}-gauge">Inches in the gauge</label>
      <input
        id="{uid}-gauge"
        type="number"
        min="0"
        max="15"
        step="0.01"
        inputmode="decimal"
        bind:value={gaugeInches}
        data-autofocus
      />
      <label for="{uid}-read">When you read it</label>
      <input id="{uid}-read" type="datetime-local" bind:value={when} required />
      <p class="help" data-testid="gauge-counts-from">
        Counts as rain since {whenText(countsFrom)}{summary?.lastGaugeAt &&
        countsFrom === summary.lastGaugeAt
          ? ', your last reading'
          : ', the 24 hours before you read it'}. Empty the gauge after you read it.
      </p>
      {#if otherAreas.length > 0}
        <fieldset>
          <legend>Also count it for</legend>
          {#each otherAreas as a (a.id)}
            <label class="check">
              <input type="checkbox" value={a.id} bind:group={alsoAreas} />
              {a.name}
            </label>
          {/each}
        </fieldset>
      {/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button class="primary" type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Save gauge reading'}
      </button>
    </form>
  {/if}

  {#if summary}
    <section class="target" aria-labelledby="{uid}-target">
      <h3 id="{uid}-target">Weekly water target</h3>
      {#if summary.target}
        <p>
          {inchesText(summary.target.inches)} a week
          <Provenance
            source={summary.target.provenance}
            detail={summary.target.provenance === 'manual'
              ? 'your setting'
              : (summary.targetSource ?? undefined)}
          />
        </p>
      {:else}
        <p>No weekly water target set.</p>
      {/if}
      {#if summary.canSetTarget}
        <div class="target-row">
          <input
            aria-label="Inches a week"
            type="number"
            min="0.1"
            max="5"
            step="0.1"
            inputmode="decimal"
            bind:value={targetInput}
          />
          <button type="button" class="ghost" onclick={() => saveTarget(false)}>Save target</button>
          {#if summary.target?.provenance === 'manual'}
            <button type="button" class="ghost" onclick={() => saveTarget(true)}>Use default</button
            >
          {/if}
        </div>
        {#if targetMessage}<p class="help" role="status">{targetMessage}</p>{/if}
      {:else}
        <p class="help">Ask the owner to change the target.</p>
      {/if}
    </section>

    {#if mode === 'log-watering' && summary.logs.length > 0}
      <section aria-labelledby="{uid}-logs">
        <h3 id="{uid}-logs">Watering this week</h3>
        <ul class="history">
          {#each summary.logs as l (l.id)}
            <li>
              <span>
                {whenText(l.occurredAt)}: {logAmount(l)}{l.blockId
                  ? `, ${summary.beds.find((b) => b.id === l.blockId)?.name ?? 'one bed'}`
                  : ''}
              </span>
              {#if l.canRemove}
                <button type="button" class="ghost" onclick={() => remove('irrigation', l.id)}>
                  Remove
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}
    {#if mode === 'rain-gauge' && summary.gauges.length > 0}
      <section aria-labelledby="{uid}-gauges">
        <h3 id="{uid}-gauges">Recent gauge readings</h3>
        <ul class="history">
          {#each summary.gauges as g (g.id)}
            <li>
              <span>{whenText(g.readAt)}: {inchesText(g.inches)}</span>
              {#if g.canRemove}
                <button type="button" class="ghost" onclick={() => remove('rain-gauge', g.id)}>
                  Remove
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</div>

<style>
  .watering-sheet {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  label,
  legend {
    font-weight: 600;
    color: var(--color-ink);
  }
  fieldset {
    border: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  input,
  select {
    min-height: 48px;
    font-size: 16px;
    padding: 0 var(--space-2);
    border: 1px solid var(--color-divider);
    border-radius: 8px;
    background: var(--color-paper);
    color: var(--color-ink);
    max-width: 100%;
    box-sizing: border-box;
  }
  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .choice {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 48px;
    padding: 0 var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: 999px;
    font-weight: 500;
  }
  .choice.on {
    border-color: var(--color-forest);
    background: var(--color-cream);
  }
  .choice input {
    min-height: auto;
  }
  .check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 48px;
    font-weight: 500;
  }
  .check input {
    min-height: 24px;
    width: 24px;
  }
  .optional,
  .help,
  .note {
    color: var(--color-ink-soft);
    font-weight: 400;
  }
  .help,
  .note {
    margin: 0;
  }
  .error {
    margin: 0;
    color: var(--color-rust);
    font-weight: 600;
  }
  button.primary,
  button.ghost {
    min-height: 48px;
    padding: 0 var(--space-4);
    border-radius: 999px;
    font-weight: 600;
    cursor: pointer;
  }
  button.primary {
    border: none;
    background: var(--color-forest-deep);
    color: #fff;
  }
  button.ghost {
    border: 1px solid var(--color-divider);
    background: transparent;
    color: var(--color-forest-deep);
  }
  h3 {
    margin: 0 0 var(--space-1);
    font-size: var(--font-size-body);
    color: var(--color-forest-deep);
  }
  .target p {
    margin: 0 0 var(--space-2);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .target-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .target-row input {
    width: 7rem;
  }
  .history {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .history li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-1) 0;
    border-bottom: 1px solid var(--color-divider-soft);
  }
</style>
