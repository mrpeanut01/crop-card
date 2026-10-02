<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import Card from '$lib/components/ui/Card.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import type { DegreeDaysResult } from '$lib/ipm/degreeDayResult';
  import { watchForView } from '$lib/ipm/watchFor';

  interface Props {
    result: DegreeDaysResult | null;
    canRecordCatch: boolean;
    todayYmd: string;
  }

  const { result, canRecordCatch, todayYmd }: Props = $props();
  const view = $derived(watchForView(result));
  const tr = $derived(createT(page.data?.locale));

  let catchDates = $state<Record<string, string>>({});
  let busy = $state<string | null>(null);
  let errors = $state<Record<string, string>>({});

  async function saveCatch(modelId: string, date: string | null) {
    if (!result) return;
    busy = modelId;
    errors = { ...errors, [modelId]: '' };
    try {
      const res = await fetch(`/api/pest-models/${encodeURIComponent(modelId)}/biofix`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ year: result.year, date })
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        errors = {
          ...errors,
          [modelId]:
            res.status === 403
              ? tr('scout.watch.askOwner')
              : (body?.error ?? tr('scout.watch.errSaveCatch'))
        };
        return;
      }
      await invalidateAll();
    } catch {
      errors = { ...errors, [modelId]: tr('scout.watch.errOffline') };
    } finally {
      busy = null;
    }
  }
</script>

{#if view.show}
  <section class="watch-for" aria-labelledby="watch-for-title" data-testid="watch-for">
    <Card>
      <h2 id="watch-for-title">{tr('scout.watch.title')}</h2>
      {#if view.message}
        <p class="message">{view.message}</p>
      {/if}
      <ul class="models">
        {#each view.models as m (m.id)}
          <li class="model" data-testid="watch-for-model">
            <div class="model-head">
              <h3>{m.title}</h3>
              {#if m.stageLabel}
                <Pill tone="wheat">{m.stageLabel}</Pill>
              {/if}
            </div>
            {#each m.lines as line, i (i)}
              <p class="line">{line}</p>
            {/each}
            <p class="meta">
              {m.method}
              {#if m.station}
                <Provenance source="data" detail={m.station} label={tr('scout.watch.station')} />
              {/if}
            </p>
            {#if m.biofix}
              <p class="meta">
                {m.biofix.text}
                <Provenance source={m.biofix.source} compact />
              </p>
            {/if}
            {#if m.acceptsCatch && canRecordCatch}
              <form
                class="catch"
                onsubmit={(e) => {
                  e.preventDefault();
                  const d = catchDates[m.id] ?? m.catchDate ?? todayYmd;
                  void saveCatch(m.id, d);
                }}
              >
                <label for="catch-{m.id}">{tr('scout.watch.firstCatch')}</label>
                <div class="catch-row">
                  <input
                    id="catch-{m.id}"
                    type="date"
                    max={todayYmd}
                    value={catchDates[m.id] ?? m.catchDate ?? todayYmd}
                    oninput={(e) =>
                      (catchDates = {
                        ...catchDates,
                        [m.id]: (e.target as HTMLInputElement).value
                      })}
                  />
                  <button type="submit" disabled={busy === m.id}
                    >{tr('scout.watch.saveCatch')}</button
                  >
                  {#if m.catchDate}
                    <button
                      type="button"
                      class="ghost"
                      disabled={busy === m.id}
                      onclick={() => saveCatch(m.id, null)}>{tr('scout.watch.clearCatch')}</button
                    >
                  {/if}
                </div>
                {#if errors[m.id]}
                  <p class="error" role="alert">{errors[m.id]}</p>
                {/if}
              </form>
            {/if}
          </li>
        {/each}
      </ul>
    </Card>
  </section>
{/if}

<style>
  .watch-for {
    margin-bottom: 1rem;
  }
  h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    color: var(--color-forest);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  h3 {
    margin: 0;
    font-size: 1.05rem;
  }
  .models {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 1rem;
  }
  .model + .model {
    border-top: 1px solid var(--color-divider);
    padding-top: 1rem;
  }
  .model-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.4rem;
  }
  .line {
    margin: 0 0 0.3rem;
    overflow-wrap: anywhere;
  }
  .meta,
  .message {
    margin: 0.3rem 0 0;
    color: var(--color-ink-muted);
    font-size: 0.9rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
    overflow-wrap: anywhere;
  }
  .catch {
    margin-top: 0.6rem;
  }
  .catch label {
    display: block;
    font-weight: 600;
    margin-bottom: 0.3rem;
  }
  .catch-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .catch-row input {
    min-height: 48px;
    padding: 0 0.6rem;
    border: 2px solid var(--color-divider);
    border-radius: 4px;
    font-size: 1rem;
    max-width: 100%;
  }
  button {
    background: var(--color-paper);
    color: var(--color-forest);
    border: 2px solid var(--color-forest);
    border-radius: 6px;
    padding: 0.6rem 1rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 48px;
  }
  button.ghost {
    border-color: var(--color-divider);
    color: var(--color-ink-muted);
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .error {
    color: var(--color-rust);
    margin: 0.4rem 0 0;
  }
</style>
